import { z } from 'zod';
import { archiveSpaceSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { getUserRoleInEntity } from '../../utils/helper.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';

// PUT /v1/space/archive { id, archived } -> set/clear archived_at.
// Allowed: space creator, a space 'manager', or an admin of the space's workspace.
export default async (request, response) => {
    try {
        const { id, archived } = archiveSpaceSchema.parse(request.body || {});
        const userId = request.user.id;

        const space = await global.Space.findOne({ _id: id });
        if (!space || (request.workspaceId && space.workspace_id && space.workspace_id !== request.workspaceId)) {
            return response.status(404).json(formatErrorMessage('Space not found'));
        }

        const workspace = space.workspace_id ? await global.Workspace.findOne({ _id: space.workspace_id }) : null;
        const allowed = space.user_id === userId
            || getUserRoleInEntity(space, userId) === 'manager'
            || isWorkspaceAdmin(workspace, userId);
        if (!allowed) {
            return response.status(403).json(formatErrorMessage('Only the space owner, managers, or workspace admins can archive this space'));
        }

        const result = await global.Space.updateOne({ _id: id }).set({
            archived_at: archived ? new Date().toISOString() : null,
        });

        response.json(formatSuccessMessage(archived ? 'Space archived' : 'Space unarchived', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
