import { z } from 'zod';
import { postSprintSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { loadAccessibleBoard, ensureSprintsMigrated } from '../../utils/sprints.js';

/**
 * POST /v1/board/sprint { board_id, name, goal?, start_date?, end_date? }
 * → data: sprint (status 'planned')
 */
export default async (request, response) => {
    try {
        const body = postSprintSchema.parse(request.body || {});
        const board = await loadAccessibleBoard(body.board_id, request);
        if (!board) return response.status(404).json(formatErrorMessage('Board not found'));
        await ensureSprintsMigrated(board);

        const sprint = await global.Sprint.create({
            workspace_id: String(board.workspace_id || request.workspaceId),
            board_id: String(board._id),
            name: body.name,
            goal: body.goal || '',
            start_date: body.start_date || null,
            end_date: body.end_date || null,
            status: 'planned',
            committed: null,
            closed: null,
            created_by: String(request.user.id),
        }).fetch();
        response.json(formatSuccessMessage('Sprint created successfully', sprint));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
