import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';
import { expireIfNeeded, serializeInvitation } from '../../utils/invitations.js';

// GET /v1/workspace/invitation -> pending (unexpired) invitations of the X-Workspace-ID workspace
export default async (request, response) => {
    try {
        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can view invitations'));
        }

        const rows = await global.Invitation.find({ workspace_id: workspace._id, status: 'pending' });
        const pending = (await Promise.all(rows.map(expireIfNeeded))).filter((inv) => inv.status === 'pending');

        const inviterIds = [...new Set(pending.map((inv) => inv.invited_by).filter(Boolean))];
        const inviters = inviterIds.length > 0
            ? await global.User.find({ where: { _id: { in: inviterIds } }, select: ['_id', 'name', 'email'] })
            : [];
        const byId = new Map(inviters.map((u) => [String(u._id), { _id: u._id, name: u.name, email: u.email }]));

        const data = pending
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .map((inv) => ({
                ...serializeInvitation(inv),
                invited_by: byId.get(String(inv.invited_by)) || null,
            }));

        response.json(formatSuccessMessage('Invitations fetched successfully', data));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
