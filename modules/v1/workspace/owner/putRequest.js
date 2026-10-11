import { z } from 'zod';
import { transferOwnerSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceOwner, upsertMemberEntry } from '../../utils/workspaceAccess.js';

// PUT /v1/workspace/owner { user_id } -> transfer ownership of the X-Workspace-ID workspace.
// The previous owner stays on as an admin member; the new owner leaves members/member_roles.
export default async (request, response) => {
    try {
        const { user_id: targetId } = transferOwnerSchema.parse(request.body || {});
        const userId = request.user.id;

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceOwner(workspace, userId)) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can transfer ownership'));
        }
        if (targetId === userId) {
            return response.status(400).json(formatErrorMessage('You already own this workspace'));
        }
        if (!(workspace.members || []).includes(targetId)) {
            return response.status(404).json(formatErrorMessage('User is not a member of this workspace'));
        }

        const withoutTarget = {
            ...workspace,
            member_roles: (workspace.member_roles || []).filter((r) => r.user_id !== targetId),
        };
        const memberRoles = upsertMemberEntry(withoutTarget, userId, {
            role: 'admin',
            status: 'active',
            joined_at: workspace.createdAt ? new Date(workspace.createdAt).toISOString() : new Date().toISOString(),
        });
        const members = [...(workspace.members || []).filter((id) => id !== targetId && id !== userId), userId];

        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({
            owner_id: targetId,
            members,
            member_roles: memberRoles,
        });

        response.json(formatSuccessMessage('Ownership transferred successfully', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
