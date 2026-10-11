import { z } from 'zod';
import { archiveWorkspaceSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceOwner } from '../../utils/workspaceAccess.js';

// PUT /v1/workspace/archive { archived } -> set/clear archived_at on the X-Workspace-ID workspace (owner only).
export default async (request, response) => {
    try {
        const { archived } = archiveWorkspaceSchema.parse(request.body || {});

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceOwner(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can archive this workspace'));
        }

        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({
            archived_at: archived ? new Date().toISOString() : null,
        });

        response.json(formatSuccessMessage(archived ? 'Workspace archived' : 'Workspace unarchived', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
