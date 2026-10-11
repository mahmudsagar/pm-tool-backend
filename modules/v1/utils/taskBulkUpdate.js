import { v4 as uuidv4 } from 'uuid';
import { isWorkspaceAdmin } from './workspaceAccess.js';
import { PAGE_LOCKED_MESSAGE } from './pageLock.js';
import { collection, toObjectId, mergeValues, ensureBoardKey, ensureSortOrders } from './boardTasks.js';
import { runWorkflowRules, valuesEqual } from './boardAutomation.js';
import { detectMetaChanges } from './history.js';
import { createDirectNotifications } from './notificationService.js';
import { changeEvents, recordTaskEvents } from './taskEvents.js';

const sameId = (a, b) => !!a && !!b && String(a) === String(b);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const HISTORY_FIELDS = ['title', 'subtitle', 'icon', 'doc_status', 'locked', 'custom_meta', 'shared_members', 'shared_teams', 'pinned', 'page_type'];

export class BulkUpdateError extends Error {
    constructor(status, message, data = undefined) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

/** `$set` / `$unset` for a values patch, addressed as custom_meta.values.<key> (atomic per key). */
const valuesUpdate = (patch, set, unset) => {
    for (const [key, value] of Object.entries(patch || {})) {
        if (value === null) unset[`custom_meta.values.${key}`] = '';
        else set[`custom_meta.values.${key}`] = value;
    }
};

/** Assignee value (id, [ids], { user_id | _id | id | value }) -> [ids]. */
export const assigneeIds = (value) => {
    const list = Array.isArray(value) ? value : (value === null || value === undefined || value === '' ? [] : [value]);
    return [...new Set(list.map((v) => (isPlainObject(v) ? (v.user_id || v._id || v.id || v.value) : v))
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map(String))];
};

/**
 * Apply value / sort_order updates to tasks of `board` (shared by PUT /v1/board/tasks and the
 * sprint endpoints). Values are merged per key with $set/$unset; workflow rules, history entries
 * and task events (one insertMany, tagged with `reason`) are written for changed tasks.
 *
 * updates: [{ id, values?, sort_order? }]
 * Throws BulkUpdateError(400, { invalid_ids }) / (423, { locked_ids }) before writing anything.
 * notify: one notification (action 'update', entity_type = page_type, like PUT /v1/page/document)
 * per task whose assignee changed, sent to the newly added assignee(s) (never to the actor).
 * Returns [{ _id, custom_meta, sort_order, task_number, task_key, last_updated_by, updatedAt }].
 */
export const bulkUpdateTasks = async ({
    board, updates, userId, workspaceId, reason = null, enforceLocks = true, notify = false, actorName = 'User',
}) => {
    userId = String(userId);
    const boardId = String(board._id);
    const ids = updates.map((u) => String(u.id));
    const tasks = await global.PageMeta.find({ _id: { in: ids } });
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const invalidIds = ids.filter((id) => !byId.has(id) || String(byId.get(id).board_id || '') !== boardId);
    if (invalidIds.length) {
        throw new BulkUpdateError(400, `Tasks not found in this board: ${invalidIds.join(', ')}`, { invalid_ids: invalidIds });
    }

    // Lock rule (as PUT /v1/page/document): custom_meta of a locked page may only be changed
    // by its creator, the lock holder or a workspace admin. sort_order is not protected.
    if (enforceLocks) {
        let admin = null;
        const lockedIds = [];
        for (const u of updates) {
            const task = byId.get(String(u.id));
            if (task.locked !== true || !u.values) continue;
            const before = isPlainObject(task.custom_meta?.values) ? task.custom_meta.values : {};
            if (valuesEqual(before, mergeValues(before, u.values))) continue;
            if (sameId(task.user_id, userId) || sameId(task.locked_by, userId)) continue;
            if (admin === null) {
                admin = isWorkspaceAdmin(await global.Workspace.findOne({ _id: workspaceId }), userId);
            }
            if (!admin) lockedIds.push(String(u.id));
        }
        if (lockedIds.length) {
            throw new BulkUpdateError(423, `${PAGE_LOCKED_MESSAGE}: ${lockedIds.join(', ')}`, { locked_ids: lockedIds });
        }
    }

    // Rows whose custom_meta / values is not a sub-document (legacy string JSON, null) cannot
    // take dotted $set; rewrite those once as objects first.
    const repairs = [];
    for (const u of updates) {
        if (!u.values) continue;
        const task = byId.get(String(u.id));
        let meta = task.custom_meta;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch { meta = {}; }
        }
        if (!isPlainObject(meta) || !isPlainObject(meta.values) || meta !== task.custom_meta) {
            const fixed = { ...(isPlainObject(meta) ? meta : {}), values: isPlainObject(meta?.values) ? meta.values : {} };
            repairs.push({ updateOne: { filter: { _id: toObjectId(u.id) }, update: { $set: { custom_meta: fixed } } } });
        }
    }
    if (repairs.length) await collection('page_meta').bulkWrite(repairs, { ordered: false });

    // Reordering: fill missing sort_order of the other tasks first, so they keep a position.
    if (updates.some((u) => u.sort_order !== undefined)) await ensureSortOrders(boardId);

    const now = new Date();
    const ops = updates.map((u) => {
        const set = { last_updated_by: userId, updatedAt: now };
        const unset = {};
        valuesUpdate(u.values, set, unset);
        if (u.sort_order !== undefined) set.sort_order = u.sort_order;
        const update = { $set: set };
        if (Object.keys(unset).length) update.$unset = unset;
        return { updateOne: { filter: { _id: toObjectId(u.id) }, update } };
    });
    await collection('page_meta').bulkWrite(ops, { ordered: false });

    let updated = await global.PageMeta.find({ _id: { in: ids } });

    // Board workflow rules, as on the single-task PUT (only for tasks whose values changed).
    const ruleOps = [];
    for (const task of updated) {
        const prev = byId.get(String(task._id));
        const prevValues = isPlainObject(prev.custom_meta?.values) ? prev.custom_meta.values : {};
        const nextValues = isPlainObject(task.custom_meta?.values) ? task.custom_meta.values : {};
        const ruled = runWorkflowRules(board, prevValues, nextValues);
        if (!ruled) continue;
        const set = {};
        for (const [k, v] of Object.entries(ruled)) {
            if (!valuesEqual(v, nextValues[k])) set[`custom_meta.values.${k}`] = v;
        }
        if (Object.keys(set).length) ruleOps.push({ updateOne: { filter: { _id: toObjectId(task._id) }, update: { $set: set } } });
    }
    if (ruleOps.length) {
        await collection('page_meta').bulkWrite(ruleOps, { ordered: false });
        updated = await global.PageMeta.find({ _id: { in: ids } });
    }

    const pairs = updated.map((task) => ({ task, prev: byId.get(String(task._id)) }));
    const valuesOf = (t) => {
        let meta = t.custom_meta;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch { meta = {}; }
        }
        return isPlainObject(meta?.values) ? meta.values : {};
    };

    // History: one custom_meta_updated entry per task whose custom_meta changed (batched).
    try {
        const changed = pairs
            .map(({ task, prev }) => ({ task, prev, changes: detectMetaChanges(prev, task, ['custom_meta']) }))
            .filter(({ changes }) => Object.keys(changes).length > 0);
        if (changed.length) {
            const history = await global.PageHistory.find({ page_id: { in: changed.map(({ task }) => String(task._id)) } }).select(['page_id', 'version']);
            const maxVersion = new Map();
            for (const h of history) {
                maxVersion.set(String(h.page_id), Math.max(maxVersion.get(String(h.page_id)) || 0, h.version || 0));
            }
            await global.PageHistory.createEach(changed.map(({ task, prev, changes }) => ({
                _id: uuidv4().replace(/-/g, '').slice(0, 24),
                page_id: String(task._id),
                page_content_id: task.page_content_id,
                user_id: userId,
                version: (maxVersion.get(String(task._id)) || 0) + 1,
                action: 'custom_meta_updated',
                content_snapshot: null,
                meta_snapshot: Object.fromEntries(HISTORY_FIELDS.filter((f) => prev[f] !== undefined).map((f) => [f, prev[f]])),
                changes,
            })));
        }
    } catch (historyErr) {
        console.error('Failed to record bulk task history:', historyErr.message);
    }

    // Task events: one insertMany for the whole request.
    await recordTaskEvents(pairs.flatMap(({ task, prev }) => changeEvents({
        board, task, before: valuesOf(prev), after: valuesOf(task), actor: userId, reason, at: now,
    })));

    if (notify) {
        // One notification per reassigned task, addressed to its new assignee(s); same action /
        // entity_type as PUT /v1/page/document sends ('update', page_type).
        for (const { task, prev } of pairs) {
            const before = assigneeIds(valuesOf(prev).assignee);
            const added = assigneeIds(valuesOf(task).assignee).filter((id) => !before.includes(id) && id !== userId);
            if (!added.length) continue;
            await createDirectNotifications({
                workspaceId,
                recipientIds: added,
                actorId: userId,
                action: 'update',
                entityType: task.page_type || 'page',
                entityId: String(task._id),
                entityName: task.title || 'Untitled',
                message: `${actorName} assigned you to "${task.title || 'Untitled'}"`,
                metadata: {
                    actor_name: actorName,
                    changes: ['custom_meta_values'],
                    field: 'assignee',
                    board_id: boardId,
                    previous_assignee: valuesOf(prev).assignee ?? null,
                    assignee: valuesOf(task).assignee ?? null,
                },
            });
        }
    }

    const boardKey = await ensureBoardKey(board);
    const updatedById = new Map(updated.map((t) => [String(t._id), t]));
    return ids.map((id) => {
        const t = updatedById.get(id);
        return {
            _id: t._id,
            custom_meta: t.custom_meta,
            sort_order: typeof t.sort_order === 'number' ? t.sort_order : null,
            task_number: t.task_number ?? null,
            task_key: t.task_number ? `${boardKey}-${t.task_number}` : null,
            last_updated_by: t.last_updated_by,
            updatedAt: t.updatedAt,
        };
    });
};
