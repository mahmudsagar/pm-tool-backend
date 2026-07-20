import { z } from 'zod';
import { getTestCoverageIntegrationSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity } from '../../utils/helper.js';
import { serializeIntegrationStatus } from '../../utils/testCoverageIntegration.js';

export default async (request, response) => {
    try {
        const { board_id: boardId } = getTestCoverageIntegrationSchema.parse(request.query);
        const workspaceId = request.workspaceId;
        const userId = request.user.id;

        const board = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
        if (!board) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const hasAccess = await canUserAccessEntity(board, userId, workspaceId);
        if (!hasAccess) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        response.json(formatSuccessMessage('Coverage integration loaded', serializeIntegrationStatus(board, request)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            return response.status(400).json(formatErrorMessage(formattedErrors));
        }
        return response.status(400).json(formatErrorMessage(err.message));
    }
};
