import { z } from 'zod';
import { postTestCoverageWebhookSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import {
    findStoryForBranch,
    normalizeStoriesFromBoard,
    resolveSprintId,
} from '../../utils/testCoverageService.js';
import {
    extractWebhookToken,
    getBoardIntegration,
    updateBoardIntegration,
    verifyWebhookToken,
} from '../../utils/testCoverageIntegration.js';

async function verifyBoardWebhookToken(request, board, body = {}) {
    const integration = getBoardIntegration(board);
    if (!integration.enabled || !integration.webhook_token_hash) {
        return false;
    }
    const provided = extractWebhookToken(request, body);
    return verifyWebhookToken(provided, integration.webhook_token_hash);
}

export default async (request, response) => {
    try {
        const validated = postTestCoverageWebhookSchema.parse(request.body);
        const board = await global.Board.findOne({ _id: validated.board_id });
        if (!board) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const tokenValid = await verifyBoardWebhookToken(request, board, request.body);
        if (!tokenValid) {
            return response.status(401).json(formatErrorMessage('Invalid or missing coverage webhook token'));
        }

        const documents = await global.PageMeta.find({ board_id: validated.board_id });
        const stories = normalizeStoriesFromBoard(board, documents);
        const matchedStory = findStoryForBranch(stories, validated.branch);
        const sprintId = resolveSprintId(board, matchedStory);

        const snapshot = await global.TestCoverageSnapshot.create({
            board_id: validated.board_id,
            workspace_id: board.workspace_id || null,
            sprint_id: sprintId || null,
            story_id: matchedStory?._id || null,
            branch: validated.branch,
            commit_sha: validated.commit_sha || null,
            coverage_percent: validated.coverage_percent,
            lines_covered: validated.lines_covered ?? null,
            lines_total: validated.lines_total ?? null,
            file_coverage: validated.file_coverage || {},
        }).fetch();

        await updateBoardIntegration(board, {
            last_received_at: new Date().toISOString(),
        });

        response.json(formatSuccessMessage('Coverage snapshot recorded', {
            snapshot,
            matched_story_id: matchedStory?._id || null,
            sprint_id: sprintId || null,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            return response.status(400).json(formatErrorMessage(formattedErrors));
        }
        return response.status(400).json(formatErrorMessage(err.message));
    }
};
