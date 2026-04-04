import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { workspace_id } = request.query;
        const userId = request.user.id;

        if (!workspace_id) {
            return response.status(400).json(formatErrorMessage('workspace_id is required'));
        }

        const workspace = await global.Workspace.findOne({ _id: workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (workspace.owner_id !== userId && !(workspace.members && workspace.members.includes(userId))) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        const result = await global.Team.find({ workspace_id });

        if (!result || result.length === 0) {
            return response.status(404).json(formatErrorMessage('No teams found for this workspace'));
        }

        response.json(formatSuccessMessage("Teams fetched successfully", result));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
