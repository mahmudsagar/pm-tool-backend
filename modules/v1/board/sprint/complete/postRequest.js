import { z } from 'zod';
import { completeSprintSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { loadAccessibleSprint, sprintTasks, summarize, isDone } from '../../../utils/sprints.js';
import { bulkUpdateTasks } from '../../../utils/taskBulkUpdate.js';
import { SPRINT_COMPLETED_REASON } from '../../../utils/boardAnalytics.js';

/**
 * POST /v1/board/sprint/complete { id, move_to: 'backlog' | '<sprintId>' }
 * Only an active sprint can be completed (409 otherwise). move_to must be another planned or
 * active sprint of the same board (400 otherwise).
 * closed = { completed_points, completed_issues, completed_ids, spillover_ids, at } over its
 * top-level tasks (done category = completed). Unfinished tasks (subtasks included) get
 * values.sprint = move_to (null for backlog) through the bulk task update, so task events are
 * written with reason "Sprint completed".
 * → data: { sprint, moved_task_ids }
 */
export default async (request, response) => {
    try {
        const { id, move_to: moveTo } = completeSprintSchema.parse(request.body || {});
        const found = await loadAccessibleSprint(id, request);
        if (!found) return response.status(404).json(formatErrorMessage('Sprint not found'));
        const { sprint, board } = found;
        if (sprint.status !== 'active') {
            return response.status(409).json(formatErrorMessage(`Only an active sprint can be completed (this one is ${sprint.status})`));
        }
        let target = null;
        if (moveTo !== 'backlog') {
            target = await global.Sprint.findOne({ _id: moveTo, board_id: String(board._id) });
            if (!target || String(target._id) === String(sprint._id) || target.status === 'closed') {
                return response.status(400).json(formatErrorMessage('move_to must be another open sprint of this board or "backlog"'));
            }
        }

        const all = await sprintTasks(board._id, sprint._id, { subtasks: true });
        const topLevel = all.filter((t) => !t.parent_id);
        const done = topLevel.filter(isDone);
        const spill = topLevel.filter((t) => !isDone(t));
        const doneSummary = summarize(board, done);
        const closed = {
            completed_points: doneSummary.points,
            completed_issues: doneSummary.issues,
            completed_ids: doneSummary.task_ids,
            spillover_ids: spill.map((t) => String(t._id)),
            at: new Date(),
        };
        const [updatedSprint] = await global.Sprint.update({ _id: String(sprint._id), status: 'active' }, { status: 'closed', closed }).fetch();
        if (!updatedSprint) return response.status(409).json(formatErrorMessage('Sprint was completed concurrently'));

        const toMove = all.filter((t) => !isDone(t));
        if (toMove.length) {
            await bulkUpdateTasks({
                board,
                updates: toMove.map((t) => ({ id: String(t._id), values: { sprint: target ? String(target._id) : null } })),
                userId: request.user.id,
                workspaceId: request.workspaceId,
                reason: SPRINT_COMPLETED_REASON,
                enforceLocks: false,
            });
        }
        response.json(formatSuccessMessage('Sprint completed', { sprint: updatedSprint, moved_task_ids: toMove.map((t) => String(t._id)) }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
