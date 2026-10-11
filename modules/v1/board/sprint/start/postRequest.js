import { z } from 'zod';
import { startSprintSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { loadAccessibleSprint, sprintTasks, summarize, todayString, addDaysTo } from '../../../utils/sprints.js';
import { collection, toObjectId } from '../../../utils/boardTasks.js';

/**
 * POST /v1/board/sprint/start { id, start_date?, end_date? }
 * 409 when another sprint of the board is active, or this one is not planned.
 * Dates: body, else the sprint's own, else start = today (UTC) and end = start + 13 days.
 * committed = { points, issues, task_ids, at } of its top-level tasks.
 * → data: sprint
 */
export default async (request, response) => {
    try {
        const body = startSprintSchema.parse(request.body || {});
        const found = await loadAccessibleSprint(body.id, request);
        if (!found) return response.status(404).json(formatErrorMessage('Sprint not found'));
        const { sprint, board } = found;
        if (sprint.status !== 'planned') {
            return response.status(409).json(formatErrorMessage(`Sprint is already ${sprint.status}`));
        }
        const other = await global.Sprint.findOne({ board_id: String(board._id), status: 'active', _id: { '!=': String(sprint._id) } });
        if (other) {
            return response.status(409).json({ ...formatErrorMessage(`Sprint "${other.name}" is already active on this board`), data: { active_sprint_id: String(other._id) } });
        }

        const start = body.start_date || sprint.start_date || todayString();
        let end = body.end_date || (body.start_date ? null : sprint.end_date) || null;
        if (!end || end < start) {
            if (body.end_date) return response.status(400).json(formatErrorMessage('end_date must be on or after start_date'));
            end = addDaysTo(start, 13);
        }

        const tasks = await sprintTasks(board._id, sprint._id);
        const committed = { ...summarize(board, tasks), at: new Date() };
        // Conditional on status so two concurrent starts cannot both win.
        const res = await collection('sprint').updateOne(
            { _id: toObjectId(sprint._id), status: 'planned' },
            { $set: { status: 'active', start_date: start, end_date: end, committed, updatedAt: new Date() } },
        );
        if (!res.modifiedCount) return response.status(409).json(formatErrorMessage('Sprint was started concurrently'));
        const actives = await global.Sprint.find({ board_id: String(board._id), status: 'active' });
        if (actives.length > 1) {
            await collection('sprint').updateOne({ _id: toObjectId(sprint._id) }, { $set: { status: 'planned', committed: null } });
            return response.status(409).json(formatErrorMessage('Another sprint is already active on this board'));
        }
        response.json(formatSuccessMessage('Sprint started', await global.Sprint.findOne({ _id: String(sprint._id) })));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
