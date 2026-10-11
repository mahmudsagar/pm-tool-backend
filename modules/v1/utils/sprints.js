import { canUserAccessEntity } from './helper.js';
import { collection, toObjectId } from './boardTasks.js';
import { statusCategory, toPoints, taskValues } from './boardAnalytics.js';
import { pointsKeyFor } from './taskEvents.js';

/**
 * Sprints are documents (sprint collection); a task belongs to a sprint when
 * custom_meta.values.sprint holds the sprint _id.
 *
 * Legacy boards kept sprint NAMES in board.saved_view.scrum.sprint_management.sprints (+ active_sprint)
 * and in task values.sprint; ensureSprintsMigrated converts them once per board.
 */

export const todayString = () => new Date().toISOString().slice(0, 10);
export const addDaysTo = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);

/** Planned/active/closed sprints of a board: start_date asc (undated last), then createdAt. */
export const listSprints = async (boardId) => {
    const rows = await global.Sprint.find({ board_id: String(boardId) });
    const t = (v) => (v ? new Date(v).getTime() : 0);
    return rows.sort((a, b) => {
        const as = a.start_date || null;
        const bs = b.start_date || null;
        if (as !== bs) {
            if (as === null) return 1;
            if (bs === null) return -1;
            return as.localeCompare(bs);
        }
        return t(a.createdAt) - t(b.createdAt) || String(a._id).localeCompare(String(b._id));
    });
};

/**
 * Create sprint docs for legacy sprint names and rewrite task values.sprint to the new ids.
 * Claimed atomically with board.sprints_migrated_at. Returns true when it ran.
 */
export const ensureSprintsMigrated = async (board) => {
    if (board.sprints_migrated_at) return false;
    const now = new Date();
    const claim = await collection('board').updateOne(
        { _id: toObjectId(board._id), sprints_migrated_at: null },
        { $set: { sprints_migrated_at: now } },
    );
    board.sprints_migrated_at = now;
    if (!claim.modifiedCount) return false;

    try {
        const mgmt = board.saved_view?.scrum?.sprint_management || {};
        const nameOf = (s) => (s && typeof s === 'object' ? (s.name || s.label || '') : String(s ?? '')).trim();
        const legacy = (Array.isArray(mgmt.sprints) ? mgmt.sprints : []).map(nameOf).filter(Boolean);
        const active = nameOf(mgmt.active_sprint);

        const existing = await global.Sprint.find({ board_id: String(board._id) });
        const existingIds = new Set(existing.map((s) => String(s._id)));
        const tasks = await collection('page_meta')
            .find({ board_id: String(board._id), 'custom_meta.values.sprint': { $exists: true } }, { projection: { custom_meta: 1 } })
            .toArray();
        const taskNames = tasks
            .map((t) => taskValues(t).sprint)
            .filter((v) => typeof v === 'string' && v.trim() && !existingIds.has(v))
            .map((v) => v.trim());

        const names = [...new Set([...legacy, ...taskNames])];
        if (active && !names.includes(active)) names.push(active);
        if (!names.length) return true;

        const created = await global.Sprint.createEach(names.map((name) => ({
            workspace_id: String(board.workspace_id || ''),
            board_id: String(board._id),
            name,
            goal: '',
            start_date: null,
            end_date: null,
            status: name === active ? 'active' : 'planned',
            committed: null,
            closed: null,
            created_by: String(board.user_id || ''),
        }))).fetch();
        const idByName = new Map(created.map((s) => [s.name, String(s._id)]));

        const ops = [];
        for (const t of tasks) {
            const v = taskValues(t).sprint;
            if (typeof v !== 'string') continue;
            const id = idByName.get(v.trim());
            if (!id) continue;
            if (typeof t.custom_meta === 'string') {
                const meta = JSON.parse(t.custom_meta);
                meta.values = { ...(meta.values || {}), sprint: id };
                ops.push({ updateOne: { filter: { _id: t._id }, update: { $set: { custom_meta: meta } } } });
            } else {
                ops.push({ updateOne: { filter: { _id: t._id }, update: { $set: { 'custom_meta.values.sprint': id } } } });
            }
        }
        if (ops.length) await collection('page_meta').bulkWrite(ops, { ordered: false });

        // Events logged before the migration carry sprint names too.
        const eventOps = [];
        for (const [name, id] of idByName) {
            const scope = { board_id: String(board._id) };
            eventOps.push({ updateMany: { filter: { ...scope, field: 'sprint', from: name }, update: { $set: { from: id } } } });
            eventOps.push({ updateMany: { filter: { ...scope, field: 'sprint', to: name }, update: { $set: { to: id } } } });
            eventOps.push({ updateMany: { filter: { ...scope, 'to.values.sprint': name }, update: { $set: { 'to.values.sprint': id } } } });
        }
        if (eventOps.length) await collection('task_event').bulkWrite(eventOps, { ordered: false });
    } catch (err) {
        console.error(`Sprint migration failed for board ${board._id}:`, err.message);
    }
    return true;
};

/** Top-level tasks of the board whose values.sprint is `sprintId` (all tasks with subtasks: true). */
export const sprintTasks = async (boardId, sprintId, { subtasks = false } = {}) => {
    const rows = await collection('page_meta')
        .find({ board_id: String(boardId), 'custom_meta.values.sprint': String(sprintId) }, { projection: { custom_meta: 1, parent_id: 1, title: 1, task_number: 1 } })
        .toArray();
    return subtasks ? rows : rows.filter((t) => !t.parent_id);
};

/** { points, issues, task_ids } of top-level tasks, optionally only done / not done ones. */
export const summarize = (board, tasks) => {
    const pk = pointsKeyFor(board);
    return {
        points: tasks.reduce((sum, t) => sum + toPoints(taskValues(t)[pk]), 0),
        issues: tasks.length,
        task_ids: tasks.map((t) => String(t._id)),
    };
};

export const isDone = (task) => statusCategory(taskValues(task).status) === 'done';

/** Board in the request's workspace that the user may access (canUserAccessEntity), else null. */
export const loadAccessibleBoard = async (boardId, request) => {
    const board = await global.Board.findOne({ _id: String(boardId), workspace_id: request.workspaceId });
    if (!board || !(await canUserAccessEntity(board, request.user.id, request.workspaceId))) return null;
    return board;
};

/** { sprint, board } when the sprint exists and its board is accessible, else null. */
export const loadAccessibleSprint = async (sprintId, request) => {
    const sprint = await global.Sprint.findOne({ _id: String(sprintId) });
    if (!sprint) return null;
    const board = await loadAccessibleBoard(sprint.board_id, request);
    return board ? { sprint, board } : null;
};
