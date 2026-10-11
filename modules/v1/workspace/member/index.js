import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceMember, getMemberEntry, spaceIdsForUser } from '../../utils/workspaceAccess.js';

const toIso = (value) => (value ? new Date(value).toISOString() : null);

export default async (request, response) => {
    try {
        const workspace_id = request.workspaceId;
        const userId = request.user.id;
        const { search } = request.query;

        if (!workspace_id) {
            return response.status(400).json(formatErrorMessage('workspace_id is required'));
        }

        const workspace = await global.Workspace.findOne({ _id: workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (!isWorkspaceMember(workspace, userId)) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        const spaces = await global.Space.find({ workspace_id: workspace._id });

        // Common shape: user row (no password) + workspace-scoped fields
        const decorate = (user, extra) => {
            const { password: _p, ...rest } = user;
            return {
                ...rest,
                title: user.title || '',
                handle: user.handle || '',
                last_seen_at: user.last_seen_at || null,
                space_ids: spaceIdsForUser(spaces, user._id),
                ...extra,
            };
        };

        // Get owner info
        const owner = await global.User.findOne({ _id: workspace.owner_id });
        const ownerWithoutPassword = owner ? decorate(owner, {
            workspace_role: 'owner',
            status: 'active',
            joined_at: toIso(workspace.createdAt),
        }) : null;

        const memberUsers = [];
        const memberIds = workspace.members || [];
        if (memberIds.length > 0) {
            const users = await global.User.find({ _id: { in: memberIds } });
            const byId = new Map(users.map((u) => [String(u._id), u]));
            for (const memberId of memberIds) {
                const user = byId.get(String(memberId));
                if (!user) continue;
                const entry = getMemberEntry(workspace, memberId);
                memberUsers.push(decorate(user, {
                    workspace_role: entry?.role || 'member',
                    status: entry?.status === 'suspended' ? 'suspended' : 'active',
                    joined_at: entry?.joined_at || null,
                }));
            }
        }

        if (search) {
            const term = search.toLowerCase();
            const matchesSearch = (u) =>
                (u.name && u.name.toLowerCase().includes(term)) ||
                (u.email && u.email.toLowerCase().includes(term));

            return response.json(formatSuccessMessage("Members fetched successfully", {
                owner: ownerWithoutPassword && matchesSearch(ownerWithoutPassword) ? ownerWithoutPassword : null,
                members: memberUsers.filter(matchesSearch),
            }));
        }

        response.json(formatSuccessMessage("Members fetched successfully", {
            owner: ownerWithoutPassword,
            members: memberUsers
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
