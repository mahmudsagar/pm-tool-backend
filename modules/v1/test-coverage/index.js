import { z } from 'zod';
import { getTestCoverageSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';
import {
    buildRegressionReport,
    buildSprintCoverageSummary,
    normalizeStoriesFromBoard,
} from '../utils/testCoverageService.js';

export default async (request, response) => {
    try {
        const { board_id: boardId, sprint } = getTestCoverageSchema.parse(request.query);
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

        const query = { board_id: boardId };
        if (sprint) query.sprint_id = sprint;

        const snapshots = await global.TestCoverageSnapshot.find(query).sort('createdAt ASC');
        const documents = await global.PageMeta.find({ board_id: boardId });
        const stories = normalizeStoriesFromBoard(board, documents);

        const bySprint = buildSprintCoverageSummary(snapshots);
        const regressions = buildRegressionReport(stories, snapshots);

        const recentSnapshots = [...snapshots]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20)
            .map((snapshot) => ({
                _id: snapshot._id,
                sprint_id: snapshot.sprint_id,
                story_id: snapshot.story_id,
                branch: snapshot.branch,
                commit_sha: snapshot.commit_sha,
                coverage_percent: snapshot.coverage_percent,
                lines_covered: snapshot.lines_covered,
                lines_total: snapshot.lines_total,
                createdAt: snapshot.createdAt,
            }));

        response.json(formatSuccessMessage('Test coverage loaded', {
            by_sprint: bySprint,
            regressions,
            snapshots: recentSnapshots,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            return response.status(400).json(formatErrorMessage(formattedErrors));
        }
        return response.status(400).json(formatErrorMessage(err.message));
    }
};
