import { z } from 'zod';
import { deleteSprintSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { loadAccessibleSprint, sprintTasks } from '../../utils/sprints.js';
import { bulkUpdateTasks } from '../../utils/taskBulkUpdate.js';

/**
 * DELETE /v1/board/sprint?id=
 * Clears values.sprint on its tasks (task events with reason "Sprint deleted") and removes the
 * sprint. An active sprint cannot be deleted (409).
 * → data: { deleted_id, cleared_task_ids }
 */
export default async (request, response) => {
    try {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const { id } = deleteSprintSchema.parse({ id: request.query.id || body.id });
        const found = await loadAccessibleSprint(id, request);
        if (!found) return response.status(404).json(formatErrorMessage('Sprint not found'));
        if (found.sprint.status === 'active') {
            return response.status(409).json(formatErrorMessage('An active sprint cannot be deleted; complete it first'));
        }

        const tasks = await sprintTasks(found.board._id, id, { subtasks: true });
        if (tasks.length) {
            await bulkUpdateTasks({
                board: found.board,
                updates: tasks.map((t) => ({ id: String(t._id), values: { sprint: null } })),
                userId: request.user.id,
                workspaceId: request.workspaceId,
                reason: 'Sprint deleted',
                enforceLocks: false,
            });
        }
        await global.Sprint.destroyOne({ _id: id });
        response.json(formatSuccessMessage('Sprint deleted successfully', { deleted_id: id, cleared_task_ids: tasks.map((t) => String(t._id)) }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
