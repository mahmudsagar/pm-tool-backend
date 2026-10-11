#!/usr/bin/env node
/**
 * Scrum checks: task event log (all write paths + page_history backfill), task timestamps on
 * GET /v1/board, sprint documents (legacy migration, CRUD, start / complete / delete), board
 * analytics (pure engine with synthetic multi-day events + the endpoint), board capacity,
 * notify on bulk reassign, and private-board write denial for members of the parent space.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   MONGODB_URI=mongodb://127.0.0.1:27999/scrumtest PORT=3202 node server.js
 *   API_URL=http://127.0.0.1:3202 MONGODB_URI=mongodb://127.0.0.1:27999/scrumtest node dev-test/scrum-endpoints.mjs
 *
 * MONGODB_URI is used directly (backdated events / history, legacy rows) and must point at the
 * same DB as the server.
 */
import { MongoClient, ObjectId } from 'mongodb';
import {
    statusCategory, computeTaskTimestamps, buildAnalytics, toPoints, resolvePointsKey,
} from '../modules/v1/utils/boardAnalytics.js';

const API = process.env.API_URL || 'http://127.0.0.1:3202';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27999/scrumtest';
if (!/127\.0\.0\.1|localhost/.test(MONGO)) {
    console.error('Refusing to run against a non-local MONGODB_URI');
    process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (name, condition, detail) => {
    if (condition) {
        passed += 1;
        console.log(`PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${name}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    }
};
const near = (a, b, eps = 0.011) => typeof a === 'number' && Math.abs(a - b) <= eps;

const call = async (method, p, { token, ws, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-ID'] = ws;
    const res = await fetch(`${API}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json, data: json?.data };
};

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const register = async (label) => {
    const res = await call('POST', '/v1/auth/register', {
        body: { name: `Scrum ${label}`, email: `scrum-${label}-${stamp()}@example.test`, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    const own = res.data.workspaces.find((w) => w.owner_id === res.data.user_info._id);
    return { token: res.data.token, userId: res.data.user_info._id, email: res.data.user_info.email, name: res.data.user_info.name, ws: own._id };
};

const FIELDS = [
    { name: 'status', type: 'select', options: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Blocked', 'Done'] },
    { name: 'story_points', label: 'Story points', type: 'number' },
    { name: 'sprint', type: 'text' },
    { name: 'assignee', type: 'person' },
    { name: 'blocked', type: 'checkbox' },
];

// -----------------------------------------------------------------------------------------------
// 1. Pure analytics engine
// -----------------------------------------------------------------------------------------------
const unitTests = () => {
    const cats = {
        Done: 'done', 'completed': 'done', 'won’t do': 'todo', 'Closed-Won': 'done', resolved: 'done', 'not_done': 'done',
        'Blocked': 'blocked', 'on hold': 'blocked', 'Stuck!': 'blocked',
        'Code Review': 'review', QA: 'review', 'in-testing': 'review', 'verify': 'review',
        'In Progress': 'in_progress', doing: 'in_progress', WIP: 'in_progress', 'active': 'in_progress',
        backlog: 'backlog', Icebox: 'backlog', 'later': 'backlog',
        '': 'todo', 'To Do': 'todo', 'undone thing': 'todo', 'Doneish': 'todo', [null]: 'todo',
    };
    const wrong = Object.entries(cats).filter(([v, c]) => statusCategory(v === 'null' ? null : v) !== c);
    check('unit: statusCategory rule table', wrong.length === 0, wrong.map(([v, c]) => `${v}: ${statusCategory(v)} != ${c}`));
    check('unit: points numeric, else 0', toPoints('5') === 5 && toPoints(3.5) === 3.5 && toPoints('x') === 0 && toPoints(null) === 0 && toPoints('') === 0);
    check('unit: points key falls back to label', resolvePointsKey([{ name: 'pts', label: 'Points' }]) === 'pts'
        && resolvePointsKey([{ name: 'story_points' }, { name: 'p', label: 'Points' }]) === 'story_points');

    const T = (s) => new Date(s);
    // timestamps
    const task = { _id: 't', createdAt: T('2026-03-01T00:00:00Z'), custom_meta: { values: { status: 'Done', blocked: false } } };
    const evs = [
        { task_id: 't', field: 'status', from: 'To Do', to: 'In Progress', at: T('2026-03-02T00:00:00Z') },
        { task_id: 't', field: 'status', from: 'In Progress', to: 'Done', at: T('2026-03-03T00:00:00Z') },
        { task_id: 't', field: 'status', from: 'Done', to: 'In Progress', at: T('2026-03-04T00:00:00Z') },
        { task_id: 't', field: 'status', from: 'In Progress', to: 'Done', at: T('2026-03-05T00:00:00Z') },
    ];
    let ts = computeTaskTimestamps(task, evs);
    check('unit: timestamps completed_at = last entry into done, started_at = first in_progress',
        ts.completed_at === '2026-03-05T00:00:00.000Z' && ts.started_at === '2026-03-02T00:00:00.000Z' && ts.status_changed_at === '2026-03-05T00:00:00.000Z' && ts.blocked_at === null, ts);
    ts = computeTaskTimestamps({ ...task, custom_meta: { values: { status: 'In Progress', blocked: true } } }, [
        ...evs.slice(0, 1),
        { task_id: 't', field: 'blocked', from: false, to: true, at: T('2026-03-02T06:00:00Z') },
    ]);
    check('unit: timestamps not done -> completed_at null; blocked flag -> blocked_at', ts.completed_at === null && ts.blocked_at === '2026-03-02T06:00:00.000Z', ts);
    ts = computeTaskTimestamps({ ...task, custom_meta: { values: { status: 'Blocked' } } }, [
        { task_id: 't', field: 'status', from: 'To Do', to: 'Blocked', at: T('2026-03-02T07:00:00Z') },
    ]);
    check('unit: blocked status -> blocked_at', ts.blocked_at === '2026-03-02T07:00:00.000Z' && ts.started_at === null, ts);
    ts = computeTaskTimestamps({ ...task, custom_meta: { values: { status: 'Done' } } }, []);
    check('unit: done without events falls back to createdAt', ts.completed_at === '2026-03-01T00:00:00.000Z', ts);

    // synthetic sprint: s1 runs 2026-03-02..03-06, started 03-02T09:00Z, "today" is 03-05.
    const board = { _id: 'b', key: 'SC', custom_meta: { fields: FIELDS } };
    const v = (status, points, sprint, extra = {}) => ({ custom_meta: { values: { status, story_points: points, sprint, ...extra } } });
    const tasks = [
        { _id: 'A', title: 'A', task_number: 1, createdAt: T('2026-02-20T00:00:00Z'), ...v('Done', 5, 's1') },
        { _id: 'B', title: 'B', task_number: 2, createdAt: T('2026-03-01T12:00:00Z'), ...v('Code Review', 3, 's1') },
        { _id: 'C', title: 'C', task_number: 3, createdAt: T('2026-03-03T09:00:00Z'), ...v('To Do', 5, 's1') },
        { _id: 'D', title: 'D', task_number: 4, createdAt: T('2026-02-25T00:00:00Z'), ...v('To Do', 8, null) },
        { _id: 'E', title: 'E (subtask)', task_number: 5, parent_id: 'A', createdAt: T('2026-02-25T00:00:00Z'), ...v('To Do', 13, 's1') },
        { _id: 'G', title: 'G', task_number: 6, createdAt: T('2026-02-25T00:00:00Z'), ...v('To Do', 1, 's1', { blocked: true }) },
    ];
    const ev = (task_id, field, from, to, at, extra = {}) => ({ task_id, field, from, to, at: T(at), actor: 'u1', reason: null, ...extra });
    const snap = (title, n, parent = null) => ({ title, task_number: n, parent_id: parent, created_at: null, values: {} });
    const events = [
        ev('A', 'sprint', null, 's1', '2026-03-01T10:00:00Z'),
        ev('B', '_created', null, snap('B', 2), '2026-03-01T12:00:00Z'),
        ev('B', 'status', null, 'To Do', '2026-03-01T12:00:00Z'),
        ev('B', 'story_points', null, 3, '2026-03-01T12:00:00Z'),
        ev('B', 'sprint', null, 's1', '2026-03-01T12:00:00Z'),
        ev('H', '_created', null, snap('H', 7), '2026-03-02T08:00:00Z'),
        ev('H', 'status', null, 'To Do', '2026-03-02T08:00:00Z'),
        ev('H', 'story_points', null, 2, '2026-03-02T08:00:00Z'),
        ev('A', 'status', 'To Do', 'In Progress', '2026-03-02T10:00:00Z'),
        ev('C', '_created', null, snap('C', 3), '2026-03-03T09:00:00Z'),
        ev('C', 'status', null, 'To Do', '2026-03-03T09:00:00Z'),
        ev('C', 'story_points', null, 2, '2026-03-03T09:00:00Z'),
        ev('C', 'sprint', null, 's1', '2026-03-03T09:00:00Z', { reason: 'Hotfix' }),
        ev('G', 'blocked', null, true, '2026-03-03T11:00:00Z'),
        ev('A', 'status', 'In Progress', 'Done', '2026-03-03T15:00:00Z'),
        ev('D', 'sprint', 's1', null, '2026-03-04T08:00:00Z', { reason: 'Descoped' }),
        ev('H', '_removed', null, { ...snap('H', 7), values: { status: 'To Do', story_points: 2 } }, '2026-03-04T09:00:00Z'),
        ev('B', 'status', 'To Do', 'Code Review', '2026-03-04T10:00:00Z'),
        ev('C', 'story_points', 2, 5, '2026-03-04T12:00:00Z'),
    ];
    const sprints = [
        { _id: 's0', name: 'S0', status: 'closed', start_date: '2026-02-16', end_date: '2026-02-27', committed: { points: 10, issues: 3 }, closed: { completed_points: 7, completed_issues: 2 } },
        { _id: 's1', name: 'S1', status: 'active', start_date: '2026-03-02', end_date: '2026-03-06', committed: { points: 17, issues: 4, at: '2026-03-02T09:00:00.000Z' } },
        { _id: 's2', name: 'S2', status: 'planned', start_date: '2026-03-09', end_date: '2026-03-20' },
    ];
    const users = new Map([['u1', 'Una']]);
    const a = buildAnalytics({ board, tasks, events, sprint: sprints[1], sprints, from: '2026-03-02', to: '2026-03-06', today: '2026-03-05', users });
    const day = (d) => a.daily.find((x) => x.date === d);
    check('unit: days include future, daily omits them', a.days.length === 5 && a.daily.length === 4 && !day('2026-03-06'), { days: a.days, daily: a.daily.map((x) => x.date) });
    let d = day('2026-03-02');
    check('unit: burndown day 1 (sprint scope, top-level only)', d.scope_points === 17 && d.scope_issues === 4 && d.remaining_points === 17 && d.done_points === 0, d);
    check('unit: CFD day 1 categories', d.by_category.in_progress.points === 5 && d.by_category.todo.points === 12 && d.by_category.todo.issues === 3
        && d.by_category.blocked.issues === 0, d.by_category);
    d = day('2026-03-03');
    check('unit: burndown day 2 (scope added mid-sprint, A done)', d.scope_points === 19 && d.scope_issues === 5 && d.done_points === 5 && d.remaining_points === 14 && d.remaining_issues === 4, d);
    check('unit: CFD day 2 blocked flag + done', d.by_category.blocked.points === 1 && d.by_category.done.points === 5 && d.by_category.todo.points === 13, d.by_category);
    check('unit: completed list on the day A entered done', d.completed.length === 1 && d.completed[0].task_id === 'A' && d.completed[0].key === 'SC-1' && d.completed[0].points === 5, d.completed);
    d = day('2026-03-04');
    check('unit: burndown day 3 (descoped D, resized C, B in review)', d.scope_points === 14 && d.scope_issues === 4 && d.remaining_points === 9
        && d.by_category.review.points === 3 && d.completed.length === 0, d);
    check('unit: day 4 unchanged', JSON.stringify({ ...day('2026-03-05'), date: 0 }) === JSON.stringify({ ...day('2026-03-04'), date: 0 }));
    check('unit: churn kinds/deltas in time order', a.churn.map((c) => `${c.task_id}:${c.kind}:${c.delta_points}`).join() === 'C:added:2,D:removed:-8,C:resized:3', a.churn);
    check('unit: churn carries actor, actor_name, reason, key', a.churn[0].actor === 'u1' && a.churn[0].actor_name === 'Una' && a.churn[0].reason === 'Hotfix'
        && a.churn[1].reason === 'Descoped' && a.churn[0].key === 'SC-3' && a.churn[0].title === 'C', a.churn[0]);
    check('unit: pre-start sprint add is not churn', !a.churn.some((c) => c.task_id === 'A' || c.task_id === 'B'));
    check('unit: cycle time (first in_progress -> done)', a.flow.cycle_times.length === 1 && near(a.flow.cycle_times[0].days, 29 / 24), a.flow.cycle_times);
    check('unit: lead time in sprint mode (added to sprint -> done)', a.flow.lead_times.length === 1 && near(a.flow.lead_times[0].days, 53 / 24), a.flow.lead_times);
    const stage = (f, t) => a.flow.stage_times.find((x) => x.from === f && x.to === t);
    check('unit: stage times', near(stage('in_progress', 'done')?.avg_days, 29 / 24) && stage('in_progress', 'done').count === 1
        && near(stage('todo', 'in_progress')?.avg_days, 10 + 10 / 24) && near(stage('todo', 'review')?.avg_days, 2 + 22 / 24)
        && near(stage('todo', 'blocked')?.avg_days, 6 + 11 / 24), a.flow.stage_times);
    check('unit: throughput per day', a.flow.throughput.length === 4 && a.flow.throughput.find((x) => x.date === '2026-03-03').points === 5
        && a.flow.throughput.find((x) => x.date === '2026-03-03').issues === 1 && a.flow.throughput.find((x) => x.date === '2026-03-04').points === 0, a.flow.throughput);
    check('unit: velocity = closed snapshot + live active, planned excluded', a.velocity.length === 2
        && a.velocity[0].sprint_id === 's0' && a.velocity[0].committed_points === 10 && a.velocity[0].completed_points === 7 && a.velocity[0].completed_issues === 2
        && a.velocity[1].sprint_id === 's1' && a.velocity[1].committed_points === 17 && a.velocity[1].completed_points === 5 && a.velocity[1].completed_issues === 1, a.velocity);
    check('unit: statuses with categories', a.statuses.length === 6 && a.statuses.find((s) => s.value === 'Code Review').category === 'review'
        && a.statuses.find((s) => s.value === 'Backlog').category === 'backlog', a.statuses);

    // range mode over the same log: all top-level tasks that exist that day (H created + removed)
    const r = buildAnalytics({ board, tasks, events, sprint: null, sprints, from: '2026-03-01', to: '2026-03-05', today: '2026-03-05', users });
    const rd = (x) => r.daily.find((y) => y.date === x);
    check('unit: range mode scope = existing top-level tasks', rd('2026-03-01').scope_issues === 4 && rd('2026-03-03').scope_issues === 6
        && rd('2026-03-04').scope_issues === 5 && rd('2026-03-04').scope_points === 5 + 3 + 5 + 8 + 1, r.daily.map((x) => [x.date, x.scope_issues, x.scope_points]));
    check('unit: range mode has no churn; lead time from creation', r.churn.length === 0 && near(r.flow.lead_times[0].days, 11 + 15 / 24), r.flow.lead_times);

    // closed sprint: spillover moved out on completion still counts in that sprint's view
    const closedSprint = { _id: 's1', name: 'S1', status: 'closed', start_date: '2026-03-02', end_date: '2026-03-06',
        committed: { points: 17, issues: 4, at: '2026-03-02T09:00:00.000Z' }, closed: { completed_points: 5, completed_issues: 1, at: '2026-03-06T17:00:00.000Z' } };
    const moved = [...events, ev('C', 'sprint', 's1', 's2', '2026-03-06T17:00:01Z', { reason: 'Sprint completed' })];
    const movedTasks = tasks.map((t) => (t._id === 'C' ? { ...t, ...v('To Do', 5, 's2') } : t));
    const c = buildAnalytics({ board, tasks: movedTasks, events: moved, sprint: closedSprint, sprints, from: '2026-03-02', to: '2026-03-06', today: '2026-03-10', users });
    const last = c.daily[c.daily.length - 1];
    check('unit: closed sprint keeps spillover in its burndown; completion move is not churn', c.daily.length === 5 && last.scope_issues === 4 && last.remaining_points === 9
        && c.churn.length === 3, { last, churn: c.churn.length });
};

// -----------------------------------------------------------------------------------------------
// 2. API
// -----------------------------------------------------------------------------------------------
const main = async () => {
    unitTests();

    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();
    const events = (filter) => db.collection('task_event').find(filter).sort({ at: 1, _id: 1 }).toArray();

    const owner = await register('owner');
    const member = await register('member');
    const outsider = await register('outsider');
    const as = (u, ws = owner.ws) => ({ token: u.token, ws });
    const o = as(owner);
    const m = as(member);

    let r = await call('POST', '/v1/workspace/member', { ...o, body: { email: member.email, role: 'member' } });
    check('setup: add member', r.status === 200, r.json);
    const spaceRes = await call('POST', '/v1/space', { ...o, body: { user_id: owner.userId, name: 'Scrum Space', is_private: false } });
    const space = Array.isArray(spaceRes.data) ? spaceRes.data[0] : spaceRes.data;

    const mkBoard = async (body, auth = o, userId = owner.userId) => {
        const res = await call('POST', '/v1/board', {
            ...auth,
            body: { user_id: userId, space_id: space._id, custom_meta: { board_kind: 'scrum', fields: FIELDS }, ...body },
        });
        if (res.status !== 200) throw new Error(`board create failed: ${JSON.stringify(res.json)}`);
        return res.data;
    };
    const mkTask = async (board, values = {}, extra = {}, u = owner) => {
        const res = await call('POST', '/v1/page/document', {
            ...as(u),
            body: { user_id: u.userId, page_type: 'document', board_id: board._id, title: extra.title || 'Task', custom_meta: { fields: FIELDS, values: { status: 'To Do', ...values } }, ...extra },
        });
        if (res.status !== 200) throw new Error(`task create failed: ${JSON.stringify(res.json)}`);
        return res.data;
    };
    const getBoard = async (boardId, auth = o) => {
        const res = await call('GET', `/v1/board?id=${boardId}`, auth);
        return { ...res, board: Array.isArray(res.data) ? res.data[0] : null };
    };
    const allTasks = (board) => board.documents.flatMap((d) => [d, ...(d.subtasks || [])]);
    const bulk = (board, updates, extra = {}, auth = o) => call('PUT', '/v1/board/tasks', { ...auth, body: { board_id: board._id, updates, ...extra } });
    const valuesOf = async (id) => (await db.collection('page_meta').findOne({ _id: new ObjectId(id) }))?.custom_meta?.values || {};

    // --- Legacy sprint migration ------------------------------------------------------------
    const legacy = await mkBoard({
        name: 'Legacy Scrum',
        saved_view: { scrum: { sprint_management: { sprints: ['Sprint 1', 'Sprint 2'], active_sprint: 'Sprint 2', member_capacity: {} } } },
    });
    const l1 = await mkTask(legacy, { sprint: 'Sprint 1', story_points: 3 }, { title: 'L1' });
    const l2 = await mkTask(legacy, { sprint: 'Sprint 2', story_points: 5 }, { title: 'L2' });
    const l3 = await mkTask(legacy, { sprint: 'Hotfix' }, { title: 'L3' });
    const l4 = await mkTask(legacy, {}, { title: 'L4' });
    r = await call('GET', `/v1/board/sprint?board_id=${legacy._id}`, o);
    const migrated = r.data || [];
    const byName = Object.fromEntries(migrated.map((s) => [s.name, s]));
    check('migration: sprint docs from saved_view names + unknown task sprint', r.status === 200 && migrated.length === 3
        && byName['Sprint 1']?.status === 'planned' && byName['Sprint 2']?.status === 'active' && byName.Hotfix?.status === 'planned', migrated.map((s) => [s.name, s.status]));
    check('migration: task values.sprint rewritten to ids', (await valuesOf(l1._id)).sprint === byName['Sprint 1']?._id
        && (await valuesOf(l2._id)).sprint === byName['Sprint 2']?._id && (await valuesOf(l3._id)).sprint === byName.Hotfix?._id
        && !('sprint' in (await valuesOf(l4._id))));
    const l1Events = await events({ task_id: l1._id, field: 'sprint' });
    check('migration: logged sprint names rewritten to ids', l1Events.length === 1 && l1Events[0].to === byName['Sprint 1']?._id, l1Events);
    r = await call('GET', `/v1/board/sprint?board_id=${legacy._id}`, o);
    check('migration: runs once', r.data?.length === 3 && (await db.collection('sprint').countDocuments({ board_id: legacy._id })) === 3);
    const lb = (await getBoard(legacy._id)).board;
    check('migration: GET board shows ids', allTasks(lb).find((t) => t._id === l2._id)?.custom_meta?.values?.sprint === byName['Sprint 2']._id);
    const legacy2 = await mkBoard({ name: 'Legacy Two', saved_view: { scrum: { sprint_management: { sprints: ['Alpha'], active_sprint: '' } } } });
    const lt = await mkTask(legacy2, { sprint: 'Alpha' });
    await getBoard(legacy2._id);
    const alpha = await db.collection('sprint').findOne({ board_id: legacy2._id });
    check('migration: also on first GET /v1/board', alpha?.name === 'Alpha' && alpha.status === 'planned' && (await valuesOf(lt._id)).sprint === String(alpha._id), alpha);

    // --- Sprint CRUD -------------------------------------------------------------------------
    const sb = await mkBoard({ name: 'Sprint Board' });
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id } });
    check('crud: name required', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id, name: 'Bad', start_date: '2026-05-10', end_date: '2026-05-01' } });
    check('crud: end before start 400', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id, name: 'Bad', start_date: '2026-02-30' } });
    check('crud: invalid date 400', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint', { ...m, body: { board_id: sb._id, name: 'Sprint B', goal: 'Second', start_date: '2026-06-15', end_date: '2026-06-28' } });
    const spB = r.data;
    check('crud: create (member of public board)', r.status === 200 && spB?.status === 'planned' && spB.goal === 'Second' && spB.board_id === sb._id && spB.committed === null, r.json);
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id, name: 'Sprint A', start_date: '2026-06-01' } });
    const spA = r.data;
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id, name: 'Sprint C' } });
    const spC = r.data;
    r = await call('POST', '/v1/board/sprint', { ...o, body: { board_id: sb._id, name: 'Sprint D' } });
    const spD = r.data;
    r = await call('GET', `/v1/board/sprint?board_id=${sb._id}`, o);
    check('crud: list sorted by start_date then createdAt', r.status === 200 && r.data.map((s) => s.name).join() === 'Sprint A,Sprint B,Sprint C,Sprint D', r.data?.map((s) => s.name));
    r = await call('PUT', '/v1/board/sprint', { ...o, body: { id: spA._id, name: 'Sprint A1', goal: 'Ship it', end_date: '2026-06-14' } });
    check('crud: update', r.status === 200 && r.data.name === 'Sprint A1' && r.data.goal === 'Ship it' && r.data.end_date === '2026-06-14', r.json);
    r = await call('PUT', '/v1/board/sprint', { ...o, body: { id: spA._id, end_date: '2026-05-01' } });
    check('crud: update end before stored start 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board/sprint', { ...o, body: { id: new ObjectId().toHexString(), name: 'x' } });
    check('crud: unknown sprint 404', r.status === 404, r.status);
    r = await call('GET', `/v1/board/sprint?board_id=${sb._id}`, as(outsider, outsider.ws));
    check('crud: outsider 404', r.status === 404, r.status);
    r = await call('PUT', '/v1/board/sprint', { ...as(outsider, outsider.ws), body: { id: spA._id, name: 'hack' } });
    check('crud: outsider cannot update (404)', r.status === 404, r.status);

    // --- Start / committed snapshot ----------------------------------------------------------
    const a1 = await mkTask(sb, { sprint: spA._id, story_points: 3 }, { title: 'A1' });
    const a2 = await mkTask(sb, { sprint: spA._id, story_points: '5' }, { title: 'A2' });
    const a3 = await mkTask(sb, { sprint: spA._id, story_points: 'n/a' }, { title: 'A3' });
    const a1sub = await mkTask(sb, { sprint: spA._id, story_points: 8 }, { title: 'A1 sub', parent_id: a1._id });
    const c1 = await mkTask(sb, { sprint: spC._id, story_points: 2 }, { title: 'C1' });
    const today = new Date().toISOString().slice(0, 10);
    const plus13 = new Date(Date.parse(`${today}T00:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10);
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: spC._id } });
    const startedC = r.data;
    check('start: defaults start today, end +13d', r.status === 200 && startedC.status === 'active' && startedC.start_date === today && startedC.end_date === plus13, r.json);
    check('start: committed snapshot', startedC?.committed?.points === 2 && startedC.committed.issues === 1 && startedC.committed.task_ids.join() === c1._id && !!startedC.committed.at, startedC?.committed);
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: spA._id } });
    check('start: second active sprint -> 409', r.status === 409 && r.json?.data?.active_sprint_id === spC._id, r.json);
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: spC._id } });
    check('start: already active -> 409', r.status === 409, r.json);
    r = await call('DELETE', `/v1/board/sprint?id=${spC._id}`, o);
    check('delete: active sprint -> 409', r.status === 409 && !!(await db.collection('sprint').findOne({ _id: new ObjectId(spC._id) })), r.json);

    // complete C -> backlog
    r = await call('POST', '/v1/board/sprint/complete', { ...o, body: { id: spC._id, move_to: spC._id } });
    check('complete: move_to itself 400', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint/complete', { ...o, body: { id: spC._id, move_to: 'nowhere' } });
    check('complete: bad move_to 400', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint/complete', { ...o, body: { id: spC._id, move_to: 'backlog' } });
    check('complete: to backlog', r.status === 200 && r.data.sprint.status === 'closed' && r.data.sprint.closed.completed_points === 0
        && r.data.sprint.closed.spillover_ids.join() === c1._id && r.data.moved_task_ids.join() === c1._id, r.json);
    check('complete: spillover sprint cleared', !('sprint' in (await valuesOf(c1._id))));
    let ce = await events({ task_id: c1._id, field: 'sprint', reason: 'Sprint completed' });
    check('complete: event with reason (backlog)', ce.length === 1 && ce[0].from === spC._id && ce[0].to === null && ce[0].actor === owner.userId, ce);
    r = await call('POST', '/v1/board/sprint/complete', { ...o, body: { id: spC._id, move_to: 'backlog' } });
    check('complete: closed sprint -> 409', r.status === 409, r.json);
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: spC._id } });
    check('start: closed sprint -> 409', r.status === 409, r.json);

    // start A with explicit dates, complete into B
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: spA._id, start_date: '2026-06-02', end_date: '2026-06-01' } });
    check('start: end before start 400', r.status === 400, r.json);
    r = await call('POST', '/v1/board/sprint/start', { ...m, body: { id: spA._id, start_date: '2026-06-02' } });
    check('start: explicit start, end = start + 13d; committed counts top-level only, non-numeric = 0', r.status === 200 && r.data.start_date === '2026-06-02'
        && r.data.end_date === '2026-06-15' && r.data.committed.points === 8 && r.data.committed.issues === 3
        && [a1._id, a2._id, a3._id].every((id) => r.data.committed.task_ids.includes(id)), r.json);
    r = await bulk(sb, [{ id: a1._id, values: { status: 'Done' } }]);
    r = await call('POST', '/v1/board/sprint/complete', { ...o, body: { id: spA._id, move_to: spB._id } });
    const closedA = r.data?.sprint;
    check('complete: closed snapshot', r.status === 200 && closedA.closed.completed_points === 3 && closedA.closed.completed_issues === 1
        && closedA.closed.completed_ids.join() === a1._id && closedA.closed.spillover_ids.length === 2 && !!closedA.closed.at, r.json);
    check('complete: unfinished tasks (incl. subtask) moved to B', (await valuesOf(a2._id)).sprint === spB._id && (await valuesOf(a3._id)).sprint === spB._id
        && (await valuesOf(a1sub._id)).sprint === spB._id && (await valuesOf(a1._id)).sprint === spA._id && r.data.moved_task_ids.length === 3, r.data?.moved_task_ids);
    ce = await events({ board_id: sb._id, field: 'sprint', reason: 'Sprint completed', to: spB._id });
    check('complete: events with reason "Sprint completed"', ce.length === 3 && ce.every((e) => e.from === spA._id), ce.length);

    // delete rules
    const d1 = await mkTask(sb, { sprint: spD._id }, { title: 'D1' });
    r = await call('DELETE', `/v1/board/sprint?id=${spD._id}`, m);
    check('delete: planned sprint deleted, tasks cleared', r.status === 200 && r.data.cleared_task_ids.join() === d1._id
        && !(await db.collection('sprint').findOne({ _id: new ObjectId(spD._id) })) && !('sprint' in (await valuesOf(d1._id))), r.json);
    const de = await events({ task_id: d1._id, field: 'sprint', reason: 'Sprint deleted' });
    check('delete: clear written as event', de.length === 1 && de[0].to === null, de);
    r = await call('DELETE', `/v1/board/sprint?id=${spC._id}`, o);
    check('delete: closed sprint can be deleted', r.status === 200, r.json);
    r = await call('DELETE', `/v1/board/sprint?id=${spB._id}`, as(outsider, outsider.ws));
    check('delete: outsider 404', r.status === 404, r.status);

    // --- Event hooks ---------------------------------------------------------------------------
    const eb = await mkBoard({ name: 'Events Board' });
    const e1 = await mkTask(eb, { status: 'To Do', story_points: 2, priority: 'High', assignee: owner.userId }, { title: 'E1' });
    let ev = await events({ task_id: e1._id });
    check('events: POST emits _created + initial values (from null)', ev[0]?.field === '_created' && ev[0].to?.title === 'E1'
        && ['status', 'story_points', 'assignee', 'priority'].every((f) => ev.some((e) => e.field === f && e.from === null))
        && ev.length === 5 && ev.every((e) => e.board_id === eb._id && e.actor === owner.userId && e.workspace_id === owner.ws), ev.map((e) => e.field));
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: e1._id, custom_meta_values: { status: 'In Progress', notes: 'x' } } });
    ev = await events({ task_id: e1._id, field: 'status' });
    check('events: single PUT custom_meta_values -> status event', r.status === 200 && ev.length === 2 && ev[1].from === 'To Do' && ev[1].to === 'In Progress' && ev[1].actor === member.userId, ev);
    r = await call('PUT', '/v1/page/document', { ...o, body: { id: e1._id, custom_meta: { fields: FIELDS, values: { status: 'In Progress', story_points: 5, epic: 'E-1', priority: 'High', assignee: owner.userId } } } });
    ev = await events({ task_id: e1._id, field: { $in: ['story_points', 'epic'] }, from: { $ne: null } });
    const epicEv = await events({ task_id: e1._id, field: 'epic' });
    check('events: single PUT custom_meta -> points + epic events only for changed fields', r.status === 200 && ev.length === 1 && ev[0].to === 5
        && epicEv.length === 1 && epicEv[0].to === 'E-1' && (await events({ task_id: e1._id, field: 'status' })).length === 2, { ev, epicEv });
    r = await bulk(eb, [{ id: e1._id, values: { status: 'Blocked', blocked: true } }], { reason: 'Waiting on API' }, m);
    ev = await events({ task_id: e1._id, reason: 'Waiting on API' });
    check('events: bulk PUT with reason', r.status === 200 && ev.length === 2 && ev.map((e) => e.field).sort().join() === 'blocked,status', ev);
    r = await bulk(eb, [{ id: e1._id, sort_order: 5 }]);
    check('events: reorder only writes no event', (await events({ task_id: e1._id })).length === 10, (await events({ task_id: e1._id })).length);
    r = await bulk(eb, [{ id: e1._id, values: { reason: 'free text not tracked' } }], { reason: 'x'.repeat(501) });
    check('events: reason > 500 chars 400', r.status === 400, r.status);

    // timestamps on GET /v1/board
    let gb = (await getBoard(eb._id)).board;
    let gt = allTasks(gb).find((t) => t._id === e1._id);
    check('timestamps: blocked task has blocked_at + started_at, no completed_at', !!gt.blocked_at && !!gt.started_at && gt.completed_at === null && !!gt.status_changed_at, gt);
    await bulk(eb, [{ id: e1._id, values: { status: 'Done', blocked: null } }]);
    // E4: a clean todo -> in progress -> done history, backdated to January.
    const e4 = await mkTask(eb, { status: 'To Do' }, { title: 'E4' });
    await bulk(eb, [{ id: e4._id, values: { status: 'In Progress' } }]);
    await bulk(eb, [{ id: e4._id, values: { status: 'Done' } }]);
    const fixed = new Date('2026-01-15T10:30:00.000Z');
    for (const e of await events({ task_id: e4._id })) {
        const at = e.field === '_created' || e.from === null ? new Date('2026-01-05T00:00:00.000Z')
            : e.to === 'In Progress' ? new Date('2026-01-10T08:00:00.000Z') : fixed;
        await db.collection('task_event').updateOne({ _id: e._id }, { $set: { at } });
    }
    await db.collection('page_meta').updateOne({ _id: new ObjectId(e4._id) }, { $set: { createdAt: new Date('2026-01-05T00:00:00.000Z') } });
    gb = (await getBoard(eb._id)).board;
    gt = allTasks(gb).find((t) => t._id === e4._id);
    check('timestamps: completed_at / started_at from (backdated) events', gt.completed_at === fixed.toISOString() && gt.started_at === '2026-01-10T08:00:00.000Z'
        && gt.blocked_at === null && gt.status_changed_at === fixed.toISOString(), gt);
    gt = allTasks(gb).find((t) => t._id === e1._id);
    check('timestamps: unblocked + done -> completed_at set, blocked_at null', !!gt.completed_at && gt.blocked_at === null && gt.started_at < gt.completed_at, gt);
    const e2 = await mkTask(eb, { status: 'To Do' }, { title: 'E2' });
    const e2sub = await mkTask(eb, { status: 'Blocked' }, { title: 'E2 sub', parent_id: e2._id });
    gb = (await getBoard(eb._id)).board;
    const g2 = allTasks(gb).find((t) => t._id === e2._id);
    const g2sub = allTasks(gb).find((t) => t._id === e2sub._id);
    check('timestamps: todo task nulls; subtask blocked_at', g2.completed_at === null && g2.started_at === null && g2.blocked_at === null
        && !!g2.status_changed_at && !!g2sub.blocked_at && 'completed_at' in g2sub, { g2, g2sub });
    r = await call('GET', `/v1/board?user_id=${owner.userId}`, o);
    const listed = r.data?.find((b) => b._id === eb._id);
    check('timestamps: also in the board list', listed && allTasks(listed).every((t) => 'completed_at' in t && 'blocked_at' in t));

    // removal / restore
    const e3 = await mkTask(eb, { status: 'To Do', story_points: 1 }, { title: 'E3' });
    const e3sub = await mkTask(eb, { status: 'To Do' }, { title: 'E3 sub', parent_id: e3._id });
    r = await call('DELETE', `/v1/board/tasks?board_id=${eb._id}&ids=${e3._id}`, o);
    ev = await events({ board_id: eb._id, field: '_removed' });
    check('events: DELETE /v1/board/tasks -> _removed for task and subtask', r.status === 200 && ev.length === 2
        && ev.some((e) => e.task_id === e3._id && e.to?.title === 'E3' && e.to?.values?.story_points === 1) && ev.some((e) => e.task_id === e3sub._id), ev);
    r = await call('GET', '/v1/trash', o);
    const e3item = r.data?.find((it) => it.entity_id === e3._id);
    r = await call('POST', '/v1/trash/restore', { ...o, body: { id: e3item?._id } });
    ev = await events({ board_id: eb._id, field: '_restored' });
    check('events: trash restore -> _restored', r.status === 200 && ev.length === 2 && ev.some((e) => e.task_id === e3._id), ev.length);
    r = await call('DELETE', `/v1/page/document?id=${e2._id}`, o);
    ev = await events({ task_id: e2._id, field: '_removed' });
    check('events: page delete of a board task -> _removed', r.status === 200 && ev.length === 1, r.json);

    // --- Analytics endpoint ----------------------------------------------------------------------
    r = await call('GET', `/v1/board/analytics?board_id=${eb._id}`, o);
    check('analytics: default range = last 30 days', r.status === 200 && r.data.days.length === 30 && r.data.range.to === today && r.data.daily.length === 30
        && r.data.sprint === null && r.data.statuses.length === 6, r.json?.message || r.data?.range);
    const lastDay = r.data?.daily?.[r.data.daily.length - 1];
    check('analytics: today scope counts live top-level tasks', lastDay?.scope_issues === 3 && lastDay.done_issues === 2 && lastDay.by_category.done.issues === 2 && lastDay.by_category.todo.issues === 1, lastDay);
    r = await call('GET', `/v1/board/analytics?board_id=${eb._id}&from=2026-01-01&to=2026-06-01`, o);
    check('analytics: > 120 days 400', r.status === 400, r.json);
    r = await call('GET', `/v1/board/analytics?board_id=${eb._id}&from=2026-01-01&to=2026-01-31`, o);
    check('analytics: explicit range, backdated completion shows in throughput', r.status === 200 && r.data.days.length === 31
        && r.data.flow.throughput.find((x) => x.date === '2026-01-15')?.issues === 1 && near(r.data.flow.cycle_times[0]?.days, 5 + 2.5 / 24), r.data?.flow);
    r = await call('GET', `/v1/board/analytics?board_id=${sb._id}&sprint_id=${spA._id}`, m);
    check('analytics: sprint mode range + sprint doc + velocity snapshot', r.status === 200 && r.data.range.from === '2026-06-02' && r.data.range.to === '2026-06-15'
        && r.data.sprint?._id === spA._id && r.data.days.length === 14
        && r.data.velocity.some((x) => x.sprint_id === spA._id && x.committed_points === 8 && x.completed_points === 3 && x.status === 'closed'), r.data?.velocity || r.json);
    r = await call('GET', `/v1/board/analytics?board_id=${sb._id}&sprint_id=${new ObjectId().toHexString()}`, o);
    check('analytics: unknown sprint 404', r.status === 404, r.status);
    r = await call('GET', `/v1/board/analytics?board_id=${sb._id}`, as(outsider, outsider.ws));
    check('analytics: outsider 404', r.status === 404, r.status);

    // live sprint churn through the API: start a sprint, add/resize/remove after start
    const cb = await mkBoard({ name: 'Churn Board' });
    const sp = (await call('POST', '/v1/board/sprint', { ...o, body: { board_id: cb._id, name: 'Live' } })).data;
    const k1 = await mkTask(cb, { sprint: sp._id, story_points: 3 }, { title: 'K1' });
    const k2 = await mkTask(cb, { story_points: 2 }, { title: 'K2' });
    r = await call('POST', '/v1/board/sprint/start', { ...o, body: { id: sp._id } });
    await bulk(cb, [{ id: k2._id, values: { sprint: sp._id } }], { reason: 'Pulled in' }, m);
    await bulk(cb, [{ id: k1._id, values: { story_points: 5 } }]);
    await bulk(cb, [{ id: k2._id, values: { sprint: null } }], { reason: 'Descoped' });
    r = await call('GET', `/v1/board/analytics?board_id=${cb._id}&sprint_id=${sp._id}`, o);
    const churn = r.data?.churn || [];
    check('analytics: churn via API (added / resized / removed with actor_name + reason)', r.status === 200 && churn.map((c) => `${c.kind}:${c.delta_points}`).join() === 'added:2,resized:2,removed:-2'
        && churn[0].actor === member.userId && churn[0].actor_name === member.name && churn[0].reason === 'Pulled in' && churn[2].reason === 'Descoped'
        && churn[0].key && churn[0].title === 'K2', churn);
    const todayRow = r.data?.daily?.find((x) => x.date === today);
    check('analytics: sprint burndown today', todayRow?.scope_points === 5 && todayRow.scope_issues === 1 && r.data.days.length === 14 && r.data.daily.length === 1, todayRow);
    check('analytics: velocity uses live values for the active sprint', r.data?.velocity?.length === 1 && r.data.velocity[0].committed_points === 3 && r.data.velocity[0].completed_points === 0, r.data?.velocity);

    // --- Backfill from page_history --------------------------------------------------------------
    const hb = await mkBoard({ name: 'History Board' });
    const h1 = await mkTask(hb, { status: 'To Do', story_points: 2 }, { title: 'H1' });
    const h2 = await mkTask(hb, { status: 'In Progress' }, { title: 'H2' });
    // Make it look like a board from before the event log: drop its events, age the tasks and
    // write the page_history entries the old PUT code would have written.
    await db.collection('task_event').deleteMany({ board_id: hb._id });
    await db.collection('board').updateOne({ _id: new ObjectId(hb._id) }, { $unset: { events_backfilled_at: '' } });
    await db.collection('page_meta').updateMany({ _id: { $in: [new ObjectId(h1._id), new ObjectId(h2._id)] } }, { $set: { createdAt: new Date('2026-02-01T09:00:00Z') } });
    const hist = (pageId, at, fromValues, toValues) => ({
        _id: new ObjectId().toHexString().slice(0, 24), page_id: pageId, page_content_id: 'x', user_id: member.userId, version: 2,
        action: 'custom_meta_updated', content_snapshot: null, meta_snapshot: null,
        changes: { custom_meta: { from: { fields: FIELDS, values: fromValues }, to: { fields: FIELDS, values: toValues } } },
        createdAt: new Date(at),
    });
    await db.collection('page_history').insertMany([
        hist(h1._id, '2026-02-02T10:00:00Z', { status: 'To Do', story_points: 1 }, { status: 'In Progress', story_points: 1 }),
        hist(h1._id, '2026-02-04T10:00:00Z', { status: 'In Progress', story_points: 1 }, { status: 'To Do', story_points: 2 }),
        { ...hist(h1._id, '2026-02-03T10:00:00Z', {}, {}), action: 'title_updated', changes: { title: { from: 'a', to: 'b' } } },
    ]);
    // a live event after the history: history entries at/after it must be skipped
    await db.collection('task_event').insertOne({ workspace_id: owner.ws, board_id: hb._id, task_id: h2._id, field: 'status', from: 'To Do', to: 'In Progress', at: new Date('2026-02-05T00:00:00Z'), actor: owner.userId, reason: null, backfilled: false });
    await db.collection('page_history').insertMany([
        hist(h2._id, '2026-02-03T00:00:00Z', { status: 'Backlog' }, { status: 'To Do' }),
        hist(h2._id, '2026-02-05T00:00:00Z', { status: 'To Do' }, { status: 'In Progress' }),
    ]);
    r = await call('GET', `/v1/board/analytics?board_id=${hb._id}&from=2026-02-01&to=2026-02-06`, o);
    const h1ev = await events({ task_id: h1._id });
    check('backfill: _created at createdAt + initial values from first change + history diffs', r.status === 200
        && h1ev.map((e) => `${e.field}:${e.from}>${e.to?.title || e.to}`).join() === '_created:null>H1,status:null>To Do,story_points:null>1,status:To Do>In Progress,status:In Progress>To Do,story_points:1>2'
        && h1ev[0].at.toISOString() === '2026-02-01T09:00:00.000Z' && h1ev.every((e) => e.backfilled === true) && h1ev[3].actor === member.userId, h1ev.map((e) => [e.field, e.from, e.to, e.at]));
    const h2ev = await events({ task_id: h2._id });
    check('backfill: history at/after the first live event skipped (no duplicates)', h2ev.length === 4
        && h2ev.map((e) => `${e.field}:${e.from}>${e.to?.title || e.to}`).join() === '_created:null>H2,status:null>Backlog,status:Backlog>To Do,status:To Do>In Progress', h2ev.map((e) => [e.field, e.from, e.to]));
    const bd = (x) => r.data?.daily?.find((y) => y.date === x);
    check('backfill: reconstructed days', bd('2026-02-01')?.by_category.todo.issues === 1 && bd('2026-02-01').by_category.backlog.issues === 1
        && bd('2026-02-02').by_category.in_progress.points === 1 && bd('2026-02-04').by_category.todo.points === 2 && bd('2026-02-05').by_category.in_progress.issues === 1,
        r.data?.daily?.map((x) => [x.date, x.by_category]));
    const flag = (await db.collection('board').findOne({ _id: new ObjectId(hb._id) })).events_backfilled_at;
    const count = await db.collection('task_event').countDocuments({ board_id: hb._id });
    await call('GET', `/v1/board/analytics?board_id=${hb._id}`, o);
    await getBoard(hb._id);
    check('backfill: flag set, runs once', !!flag && (await db.collection('task_event').countDocuments({ board_id: hb._id })) === count);

    // --- Capacity ----------------------------------------------------------------------------------
    gb = (await getBoard(sb._id)).board;
    check('capacity: defaults when unset', JSON.stringify(gb.capacity) === JSON.stringify({ members: {}, policy: { safety_ceiling: 0.85, commitment_cap: 0.9 }, working_days: [1, 2, 3, 4, 5] }), gb.capacity);
    const capacity = {
        members: { [owner.userId]: { capacity_pts: 13, hours_per_day: 6, pto: ['2026-06-05'], role: 'dev', skills: ['api'] }, someone: { capacity_pts: 5 } },
        policy: { safety_ceiling: 1.2 },
        working_days: [5, 1, 2, 3, 4, 1],
    };
    r = await call('PUT', '/v1/board', { ...o, body: { id: sb._id, capacity } });
    check('capacity: PUT accepted, normalized', r.status === 200 && r.data.capacity.policy.safety_ceiling === 1.2 && r.data.capacity.policy.commitment_cap === 0.9
        && r.data.capacity.working_days.join() === '1,2,3,4,5' && r.data.capacity.members[owner.userId].capacity_pts === 13, r.json);
    gb = (await getBoard(sb._id)).board;
    check('capacity: returned by GET', gb.capacity.members[owner.userId].pto[0] === '2026-06-05' && gb.capacity.members.someone.capacity_pts === 5, gb.capacity);
    const bad = [
        { policy: { safety_ceiling: 1.6 } },
        { working_days: [7] },
        { members: { x: { pto: ['June 5'] } } },
        { members: { x: { capacity_pts: -1 } } },
        { members: { x: { hours_per_day: 30 } } },
        { members: { x: { skills: 'api' } } },
        { members: [] },
    ];
    const badRes = await Promise.all(bad.map((c) => call('PUT', '/v1/board', { ...o, body: { id: sb._id, capacity: c } })));
    check('capacity: invalid shapes 400', badRes.every((x) => x.status === 400), badRes.map((x) => x.status));
    r = await call('PUT', '/v1/board', { ...o, body: { id: sb._id, capacity: null } });
    check('capacity: null resets to defaults', r.status === 200 && r.data.capacity.policy.safety_ceiling === 0.85, r.data?.capacity);

    // --- notify on bulk reassign --------------------------------------------------------------------
    const nb = await mkBoard({ name: 'Notify Board' });
    const n1 = await mkTask(nb, { assignee: member.userId }, { title: 'N1' });
    const n2 = await mkTask(nb, {}, { title: 'N2' });
    const n3 = await mkTask(nb, { assignee: owner.userId }, { title: 'N3' });
    const notesAlt = () => db.collection('notification').find({ recipient_id: owner.userId, entity_id: { $in: [n1._id, n2._id, n3._id] } }).toArray();
    const before = (await notesAlt()).length;
    r = await bulk(nb, [{ id: n1._id, values: { assignee: owner.userId } }, { id: n2._id, values: { assignee: owner.userId } }, { id: n3._id, values: { status: 'Done' } }], {}, m);
    check('notify: without notify no notifications', r.status === 200 && (await notesAlt()).length === before, (await notesAlt()).length - before);
    r = await bulk(nb, [{ id: n1._id, values: { assignee: member.userId } }, { id: n2._id, values: { assignee: null } }], {}, m);
    r = await bulk(nb, [{ id: n1._id, values: { assignee: owner.userId } }, { id: n2._id, values: { assignee: owner.userId } }, { id: n3._id, values: { status: 'To Do' } }], { notify: true }, m);
    const got = (await notesAlt()).slice(before);
    check('notify: one notification per reassigned task, same type as single PUT', r.status === 200 && got.length === 2
        && got.every((n) => n.action === 'update' && n.entity_type === 'document' && n.actor_id === member.userId && n.metadata?.field === 'assignee')
        && got.some((n) => n.entity_id === n1._id) && got.some((n) => n.entity_id === n2._id), got.map((n) => [n.entity_id, n.action, n.entity_type]));
    const toActor = await db.collection('notification').countDocuments({ recipient_id: member.userId, entity_id: { $in: [n1._id, n2._id, n3._id] }, 'metadata.field': 'assignee' });
    check('notify: the actor is not notified', toActor === 0, toActor);
    r = await bulk(nb, [{ id: n3._id, values: { assignee: member.userId } }], { notify: true }, m);
    check('notify: self-assignment sends nothing', (await db.collection('notification').countDocuments({ entity_id: n3._id, 'metadata.field': 'assignee' })) === 0);
    r = await call('PUT', '/v1/board/tasks', { ...m, body: { board_id: nb._id, updates: [{ id: n1._id, sort_order: 1 }], notify: 'yes' } });
    check('notify: must be boolean', r.status === 400, r.status);

    // --- Private board write denial -------------------------------------------------------------------
    const priv = await mkBoard({ name: 'Private Plans', is_private: true });
    const pt = await mkTask(priv, { status: 'To Do' }, { title: 'Secret task' });
    const shared = await mkBoard({ name: 'Shared Private', is_private: true, shared_members: [member.userId] });
    const stTask = await mkTask(shared, {}, { title: 'Shared task' });
    r = await call('PUT', '/v1/board', { ...m, body: { id: priv._id, name: 'Hijacked' } });
    check('private: space member PUT /v1/board -> 404', r.status === 404, r.status);
    r = await call('PUT', '/v1/board', { ...m, body: { id: priv._id, capacity: { working_days: [1] } } });
    check('private: space member PUT capacity -> 404', r.status === 404, r.status);
    r = await call('DELETE', `/v1/board?id=${priv._id}`, m);
    check('private: space member DELETE /v1/board -> 404 and board kept', r.status === 404 && (await db.collection('board').findOne({ _id: new ObjectId(priv._id) }))?.name === 'Private Plans', r.status);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: pt._id, title: 'pwned' } });
    check('private: space member PUT task -> 404', r.status === 404, r.status);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: pt._id, board_id: priv._id, custom_meta_values: { status: 'Done' } } });
    check('private: space member PUT task with board_id -> 404', r.status === 404, r.status);
    r = await call('DELETE', `/v1/page/document?id=${pt._id}`, m);
    check('private: space member DELETE task -> 404 and task kept', r.status === 404 && !!(await db.collection('page_meta').findOne({ _id: new ObjectId(pt._id) })), r.status);
    const ptRow = await db.collection('page_meta').findOne({ _id: new ObjectId(pt._id) });
    check('private: task unchanged', ptRow.title === 'Secret task' && ptRow.custom_meta.values.status === 'To Do', ptRow.title);
    r = await bulk(priv, [{ id: pt._id, values: { status: 'Done' } }], {}, m);
    check('private: space member bulk PUT -> 404', r.status === 404, r.status);
    r = await call('DELETE', `/v1/board/tasks?board_id=${priv._id}&ids=${pt._id}`, m);
    check('private: space member bulk DELETE -> 404', r.status === 404, r.status);
    r = await call('GET', `/v1/board/analytics?board_id=${priv._id}`, m);
    check('private: analytics -> 404', r.status === 404, r.status);
    r = await call('POST', '/v1/board/sprint', { ...m, body: { board_id: priv._id, name: 'x' } });
    check('private: create sprint -> 404', r.status === 404, r.status);
    const privSprint = (await call('POST', '/v1/board/sprint', { ...o, body: { board_id: priv._id, name: 'Owner sprint' } })).data;
    r = await call('POST', '/v1/board/sprint/start', { ...m, body: { id: privSprint._id } });
    check('private: start sprint -> 404', r.status === 404, r.status);
    r = await call('DELETE', `/v1/board/sprint?id=${privSprint._id}`, m);
    check('private: delete sprint -> 404', r.status === 404, r.status);
    r = await call('GET', `/v1/page/document?id=${pt._id}`, m);
    check('private: middleware denies reading a task of a private board (404)', r.status === 404, r.status);
    r = await call('PUT', '/v1/board', { ...o, body: { id: priv._id, description: 'still mine' } });
    check('private: owner can PUT', r.status === 200 && r.data.description === 'still mine', r.status);
    r = await call('PUT', '/v1/page/document', { ...o, body: { id: pt._id, custom_meta_values: { status: 'In Progress' } } });
    check('private: owner can PUT task', r.status === 200, r.status);
    r = await call('PUT', '/v1/board', { ...m, body: { id: shared._id, description: 'member edit' } });
    check('private: shared member can PUT board', r.status === 200, r.json);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: stTask._id, custom_meta_values: { status: 'Done' } } });
    check('private: shared member can PUT task', r.status === 200, r.json);
    r = await call('PUT', '/v1/board', { ...as(outsider, outsider.ws), body: { id: sb._id, name: 'x' } });
    check('private: outsider PUT public board of another workspace -> 404', r.status === 404, r.status);
    r = await call('PUT', '/v1/board', { ...m, body: { id: sb._id, description: 'public ok' } });
    check('private: member can still PUT a public board', r.status === 200, r.status);
    r = await call('DELETE', `/v1/board?id=${shared._id}`, m);
    check('private: shared member can DELETE board', r.status === 200, r.status);

    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
