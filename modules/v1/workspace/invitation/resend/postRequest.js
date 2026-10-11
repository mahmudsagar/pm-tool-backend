import { z } from 'zod';
import { invitationIdSchema } from '../../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { isWorkspaceAdmin } from '../../../utils/workspaceAccess.js';
import { newInvitationToken, newInvitationExpiry, serializeInvitation } from '../../../utils/invitations.js';

// POST /v1/workspace/invitation/resend { id } -> new token, expiry reset to now + 14 days
// (an expired invitation becomes pending again; accepted/revoked ones cannot be resent)
export default async (request, response) => {
    try {
        const { id } = invitationIdSchema.parse(request.body || {});

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can resend invitations'));
        }

        const invitation = await global.Invitation.findOne({ _id: id, workspace_id: workspace._id });
        if (!invitation) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }
        if (invitation.status === 'accepted' || invitation.status === 'revoked') {
            return response.status(400).json(formatErrorMessage(`Invitation was already ${invitation.status}`));
        }

        const result = await global.Invitation.updateOne({ _id: id }).set({
            token: newInvitationToken(),
            expires_at: newInvitationExpiry(),
            status: 'pending',
        });
        response.json(formatSuccessMessage('Invitation resent', serializeInvitation(result)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
