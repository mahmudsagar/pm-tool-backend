import { z } from 'zod';
import { putBoardTasksSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity } from '../../utils/helper.js';
import { bulkUpdateTasks, BulkUpdateError } from '../../utils/taskBulkUpdate.js';

/**
 * PUT /v1/board/tasks
 * body: { board_id, updates: [{ id, values?, sort_order? }], reason?, notify? }   (max 500)
 *
 * values are shallow-merged into each task's custom_meta.values with per-key $set/$unset, so
 * concurrent edits of different fields do not overwrite each other; null deletes a key.
 * reason (optional) is stored on the task events written for this request; notify: true sends
 * one notification per task whose assignee changed.
 * All-or-nothing validation: unknown / foreign ids → 400 { data: { invalid_ids } };
 * value edits of tasks locked by someone else → 423 { data: { locked_ids } }.
 * → data: [{ _id, custom_meta, sort_order, task_number, task_key, last_updated_by, updatedAt }]
 */
export default async (request, response) => {
    try {
        const { board_id: boardId, updates, reason, notify } = putBoardTasksSchema.parse(request.body || {});
        const userId = String(request.user.id);
        const workspaceId = request.workspaceId;

        const board = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
        if (!board || !(await canUserAccessEntity(board, userId, workspaceId))) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const data = await bulkUpdateTasks({
            board, updates, userId, workspaceId,
            reason: reason || null,
            notify: notify === true,
            actorName: request.user.name || 'User',
        });
        response.json(formatSuccessMessage('Tasks updated successfully', data));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else if (err instanceof BulkUpdateError) {
            response.status(err.status).json({ ...formatErrorMessage(err.message), ...(err.data ? { data: err.data } : {}) });
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
