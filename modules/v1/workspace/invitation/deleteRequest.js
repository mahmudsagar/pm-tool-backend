import { z } from 'zod';
import { invitationIdSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';
import { serializeInvitation } from '../../utils/invitations.js';

// DELETE /v1/workspace/invitation?id= -> revoke
export default async (request, response) => {
    try {
        const { id } = invitationIdSchema.parse(request.query);

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can revoke invitations'));
        }

        const invitation = await global.Invitation.findOne({ _id: id, workspace_id: workspace._id });
        if (!invitation) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }
        if (invitation.status === 'accepted') {
            return response.status(400).json(formatErrorMessage('Invitation was already accepted'));
        }

        const result = await global.Invitation.updateOne({ _id: id }).set({ status: 'revoked' });
        response.json(formatSuccessMessage('Invitation revoked', serializeInvitation(result)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
