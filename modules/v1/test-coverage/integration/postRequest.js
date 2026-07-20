import { z } from 'zod';
import { postTestCoverageIntegrationSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity } from '../../utils/helper.js';
import {
    buildWebhookUrl,
    generateWebhookToken,
    getBoardIntegration,
    hashWebhookToken,
    maskWebhookToken,
    serializeIntegrationStatus,
    updateBoardIntegration,
} from '../../utils/testCoverageIntegration.js';

async function issueToken(board, request) {
    const token = generateWebhookToken();
    const webhookTokenHash = await hashWebhookToken(token);
    const now = new Date().toISOString();

    await updateBoardIntegration(board, {
        enabled: true,
        webhook_token_hash: webhookTokenHash,
        token_preview: maskWebhookToken(token),
        enabled_at: getBoardIntegration(board).enabled_at || now,
        rotated_at: now,
    });

    return {
        token,
        webhook_url: buildWebhookUrl(request),
        token_preview: maskWebhookToken(token),
        message: 'Copy this token now. It will not be shown again.',
    };
}

export default async (request, response) => {
    try {
        const { board_id: boardId, action } = postTestCoverageIntegrationSchema.parse(request.body);
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

        if (action === 'disable') {
            await updateBoardIntegration(board, {
                enabled: false,
                webhook_token_hash: null,
                token_preview: '',
            });
            const refreshedBoard = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
            return response.json(formatSuccessMessage('Coverage integration disabled', serializeIntegrationStatus(refreshedBoard, request)));
        }

        const integration = getBoardIntegration(board);
        if (action === 'enable' && integration.enabled && integration.webhook_token_hash) {
            return response.status(400).json(formatErrorMessage('Coverage integration is already enabled. Rotate the token instead.'));
        }

        const issued = await issueToken(board, request);
        const refreshedBoard = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });

        response.json(formatSuccessMessage(
            action === 'rotate' ? 'Coverage token rotated' : 'Coverage integration enabled',
            {
                ...serializeIntegrationStatus(refreshedBoard, request),
                ...issued,
            }
        ));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            return response.status(400).json(formatErrorMessage(formattedErrors));
        }
        return response.status(400).json(formatErrorMessage(err.message));
    }
};
