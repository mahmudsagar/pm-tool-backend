import { z } from 'zod';
import { bulkMemberSchema } from '../../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { isWorkspaceAdmin, upsertMemberEntry } from '../../../utils/workspaceAccess.js';

// PUT /v1/workspace/member/bulk { user_ids, role?, status? } -> { updated }
// Skips the owner, the requester and ids that are not members.
export default async (request, response) => {
    try {
        const { user_ids, role, status } = bulkMemberSchema.parse(request.body || {});
        const userId = request.user.id;

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, userId)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can change member roles'));
        }

        const members = new Set(workspace.members || []);
        const targets = [...new Set(user_ids)].filter((id) => id !== workspace.owner_id && id !== userId && members.has(id));

        const patch = {};
        if (role) patch.role = role;
        if (status) patch.status = status;

        let memberRoles = workspace.member_roles || [];
        for (const id of targets) {
            memberRoles = upsertMemberEntry({ ...workspace, member_roles: memberRoles }, id, patch);
        }
        if (targets.length > 0) {
            await global.Workspace.updateOne({ _id: workspace._id }).set({ member_roles: memberRoles });
        }

        response.json(formatSuccessMessage('Members updated successfully', { updated: targets.length }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
