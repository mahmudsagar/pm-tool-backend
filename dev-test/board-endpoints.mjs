#!/usr/bin/env node
/**
 * Board (databoard) checks: GET /v1/board access + enrichment, board keys and persistent task
 * numbers, sort order, counts, PUT /v1/board key, PUT/DELETE /v1/board/tasks, and the
 * custom_meta_values merge on PUT /v1/page/document.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   MONGODB_URI=mongodb://127.0.0.1:27999/boardtest PORT=3202 node server.js
 *   API_URL=http://127.0.0.1:3202 MONGODB_URI=mongodb://127.0.0.1:27999/boardtest node dev-test/board-endpoints.mjs
 *
 * MONGODB_URI is used directly (legacy rows for the lazy backfill, comment replies, attachments)
 * and must point at the same DB as the server.
 */
import { MongoClient, ObjectId } from 'mongodb';

const API = process.env.API_URL || 'http://127.0.0.1:3202';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27999/boardtest';
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
        body: { name: `Board ${label}`, email: `board-${label}-${stamp()}@example.test`, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    const own = res.data.workspaces.find((w) => w.owner_id === res.data.user_info._id);
    return { token: res.data.token, userId: res.data.user_info._id, email: res.data.user_info.email, name: res.data.user_info.name, ws: own._id };
};

const FIELDS = [
    { name: 'status', type: 'select', options: ['todo', 'doing', 'done'] },
    { name: 'priority', type: 'select', options: ['low', 'high'] },
];

const main = async () => {
    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();

    const owner = await register('owner');
    const member = await register('member');
    const outsider = await register('outsider');
    const as = (u, ws = owner.ws) => ({ token: u.token, ws });
    const o = as(owner);
    const m = as(member);

    let r = await call('POST', '/v1/workspace/member', { ...o, body: { email: member.email, role: 'member' } });
    check('setup: add member', r.status === 200, r.json);

    const spaceRes = await call('POST', '/v1/space', { ...o, body: { user_id: owner.userId, name: 'Board Space', is_private: false } });
    const space = Array.isArray(spaceRes.data) ? spaceRes.data[0] : spaceRes.data;

    const mkBoard = async (body, auth = o, userId = owner.userId) => {
        const res = await call('POST', '/v1/board', { ...auth, body: { user_id: userId, space_id: space._id, ...body } });
        return res;
    };
    const mkTask = async (board, body = {}, u = owner) => {
        const res = await call('POST', '/v1/page/document', {
            ...as(u),
            body: {
                user_id: u.userId, page_type: 'document', board_id: board._id, title: 'Task',
                custom_meta: { fields: FIELDS, values: { status: 'todo' } }, ...body,
            },
        });
        return res;
    };
    const getBoard = async (boardId, auth = o, query = '') => {
        const res = await call('GET', `/v1/board?id=${boardId}${query}`, auth);
        return { ...res, board: Array.isArray(res.data) ? res.data[0] : null };
    };
    const allTasks = (board) => board.documents.flatMap((d) => [d, ...(d.subtasks || [])]);

    // --- 1. Board keys ------------------------------------------------------------------------
    r = await mkBoard({ name: 'Engineering Core' });
    const eng = r.data;
    check('key: derived from multi-word name (EC)', r.status === 200 && eng?.key === 'EC' && eng.task_seq === 0, r.data);
    r = await mkBoard({ name: 'Platform' });
    check('key: derived from single word (PLAT)', r.status === 200 && r.data?.key === 'PLAT', r.data?.key);
    r = await mkBoard({ name: 'x' });
    check('key: fallback TASK', r.status === 200 && r.data?.key === 'TASK', r.data?.key);
    r = await mkBoard({ name: 'Ops board', key: 'ops1' });
    check('key: explicit key uppercased', r.status === 200 && r.data?.key === 'OPS1', r.data?.key);
    r = await mkBoard({ name: 'Bad', key: '1AB' });
    check('key: invalid explicit key on POST 400', r.status === 400, r.json);

    // --- 2. Access ----------------------------------------------------------------------------
    r = await getBoard(eng._id, as(outsider, outsider.ws));
    check('access: outsider (own workspace header) gets 404', r.status === 404, r.status);
    r = await getBoard(eng._id, as(outsider));
    check('access: outsider with foreign workspace header denied', r.status === 403 || r.status === 404, r.status);
    r = await getBoard(new ObjectId().toHexString(), o);
    check('access: unknown board 404', r.status === 404, r.status);
    const privRes = await mkBoard({ name: 'Secret Plans', is_private: true });
    r = await getBoard(privRes.data._id, m);
    check('access: member cannot see private board (404)', r.status === 404, r.status);
    r = await getBoard(privRes.data._id, o);
    check('access: owner sees private board', r.status === 200 && r.board?._id === privRes.data._id, r.status);
    r = await getBoard(eng._id, m);
    check('access: member sees public board', r.status === 200 && r.board?.key === 'EC', r.status);
    r = await call('GET', `/v1/board?user_id=${member.userId}`, m);
    check('access: list hides private board from member', r.status === 200 && !r.data.some((b) => b._id === privRes.data._id)
        && r.data.some((b) => b._id === eng._id), r.data?.map((b) => b.name));

    r = await call('POST', '/v1/page/document', { ...as(outsider, outsider.ws), body: { user_id: outsider.userId, page_type: 'document', board_id: eng._id, title: 'Intruder' } });
    check('access: outsider cannot create a task in the board (404)', r.status === 404, r.status);
    r = await call('POST', '/v1/page/document', { ...m, body: { user_id: member.userId, page_type: 'document', board_id: privRes.data._id, title: 'Sneaky' } });
    check('access: member cannot create a task in a private board', r.status === 404, r.status);
    check('access: no rows written for rejected creates', !(await db.collection('page_meta').findOne({ title: { $in: ['Intruder', 'Sneaky'] } })));

    // --- 3. Atomic numbering ------------------------------------------------------------------
    const N = 20;
    const created = await Promise.all(Array.from({ length: N }, (_, i) => mkTask(eng, { title: `Task ${i}` })));
    check('numbering: concurrent creates all 200', created.every((c) => c.status === 200), created.filter((c) => c.status !== 200).map((c) => c.json));
    const numbers = created.map((c) => c.data?.task_number).sort((a, b) => a - b);
    check('numbering: unique and contiguous 1..20', numbers.length === N && numbers.every((n, i) => n === i + 1), numbers);
    check('numbering: create response has task_key', created.every((c) => c.data.task_key === `EC-${c.data.task_number}`), created.map((c) => c.data.task_key));
    const tasks = created.map((c) => c.data).sort((a, b) => a.task_number - b.task_number);

    const parent = tasks[0];
    const subs = [];
    for (let i = 0; i < 3; i += 1) {
        r = await mkTask(eng, { title: `Sub ${i}`, parent_id: parent._id });
        subs.push(r.data);
    }
    check('numbering: subtasks created', subs.every((s) => s?._id), r.json);
    check('numbering: subtasks get the next numbers', subs.map((s) => s.task_number).join() === '21,22,23', subs.map((s) => s.task_number));
    check('sort: subtask sort_order is per parent', subs.map((s) => s.sort_order).join() === '1000,2000,3000', subs.map((s) => s.sort_order));

    r = await getBoard(eng._id);
    let b = r.board;
    check('get: board has key and task_seq', b.key === 'EC' && b.task_seq === 23, { key: b.key, seq: b.task_seq });
    const flat = allTasks(b);
    check('get: all tasks + subtasks present', flat.length === 23 && b.documents.length === 20, flat.length);
    check('get: every task has task_key/task_number/comment_count/attachment_count',
        flat.every((t) => t.task_key === `EC-${t.task_number}` && Number.isInteger(t.task_number)
            && t.comment_count === 0 && t.attachment_count === 0), flat.find((t) => !t.task_key));
    const parentInGet = b.documents.find((d) => d._id === parent._id);
    check('get: subtasks nested under parent with keys', parentInGet?.subtasks?.map((s) => s.task_key).join() === 'EC-21,EC-22,EC-23', parentInGet?.subtasks?.map((s) => s.task_key));

    // --- 4. Sort order ------------------------------------------------------------------------
    const sortOrders = b.documents.map((d) => d.sort_order);
    check('sort: new tasks get distinct-ish increasing sort_order (multiples of 1000)', sortOrders.every((s) => typeof s === 'number' && s % 1000 === 0), sortOrders);
    const isSorted = (docs) => docs.every((d, i) => i === 0 || docs[i - 1].sort_order < d.sort_order
        || (docs[i - 1].sort_order === d.sort_order && new Date(docs[i - 1].createdAt) <= new Date(d.createdAt)));
    check('sort: GET returns sort_order asc then createdAt', isSorted(b.documents), sortOrders);

    // Move the last task to the top, and the last subtask first.
    const last = b.documents[b.documents.length - 1];
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: last._id, sort_order: 1 }, { id: subs[2]._id, sort_order: 500 }] } });
    check('reorder: bulk sort_order 200', r.status === 200 && r.data?.find((t) => t._id === last._id)?.sort_order === 1, r.json);
    b = (await getBoard(eng._id)).board;
    check('reorder: moved task is first', b.documents[0]._id === last._id, b.documents.slice(0, 2).map((d) => d.title));
    check('reorder: moved subtask is first in parent', b.documents.find((d) => d._id === parent._id).subtasks[0]._id === subs[2]._id,
        b.documents.find((d) => d._id === parent._id).subtasks.map((s) => s.title));
    r = await mkTask(eng, { title: 'Appended' });
    b = (await getBoard(eng._id)).board;
    check('sort: new task lands at the end', b.documents[b.documents.length - 1]._id === r.data._id && r.data.task_number === 24, b.documents.slice(-1).map((d) => d.title));
    r = await getBoard(eng._id, o, '&sorts[0][field]=title&sorts[0][direction]=desc');
    check('sort: explicit sorts still override', r.status === 200 && r.board.documents[0].title === 'Task 19', r.board?.documents?.slice(0, 2).map((d) => d.title));
    r = await getBoard(eng._id, o, '&search=Sub%201');
    check('get: search still works', r.status === 200 && r.board.documents.length === 1 && r.board.documents[0].title === 'Sub 1', r.board?.documents?.map((d) => d.title));

    // --- 5. Counts ----------------------------------------------------------------------------
    const counted = tasks[1];
    const c1 = await call('POST', '/v1/comment', { ...o, body: { user_id: owner.userId, page_id: counted._id, comment_body: 'c1', content: { text: 'c1' } } });
    const c2 = await call('POST', '/v1/comment', { ...m, body: { user_id: member.userId, page_id: counted._id, comment_body: 'c2', content: { text: 'c2' } } });
    check('setup: comments created', c1.status === 200 && c2.status === 200, [c1.json, c2.json]);
    await db.collection('comment_meta').insertOne({ user_id: owner.userId, page_id: '', parent_id: c2.data?._id, associate_id: '', comment_body: 'reply', attachments: [], has_childs: false, createdAt: new Date(), updatedAt: new Date() });
    await call('POST', '/v1/comment', { ...o, body: { user_id: owner.userId, page_id: subs[0]._id, comment_body: 'on sub', content: { text: 'x' } } });
    await db.collection('page_meta').updateOne({ _id: new ObjectId(counted._id) }, { $set: { attachments: [new ObjectId().toHexString(), new ObjectId().toHexString()] } });
    b = (await getBoard(eng._id)).board;
    const countedInGet = allTasks(b).find((t) => t._id === counted._id);
    check('counts: comment_count = 2 threads + 1 reply (as page stats)', countedInGet.comment_count === 3, countedInGet.comment_count);
    const stats = await call('GET', `/v1/page/stats?id=${counted._id}`, o);
    check('counts: matches GET /v1/page/stats', stats.data?.comment_count === countedInGet.comment_count, stats.data?.comment_count);
    check('counts: subtask comment_count', allTasks(b).find((t) => t._id === subs[0]._id).comment_count === 1);
    check('counts: attachment_count', countedInGet.attachment_count === 2, countedInGet.attachment_count);
    check('counts: others zero', allTasks(b).filter((t) => t._id !== counted._id && t._id !== subs[0]._id).every((t) => t.comment_count === 0));

    // --- 6. Trashed tasks excluded ------------------------------------------------------------
    const trashed = tasks[2];
    r = await call('DELETE', `/v1/page/document?id=${trashed._id}`, o);
    check('trash: page delete 200', r.status === 200, r.json);
    b = (await getBoard(eng._id)).board;
    check('trash: deleted task gone from GET', !allTasks(b).some((t) => t._id === trashed._id), allTasks(b).length);
    r = await call('GET', '/v1/trash', o);
    check('trash: deleted task is in trash', r.data?.some((it) => it.entity_id === trashed._id && it.entity_type === 'page'), r.data?.map((i) => i.entity_id));
    r = await mkTask(eng, { title: 'After trash' });
    check('numbering: numbers never reused after delete', r.data?.task_number === 25, r.data?.task_number);

    // --- 7. PUT board key ---------------------------------------------------------------------
    r = await call('PUT', '/v1/board', { ...o, body: { id: eng._id, key: 'x' } });
    check('board key: too short 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board', { ...o, body: { id: eng._id, key: '9AB' } });
    check('board key: must start with a letter 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board', { ...o, body: { id: eng._id, key: 'TOOLONG' } });
    check('board key: > 6 chars 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board', { ...o, body: { id: eng._id, key: 'AB-C' } });
    check('board key: punctuation 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board', { ...o, body: { id: eng._id, key: 'eng2' } });
    check('board key: update uppercased', r.status === 200 && r.data?.key === 'ENG2', r.data?.key);
    b = (await getBoard(eng._id)).board;
    const parentAfter = allTasks(b).find((t) => t._id === parent._id);
    check('board key: displayed keys follow, numbers unchanged', b.key === 'ENG2' && parentAfter.task_key === `ENG2-${parent.task_number}`
        && allTasks(b).every((t) => t.task_key === `ENG2-${t.task_number}`), parentAfter.task_key);

    // --- 8. Lazy backfill for legacy boards ---------------------------------------------------
    const legacy = (await mkBoard({ name: 'Legacy Board' })).data;
    const legacyIds = [];
    for (let i = 0; i < 4; i += 1) {
        const t = (await mkTask(legacy, { title: `Legacy ${i}` })).data;
        legacyIds.push(t._id);
    }
    // Turn them into pre-feature rows: no key/task_seq on the board, no task_number/sort_order.
    const base = Date.now() - 100000;
    for (let i = 0; i < legacyIds.length; i += 1) {
        // createdAt order reversed relative to insert order to prove backfill uses createdAt
        await db.collection('page_meta').updateOne({ _id: new ObjectId(legacyIds[i]) },
            { $unset: { task_number: '', sort_order: '' }, $set: { createdAt: new Date(base + (legacyIds.length - i) * 1000) } });
    }
    await db.collection('board').updateOne({ _id: new ObjectId(legacy._id) }, { $unset: { key: '', task_seq: '' } });
    const [g1, g2] = await Promise.all([getBoard(legacy._id), getBoard(legacy._id)]);
    check('backfill: concurrent GETs succeed', g1.status === 200 && g2.status === 200, [g1.status, g2.status]);
    const legacyDb = await db.collection('board').findOne({ _id: new ObjectId(legacy._id) });
    check('backfill: key derived + persisted', g1.board.key === 'LB' && legacyDb.key === 'LB', legacyDb.key);
    const legacyRows = await db.collection('page_meta').find({ board_id: legacy._id }).sort({ createdAt: 1 }).toArray();
    const legacyNums = legacyRows.map((t) => t.task_number);
    check('backfill: numbers persisted, unique, follow createdAt', new Set(legacyNums).size === 4 && legacyNums.every((n, i) => i === 0 || n > legacyNums[i - 1]),
        legacyNums);
    const g3 = await getBoard(legacy._id);
    check('backfill: GET matches persisted numbers (stable)', legacyRows.every((row) => allTasks(g3.board).find((t) => t._id === String(row._id))?.task_number === row.task_number),
        allTasks(g3.board).map((t) => t.task_number));
    check('backfill: legacy tasks without sort_order ordered by createdAt', g3.board.documents.map((d) => d._id).join() === legacyRows.map((x) => String(x._id)).join(),
        g3.board.documents.map((d) => d.title));
    const afterBackfill = (await mkTask(legacy, { title: 'New after backfill' })).data;
    const seq = (await db.collection('board').findOne({ _id: new ObjectId(legacy._id) })).task_seq;
    check('backfill: next task continues after reserved block', afterBackfill.task_number === seq && afterBackfill.task_number > Math.max(...legacyNums), [afterBackfill.task_number, seq]);
    const g4 = await getBoard(legacy._id);
    check('backfill: new task appended after legacy tasks', g4.board.documents[g4.board.documents.length - 1]._id === afterBackfill._id
        && g4.board.documents.slice(0, 4).map((d) => d._id).join() === legacyRows.map((x) => String(x._id)).join(), g4.board.documents.map((d) => d.title));

    // --- 9. Bulk update merge -----------------------------------------------------------------
    const t1 = tasks[3];
    const t2 = tasks[4];
    const [u1, u2] = await Promise.all([
        call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t1._id, values: { status: 'doing' } }, { id: t2._id, values: { status: 'done' } }] } }),
        call('PUT', '/v1/board/tasks', { ...m, body: { board_id: eng._id, updates: [{ id: t1._id, values: { priority: 'high' } }, { id: t2._id, values: { priority: 'low', story_points: 5 } }] } }),
    ]);
    check('bulk: concurrent updates 200', u1.status === 200 && u2.status === 200, [u1.json, u2.json]);
    check('bulk: response shape', Array.isArray(u1.data) && u1.data.length === 2 && u1.data[0]._id === t1._id && 'custom_meta' in u1.data[0]
        && 'sort_order' in u1.data[0] && u1.data[0].task_key?.startsWith('ENG2-'), u1.data);
    b = (await getBoard(eng._id)).board;
    const v1 = allTasks(b).find((t) => t._id === t1._id).custom_meta;
    const v2 = allTasks(b).find((t) => t._id === t2._id).custom_meta;
    check('bulk: both concurrent field edits survive', v1.values.status === 'doing' && v1.values.priority === 'high'
        && v2.values.status === 'done' && v2.values.priority === 'low' && v2.values.story_points === 5, { v1: v1.values, v2: v2.values });
    check('bulk: custom_meta.fields intact', Array.isArray(v1.fields) && v1.fields.length === 2, v1.fields);
    const t1Row = await db.collection('page_meta').findOne({ _id: new ObjectId(t1._id) });
    check('bulk: last_updated_by set', [owner.userId, member.userId].includes(t1Row.last_updated_by), t1Row.last_updated_by);
    const hist = await db.collection('page_history').find({ page_id: t1._id, action: 'custom_meta_updated' }).toArray();
    check('bulk: history entries recorded with increasing versions', hist.length === 2 && new Set(hist.map((h) => h.version)).size === 2, hist.map((h) => h.version));

    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t1._id, values: { priority: null, labels: ['a', 'b'] } }] } });
    check('bulk: null deletes key', r.status === 200 && !('priority' in r.data[0].custom_meta.values)
        && r.data[0].custom_meta.values.status === 'doing' && r.data[0].custom_meta.values.labels.join() === 'a,b', r.data?.[0]?.custom_meta);

    // bad ids: foreign task (other board) + unknown id -> 400, nothing applied
    const foreign = afterBackfill;
    const unknown = new ObjectId().toHexString();
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t2._id, values: { status: 'todo' } }, { id: foreign._id, values: { status: 'x' } }, { id: unknown, values: { status: 'x' } }] } });
    check('bulk: bad ids -> 400 listing them', r.status === 400 && r.json?.data?.invalid_ids?.length === 2
        && r.json.data.invalid_ids.includes(foreign._id) && r.json.data.invalid_ids.includes(unknown), r.json);
    const t2Row = await db.collection('page_meta').findOne({ _id: new ObjectId(t2._id) });
    check('bulk: bad ids -> nothing applied', t2Row.custom_meta.values.status === 'done', t2Row.custom_meta.values);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: trashed._id, values: { status: 'x' } }] } });
    check('bulk: trashed id rejected', r.status === 400 && r.json?.data?.invalid_ids?.[0] === trashed._id, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: Array.from({ length: 501 }, () => ({ id: t1._id, sort_order: 1 })) } });
    check('bulk: > 500 updates 400', r.status === 400, r.status);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t1._id }] } });
    check('bulk: update without values/sort_order 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t1._id, values: { 'a.b': 1 } }] } });
    check('bulk: dotted value key 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: t1._id, sort_order: 5 }, { id: t1._id, sort_order: 6 }] } });
    check('bulk: duplicate ids 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...as(outsider, outsider.ws), body: { board_id: eng._id, updates: [{ id: t1._id, sort_order: 5 }] } });
    check('bulk: outsider denied', r.status === 403 || r.status === 404, r.status);
    r = await call('PUT', '/v1/board/tasks', { ...m, body: { board_id: privRes.data._id, updates: [{ id: t1._id, sort_order: 5 }] } });
    check('bulk: member denied on private board', r.status === 403 || r.status === 404, r.status);

    // legacy string custom_meta is repaired, values still merge
    await db.collection('page_meta').updateOne({ _id: new ObjectId(tasks[5]._id) }, { $set: { custom_meta: JSON.stringify({ fields: FIELDS, values: { status: 'todo', owner: 'z' } }) } });
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: tasks[5]._id, values: { status: 'done' } }] } });
    check('bulk: string custom_meta repaired and merged', r.status === 200 && r.data[0].custom_meta.values.status === 'done'
        && r.data[0].custom_meta.values.owner === 'z' && r.data[0].custom_meta.fields?.length === 2, r.json);

    // --- 10. Lock -> 423 ----------------------------------------------------------------------
    const lockedTask = tasks[6];
    r = await call('PUT', '/v1/page/document', { ...o, body: { id: lockedTask._id, locked: true } });
    check('lock: creator locks task', r.status === 200 && r.data.locked === true, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...m, body: { board_id: eng._id, updates: [{ id: t1._id, values: { status: 'todo' } }, { id: lockedTask._id, values: { status: 'done' } }] } });
    check('lock: member bulk edit of locked task -> 423 with locked_ids', r.status === 423 && r.json?.data?.locked_ids?.join() === lockedTask._id, r.json);
    const t1AfterLock = await db.collection('page_meta').findOne({ _id: new ObjectId(t1._id) });
    check('lock: 423 applies nothing', t1AfterLock.custom_meta.values.status === 'doing', t1AfterLock.custom_meta.values);
    r = await call('PUT', '/v1/board/tasks', { ...m, body: { board_id: eng._id, updates: [{ id: lockedTask._id, sort_order: 999999 }] } });
    check('lock: reorder of locked task allowed', r.status === 200, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...m, body: { board_id: eng._id, updates: [{ id: lockedTask._id, values: { status: 'todo' } }] } });
    check('lock: unchanged values on locked task allowed', r.status === 200, r.json);
    r = await call('PUT', '/v1/board/tasks', { ...o, body: { board_id: eng._id, updates: [{ id: lockedTask._id, values: { status: 'done' } }] } });
    check('lock: creator/admin may edit locked task', r.status === 200 && r.data[0].custom_meta.values.status === 'done', r.json);

    // --- 11. Single-task custom_meta_values merge ---------------------------------------------
    const single = tasks[7];
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: single._id, board_id: eng._id, custom_meta_values: { priority: 'high' } } });
    check('single: custom_meta_values merges', r.status === 200 && r.data.custom_meta.values.status === 'todo'
        && r.data.custom_meta.values.priority === 'high' && r.data.custom_meta.fields?.length === 2, r.json);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: single._id, custom_meta_values: { status: null }, sort_order: 42.5 } });
    check('single: null deletes key + sort_order accepted', r.status === 200 && !('status' in r.data.custom_meta.values)
        && r.data.custom_meta.values.priority === 'high' && r.data.sort_order === 42.5, r.data?.custom_meta);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: single._id, custom_meta_values: 'nope' } });
    check('single: invalid custom_meta_values 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: single._id, sort_order: 'x' } });
    check('single: invalid sort_order 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: single._id, custom_meta: { fields: FIELDS, values: { status: 'doing' } } } });
    check('single: plain custom_meta still replaces', r.status === 200 && r.data.custom_meta.values.status === 'doing' && !('priority' in r.data.custom_meta.values), r.data?.custom_meta);
    r = await call('PUT', '/v1/page/document', { ...m, body: { id: lockedTask._id, custom_meta_values: { status: 'todo' } } });
    check('single: custom_meta_values on locked task -> 423', r.status === 423, r.json);

    // --- 12. Bulk delete ----------------------------------------------------------------------
    r = await call('DELETE', `/v1/board/tasks?board_id=${eng._id}&ids=${tasks[8]._id},${unknown}`, o);
    check('delete: bad id -> 400, nothing deleted', r.status === 400 && r.json?.data?.invalid_ids?.join() === unknown
        && !!(await db.collection('page_meta').findOne({ _id: new ObjectId(tasks[8]._id) })), r.json);
    r = await call('DELETE', `/v1/board/tasks?board_id=${eng._id}&ids=${parent._id},${subs[1]._id},${tasks[8]._id}`, o);
    check('delete: query form 200', r.status === 200, r.json);
    const deletedIds = r.data?.deleted_ids || [];
    check('delete: parent, its subtasks and other task deleted', [parent._id, ...subs.map((s) => s._id), tasks[8]._id].every((id) => deletedIds.includes(id))
        && deletedIds.length === 5 && r.data.trash_item_ids.length === 2, r.data);
    b = (await getBoard(eng._id)).board;
    check('delete: gone from GET', !allTasks(b).some((t) => deletedIds.includes(t._id)), allTasks(b).length);
    r = await call('GET', '/v1/trash', o);
    const parentItem = r.data?.find((it) => it.entity_id === parent._id);
    check('delete: in trash as pages (parent item holds subtasks)', parentItem?.entity_type === 'page' && parentItem.item_count === 4
        && r.data.some((it) => it.entity_id === tasks[8]._id), r.data?.map((it) => [it.entity_id, it.item_count]));
    r = await call('DELETE', '/v1/board/tasks', { ...o, body: { board_id: eng._id, ids: [tasks[9]._id] } });
    check('delete: JSON body form 200', r.status === 200 && r.data?.deleted_ids?.join() === tasks[9]._id, r.json);
    r = await call('DELETE', `/v1/board/tasks?board_id=${eng._id}&ids=${tasks[10]._id}`, as(outsider, outsider.ws));
    check('delete: outsider denied', r.status === 403 || r.status === 404, r.status);

    // restore brings parent + subtasks back with their numbers
    r = await call('POST', '/v1/trash/restore', { ...o, body: { id: parentItem._id } });
    if (r.status === 404) r = await call('POST', `/v1/trash/restore?id=${parentItem._id}`, o);
    b = (await getBoard(eng._id)).board;
    const restored = b.documents.find((d) => d._id === parent._id);
    check('delete: restore from trash brings back task + subtasks with same keys', r.status === 200 && restored?.task_key === `ENG2-${parent.task_number}`
        && restored.subtasks.length === 3, { status: r.status, json: r.json, restored: restored?.task_key });

    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
