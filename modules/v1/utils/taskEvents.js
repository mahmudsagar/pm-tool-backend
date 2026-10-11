import { collection, toObjectId } from './boardTasks.js';
import {
    boardFields, resolvePointsKey, taskValues, trackedValues, diffTrackedValues,
    computeTaskTimestamps, eventsByTask, TRACKED_FIELDS,
} from './boardAnalytics.js';

/**
 * Task event log (task_event collection): one row per change of a tracked task value
 * (status, story_points, sprint, assignee, epic, priority, blocked) plus lifecycle rows
 * (_created, _removed, _restored). Every write path collects its rows and stores them with one
 * insertMany; failures are logged and never block the request.
 *
 * Row: { workspace_id, board_id, task_id, field, from, to, at, actor, reason, backfilled }
 */

export const pointsKeyFor = (board) => resolvePointsKey(boardFields(board));

const toDate = (v) => {
    if (v instanceof Date) return v;
    const d = new Date(v ?? Date.now());
    return Number.isNaN(d.getTime()) ? new Date() : d;
};

const baseRow = ({ board, task, actor, at, reason }) => ({
    workspace_id: String(task.workspace_id || board?.workspace_id || ''),
    board_id: String(board?._id || task.board_id),
    task_id: String(task._id),
    actor: actor ? String(actor) : null,
    at: toDate(at),
    reason: reason || null,
    backfilled: false,
});

/** Snapshot stored on lifecycle rows so analytics can still name removed tasks. */
export const taskSnapshot = (task, pointsKey = 'story_points') => ({
    title: task.title || '',
    task_number: task.task_number ?? null,
    parent_id: task.parent_id ? String(task.parent_id) : null,
    created_at: task.createdAt ? toDate(task.createdAt) : null,
    values: trackedValues(taskValues(task), pointsKey),
});

/** Rows for the tracked values that differ between `before` and `after` (values objects). */
export const changeEvents = ({ board, task, before, after, actor, reason = null, at = new Date() }) =>
    diffTrackedValues(before, after, pointsKeyFor(board))
        .map((d) => ({ ...baseRow({ board, task, actor, at, reason }), ...d }));

/** `_created` row plus one row per initial tracked value (from = null). */
export const createdEvents = ({ board, task, actor, at }) => {
    const pk = pointsKeyFor(board);
    const when = at || task.createdAt || new Date();
    const base = baseRow({ board, task, actor, at: when });
    return [
        { ...base, field: '_created', from: null, to: taskSnapshot(task, pk) },
        ...diffTrackedValues({}, taskValues(task), pk).map((d) => ({ ...base, ...d })),
    ];
};

export const lifecycleEvents = ({ board, tasks, actor, field, reason = null, at = new Date() }) => {
    const pk = pointsKeyFor(board);
    return tasks.map((task) => ({ ...baseRow({ board, task, actor, at, reason }), field, from: null, to: taskSnapshot(task, pk) }));
};

export const recordTaskEvents = async (rows) => {
    if (!rows || rows.length === 0) return;
    try {
        await collection('task_event').insertMany(rows, { ordered: true });
    } catch (err) {
        console.error('Failed to record task events:', err.message);
    }
};

/** All events of a board, oldest first (optionally only some fields). */
export const loadBoardEvents = async (boardId, fields = null) => {
    const filter = { board_id: String(boardId) };
    if (fields) filter.field = { $in: fields };
    return collection('task_event')
        .find(filter, { projection: { workspace_id: 0, board_id: 0 } })
        .sort({ at: 1, _id: 1 })
        .toArray();
};

/**
 * Add completed_at / started_at / status_changed_at / blocked_at to every task row (mutates).
 * One events query for the whole board.
 */
export const decorateTaskTimestamps = async (board, tasks) => {
    if (!tasks.length) return;
    const events = await loadBoardEvents(board._id, ['status', 'blocked']);
    const byTask = eventsByTask(events);
    const pk = pointsKeyFor(board);
    for (const task of tasks) {
        Object.assign(task, computeTaskTimestamps(task, byTask.get(String(task._id)) || [], pk));
    }
};

const parseMeta = (m) => {
    if (typeof m === 'string') {
        try { return JSON.parse(m); } catch { return {}; }
    }
    return m && typeof m === 'object' ? m : {};
};

/**
 * One-time backfill of a board's event log from page_history (custom_meta changes) plus a
 * `_created` row (and initial values) at each task's createdAt. History entries at or after a
 * task's first live event are skipped (those changes were already logged). Claimed atomically
 * with board.events_backfilled_at so concurrent requests run it once. Returns true when it ran.
 */
export const ensureEventsBackfilled = async (board) => {
    if (board.events_backfilled_at) return false;
    const now = new Date();
    const claim = await collection('board').updateOne(
        { _id: toObjectId(board._id), events_backfilled_at: null },
        { $set: { events_backfilled_at: now } },
    );
    board.events_backfilled_at = now;
    if (!claim.modifiedCount) return false;

    try {
        const pk = pointsKeyFor(board);
        const tasks = await collection('page_meta')
            .find({ board_id: String(board._id) }, { projection: { title: 1, task_number: 1, parent_id: 1, createdAt: 1, custom_meta: 1, user_id: 1, workspace_id: 1, board_id: 1 } })
            .toArray();
        if (!tasks.length) return true;
        const ids = tasks.map((t) => String(t._id));

        const existing = await collection('task_event')
            .find({ board_id: String(board._id) }, { projection: { task_id: 1, field: 1, from: 1, at: 1 } })
            .sort({ at: 1, _id: 1 })
            .toArray();
        const existingByTask = eventsByTask(existing);

        const history = await collection('page_history')
            .find({ page_id: { $in: ids }, 'changes.custom_meta': { $exists: true } }, { projection: { page_id: 1, user_id: 1, changes: 1, createdAt: 1 } })
            .sort({ createdAt: 1 })
            .toArray();
        const historyByTask = new Map();
        for (const h of history) {
            const id = String(h.page_id);
            if (!historyByTask.has(id)) historyByTask.set(id, []);
            historyByTask.get(id).push(h);
        }

        // page_history may predate the sprint migration: map sprint names to sprint ids.
        const sprintDocs = await collection('sprint').find({ board_id: String(board._id) }, { projection: { name: 1 } }).toArray();
        const sprintIds = new Set(sprintDocs.map((sp) => String(sp._id)));
        const sprintByName = new Map(sprintDocs.map((sp) => [sp.name, String(sp._id)]));
        const mapSprint = (v) => (typeof v === 'string' && !sprintIds.has(v) && sprintByName.has(v.trim()) ? sprintByName.get(v.trim()) : v);
        const withSprintIds = (values) => (values && typeof values === 'object' && 'sprint' in values ? { ...values, sprint: mapSprint(values.sprint) } : values);

        const rows = [];
        for (const task of tasks) {
            const id = String(task._id);
            const live = existingByTask.get(id) || [];
            const cutoff = live.length ? new Date(live[0].at).getTime() : Infinity;
            const createdAt = task.createdAt ? toDate(task.createdAt) : null;

            const changes = [];
            for (const h of historyByTask.get(id) || []) {
                const at = toDate(h.createdAt);
                if (at.getTime() >= cutoff) continue;
                const change = h.changes?.custom_meta || {};
                const diffs = diffTrackedValues(withSprintIds(parseMeta(change.from).values), withSprintIds(parseMeta(change.to).values), pk);
                for (const d of diffs) changes.push({ ...baseRow({ board, task, actor: h.user_id, at }), ...d, backfilled: true });
            }

            if (!live.some((e) => e.field === '_created') && createdAt) {
                // Initial values: `from` of the first known change per field, else the current value.
                const initial = trackedValues(taskValues(task), pk);
                const seen = new Set();
                for (const e of [...changes, ...live]) {
                    if (!TRACKED_FIELDS.includes(e.field) || seen.has(e.field)) continue;
                    seen.add(e.field);
                    initial[e.field] = e.from ?? null;
                }
                const base = { ...baseRow({ board, task, actor: task.user_id, at: createdAt }), backfilled: true };
                rows.push({ ...base, field: '_created', from: null, to: { ...taskSnapshot(task, pk), values: initial } });
                for (const f of TRACKED_FIELDS) {
                    if (initial[f] !== null && initial[f] !== undefined) rows.push({ ...base, field: f, from: null, to: initial[f] });
                }
            }
            rows.push(...changes);
        }
        if (rows.length) await collection('task_event').insertMany(rows, { ordered: true });
    } catch (err) {
        console.error(`Task event backfill failed for board ${board._id}:`, err.message);
    }
    return true;
};
