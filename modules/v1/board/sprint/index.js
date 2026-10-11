import { z } from 'zod';
import { getSprintsSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { loadAccessibleBoard, ensureSprintsMigrated, listSprints } from '../../utils/sprints.js';

/**
 * GET /v1/board/sprint?board_id=
 * → data: [sprint] sorted by start_date (undated last) then createdAt.
 * Legacy saved_view sprint names are migrated to sprint docs on first call.
 */
export default async (request, response) => {
    try {
        const { board_id: boardId } = getSprintsSchema.parse(request.query || {});
        const board = await loadAccessibleBoard(boardId, request);
        if (!board) return response.status(404).json(formatErrorMessage('Board not found'));
        await ensureSprintsMigrated(board);
        response.json(formatSuccessMessage('Sprints fetched successfully', await listSprints(boardId)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
