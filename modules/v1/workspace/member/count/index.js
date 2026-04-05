import { formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';

export default async (request, response) => {
    try {
        const workspace_id = request.workspaceId;
        const userId = request.user.id;

        if (workspace_id) {
            const workspace = await global.Workspace.findOne({ _id: workspace_id });
            if (!workspace) {
                return response.status(404).json(formatErrorMessage('Workspace not found'));
            }

            if (workspace.owner_id !== userId && !(workspace.members && workspace.members.includes(userId))) {
                return response.status(403).json(formatErrorMessage('Access denied'));
            }

            // Count: owner (1) + members
            const count = 1 + (workspace.members ? workspace.members.length : 0);
            return response.json(formatSuccessMessage("Member count fetched successfully", { count }));
        }

        // No workspace_id: sum across all workspaces owned by this user
        const ownedWorkspaces = await global.Workspace.find({ owner_id: userId });
        let totalCount = 0;
        for (const ws of ownedWorkspaces) {
            // owner (1) + members
            totalCount += 1 + (ws.members ? ws.members.length : 0);
        }

        response.json(formatSuccessMessage("Total member count fetched successfully", { count: totalCount }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
