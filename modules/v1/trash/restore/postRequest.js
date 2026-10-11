import { z } from 'zod';
import { restoreTrashSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { restoreTrashItem, isWorkspaceAdmin, RestoreError } from '../../utils/trash.js';
import { lifecycleEvents, recordTaskEvents } from '../../utils/taskEvents.js';

// `_restored` task events for board tasks brought back by a page restore (whole-board restores
// bring their tasks back with the board and are not logged per task).
const logRestoredTasks = async (item, userId) => {
    if (item.entity_type !== 'page') return;
    const rows = (item.snapshot?.page_meta || []).filter((p) => p && p.board_id);
    if (!rows.length) return;
    const live = await global.PageMeta.find({ _id: { in: rows.map((p) => String(p._id)) } });
    const byBoard = new Map();
    for (const page of live) {
        if (!page.board_id) continue;
        if (!byBoard.has(page.board_id)) byBoard.set(page.board_id, []);
        byBoard.get(page.board_id).push(page);
    }
    const events = [];
    for (const [boardId, pages] of byBoard) {
        const board = await global.Board.findOne({ _id: boardId });
        if (board) events.push(...lifecycleEvents({ board, tasks: pages, actor: userId, field: '_restored' }));
    }
    await recordTaskEvents(events);
};

// POST /v1/trash/restore { id } — re-insert the snapshot (original _ids) and remove the trash item.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { id } = restoreTrashSchema.parse(request.body || {});

        const item = await global.TrashItem.findOne({ _id: id, workspace_id: workspaceId });
        if (!item) {
            return response.status(404).json(formatErrorMessage('Trash item not found'));
        }
        if (String(item.deleted_by) !== String(userId) && !(await isWorkspaceAdmin(workspaceId, userId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }
        if (item.expires_at && new Date(item.expires_at) < new Date()) {
            return response.status(410).json(formatErrorMessage('Trash item has expired'));
        }

        const result = await restoreTrashItem(item);
        try {
            await logRestoredTasks(item, userId);
        } catch (eventErr) {
            console.error('Failed to record restored task events:', eventErr.message);
        }
        response.json(formatSuccessMessage('Restored successfully', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else if (err instanceof RestoreError) {
            response.status(err.status).json(formatErrorMessage(err.message));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
