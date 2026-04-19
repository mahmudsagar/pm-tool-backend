import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

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

        if (workspace.owner_id !== userId && !(workspace.members && workspace.members.includes(userId))) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        // Get owner info
        const owner = await global.User.findOne({ _id: workspace.owner_id });
        const { password: _op, ...ownerWithoutPassword } = owner;
        ownerWithoutPassword.workspace_role = 'owner';

        // Get member info with roles
        const memberRoles = workspace.member_roles || [];
        const getRoleForUser = (userId) => {
            const entry = memberRoles.find(r => r.user_id === userId);
            return entry ? entry.role : 'member';
        };

        const memberUsers = [];
        if (workspace.members && workspace.members.length > 0) {
            for (const memberId of workspace.members) {
                const user = await global.User.findOne({ _id: memberId });
                if (user) {
                    const { password: _p, ...userWithoutPassword } = user;
                    userWithoutPassword.workspace_role = getRoleForUser(memberId);
                    memberUsers.push(userWithoutPassword);
                }
            }
        }

        if (search) {
            const term = search.toLowerCase();
            const matchesSearch = (u) =>
                (u.name && u.name.toLowerCase().includes(term)) ||
                (u.email && u.email.toLowerCase().includes(term));

            return response.json(formatSuccessMessage("Members fetched successfully", {
                owner: matchesSearch(ownerWithoutPassword) ? ownerWithoutPassword : null,
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
