import { z } from 'zod';
import { getTeamHealthSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';
import { buildBoardTeamHealth } from '../utils/teamHealthService.js';

function normalizeStory(doc) {
    return {
        sprint: doc.custom_meta?.values?.sprint || '',
        assignee: doc.custom_meta?.values?.assignee || '',
        story_points: doc.custom_meta?.values?.story_points || '',
    };
}

export default async (request, response) => {
    try {
        const { board_id: boardId } = getTeamHealthSchema.parse(request.query);
        const workspaceId = request.workspaceId;
        const viewerId = request.user.id;

        const board = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
        if (!board) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const hasAccess = await canUserAccessEntity(board, viewerId, workspaceId);
        if (!hasAccess) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        const teams = await global.Team.find({ workspace_id: workspaceId });
        const documents = await global.PageMeta.find({ board_id: boardId });
        const stories = documents.map(normalizeStory);
        const scrum = board.saved_view?.scrum || {};
        const standups = scrum.standups || [];
        const teamHealth = scrum.team_health || {};

        const health = buildBoardTeamHealth({
            stories,
            standups,
            sprintCfg: scrum.sprint_management || {},
            teamHealth,
            assigneeOptions: [],
            viewerId,
            teams,
            workspace,
        });

        const visibilityRules = await global.HealthVisibility.find({
            workspace_id: workspaceId,
            board_id: boardId,
        });

        response.json(formatSuccessMessage('Team health loaded', {
            ...health,
            health_visibility: visibilityRules,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            return response.status(400).json(formatErrorMessage(formattedErrors));
        }
        return response.status(400).json(formatErrorMessage(err.message));
    }
};
