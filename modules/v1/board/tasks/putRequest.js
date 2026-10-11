import { z } from 'zod';
import { putBoardTasksSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity } from '../../utils/helper.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';
import { PAGE_LOCKED_MESSAGE } from '../../utils/pageLock.js';
import { collection, toObjectId, mergeValues, ensureBoardKey, ensureSortOrders } from '../../utils/boardTasks.js';
import { runWorkflowRules, valuesEqual } from '../../utils/boardAutomation.js';
import { detectMetaChanges } from '../../utils/history.js';
import { v4 as uuidv4 } from 'uuid';

const sameId = (a, b) => !!a && !!b && String(a) === String(b);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const HISTORY_FIELDS = ['title', 'subtitle', 'icon', 'doc_status', 'locked', 'custom_meta', 'shared_members', 'shared_teams', 'pinned', 'page_type'];

/** `$set` / `$unset` for a values patch, addressed as custom_meta.values.<key> (atomic per key). */
const valuesUpdate = (patch, set, unset) => {
    for (const [key, value] of Object.entries(patch || {})) {
        if (value === null) unset[`custom_meta.values.${key}`] = '';
        else set[`custom_meta.values.${key}`] = value;
    }
};

/**
 * PUT /v1/board/tasks
 * body: { board_id, updates: [{ id, values?, sort_order? }] }   (max 500)
 *
 * values are shallow-merged into each task's custom_meta.values with per-key $set/$unset, so
 * concurrent edits of different fields do not overwrite each other; null deletes a key.
 * All-or-nothing validation: unknown / foreign ids → 400 { data: { invalid_ids } };
 * value edits of tasks locked by someone else → 423 { data: { locked_ids } }.
 * → data: [{ _id, custom_meta, sort_order, task_number, task_key, last_updated_by, updatedAt }]
 */
export default async (request, response) => {
    try {
        const { board_id: boardId, updates } = putBoardTasksSchema.parse(request.body || {});
        const userId = String(request.user.id);
        const workspaceId = request.workspaceId;

        const board = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
        if (!board || !(await canUserAccessEntity(board, userId, workspaceId))) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const ids = updates.map((u) => u.id);
        const tasks = await global.PageMeta.find({ _id: { in: ids } });
        const byId = new Map(tasks.map((t) => [String(t._id), t]));
        const invalidIds = ids.filter((id) => !byId.has(id) || String(byId.get(id).board_id || '') !== String(boardId));
        if (invalidIds.length) {
            return response.status(400).json({
                ...formatErrorMessage(`Tasks not found in this board: ${invalidIds.join(', ')}`),
                data: { invalid_ids: invalidIds },
            });
        }

        // Lock rule (as PUT /v1/page/document): custom_meta of a locked page may only be changed
        // by its creator, the lock holder or a workspace admin. sort_order is not protected.
        let admin = null;
        const lockedIds = [];
        for (const u of updates) {
            const task = byId.get(u.id);
            if (task.locked !== true || !u.values) continue;
            const before = isPlainObject(task.custom_meta?.values) ? task.custom_meta.values : {};
            if (valuesEqual(before, mergeValues(before, u.values))) continue;
            if (sameId(task.user_id, userId) || sameId(task.locked_by, userId)) continue;
            if (admin === null) {
                admin = isWorkspaceAdmin(await global.Workspace.findOne({ _id: workspaceId }), userId);
            }
            if (!admin) lockedIds.push(u.id);
        }
        if (lockedIds.length) {
            return response.status(423).json({
                ...formatErrorMessage(`${PAGE_LOCKED_MESSAGE}: ${lockedIds.join(', ')}`),
                data: { locked_ids: lockedIds },
            });
        }

        // Rows whose custom_meta / values is not a sub-document (legacy string JSON, null) cannot
        // take dotted $set; rewrite those once as objects first.
        const repairs = [];
        for (const u of updates) {
            if (!u.values) continue;
            const task = byId.get(u.id);
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

        // History: one custom_meta_updated entry per task whose custom_meta changed (batched).
        try {
            const changed = updated
                .map((task) => ({ task, prev: byId.get(String(task._id)) }))
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

        const boardKey = await ensureBoardKey(board);
        const updatedById = new Map(updated.map((t) => [String(t._id), t]));
        const data = ids.map((id) => {
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

        response.json(formatSuccessMessage('Tasks updated successfully', data));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
