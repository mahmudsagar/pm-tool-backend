import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { expireIfNeeded, acceptInvitation, normalizeEmail } from '../../utils/invitations.js';

// POST /v1/invitation/accept { token } (authenticated; X-Workspace-ID not required) -> { workspace }
export default async (request, response) => {
    try {
        const token = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
        if (!token) {
            return response.status(400).json(formatErrorMessage('token is required'));
        }

        const found = /^[0-9a-f]{64}$/.test(token) ? await global.Invitation.find({ token }).limit(1) : [];
        if (found.length === 0) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }
        const invitation = await expireIfNeeded(found[0]);

        const user = await global.User.findOne({ _id: request.user.id });
        if (!user) {
            return response.status(401).json(formatErrorMessage('User not found'));
        }

        if (invitation.status === 'accepted') {
            if (String(invitation.accepted_by) === String(user._id)) {
                const workspace = await global.Workspace.findOne({ _id: invitation.workspace_id });
                if (workspace) return response.json(formatSuccessMessage('Invitation already accepted', { workspace }));
            }
            return response.status(410).json(formatErrorMessage('Invitation has already been used'));
        }
        if (invitation.status === 'expired') {
            return response.status(410).json(formatErrorMessage('Invitation has expired'));
        }
        if (invitation.status === 'revoked') {
            return response.status(410).json(formatErrorMessage('Invitation has been revoked'));
        }

        if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
            return response.status(403).json(formatErrorMessage('This invitation was sent to a different email address'));
        }

        const workspace = await acceptInvitation(invitation, user);
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace no longer exists'));
        }

        response.json(formatSuccessMessage('Invitation accepted', { workspace }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
