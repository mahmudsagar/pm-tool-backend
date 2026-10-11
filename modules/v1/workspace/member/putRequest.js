import { z } from 'zod';
import { putMemberRoleSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceAdmin, upsertMemberEntry } from '../../utils/workspaceAccess.js';

// PUT /v1/workspace/member { user_id, role?, status? } -> change a member's role and/or status.
export default async (request, response) => {
    try {
        const body = request.body;
        const workspace_id = request.workspaceId;

        const validatedData = putMemberRoleSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Only owner or admin can change roles / status
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can change member roles'));
        }

        // Cannot change owner's role
        if (validatedData.user_id === workspace.owner_id) {
            return response.status(400).json(formatErrorMessage('Cannot change the workspace owner role'));
        }

        if (validatedData.status === 'suspended' && validatedData.user_id === request.user.id) {
            return response.status(400).json(formatErrorMessage('You cannot suspend yourself'));
        }

        // Check target is actually a member
        const currentMembers = workspace.members || [];
        if (!currentMembers.includes(validatedData.user_id)) {
            return response.status(404).json(formatErrorMessage('User is not a member of this workspace'));
        }

        const patch = {};
        if (validatedData.role) patch.role = validatedData.role;
        if (validatedData.status) patch.status = validatedData.status;

        const result = await global.Workspace.updateOne({ _id: workspace_id }).set({
            member_roles: upsertMemberEntry(workspace, validatedData.user_id, patch),
        });

        response.json(formatSuccessMessage("Member role updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
