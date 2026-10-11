import { formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { expireIfNeeded } from '../utils/invitations.js';

// PUBLIC (no JWT): GET /v1/invitation?token= -> { workspace: { _id, name, logo }, email, role, status, expires_at }
// 404 when unknown, 410 when expired or revoked.
export default async (request, response) => {
    try {
        const token = typeof request.query.token === 'string' ? request.query.token.trim() : '';
        if (!/^[0-9a-f]{64}$/.test(token)) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }

        const found = await global.Invitation.find({ token }).limit(1);
        if (found.length === 0) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }
        const invitation = await expireIfNeeded(found[0]);

        const workspace = await global.Workspace.findOne({ _id: invitation.workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Invitation not found'));
        }
        if (invitation.status === 'expired') {
            return response.status(410).json(formatErrorMessage('Invitation has expired'));
        }
        if (invitation.status === 'revoked') {
            return response.status(410).json(formatErrorMessage('Invitation has been revoked'));
        }

        response.json(formatSuccessMessage('Invitation fetched successfully', {
            workspace: { _id: workspace._id, name: workspace.name, logo: workspace.logo || '' },
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expires_at: invitation.expires_at,
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
