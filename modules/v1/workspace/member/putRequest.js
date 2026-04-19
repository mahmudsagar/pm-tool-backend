import { z } from 'zod';
import { putMemberRoleSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();
        const workspace_id = request.workspaceId;

        const validatedData = putMemberRoleSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Only owner or admin can change roles
        const requesterRole = (workspace.member_roles || []).find(r => r.user_id === request.user.id);
        const isAdmin = workspace.owner_id === request.user.id || (requesterRole && requesterRole.role === 'admin');
        if (!isAdmin) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can change member roles'));
        }

        // Cannot change owner's role
        if (validatedData.user_id === workspace.owner_id) {
            return response.status(400).json(formatErrorMessage('Cannot change the workspace owner role'));
        }

        // Check target is actually a member
        const currentMembers = workspace.members || [];
        if (!currentMembers.includes(validatedData.user_id)) {
            return response.status(404).json(formatErrorMessage('User is not a member of this workspace'));
        }

        // Downgrading an admin: ensure at least one admin remains (owner is always admin implicitly)
        // This check only matters if someone tries to downgrade the last explicit admin
        // Owner is always implicitly admin, so this is just informational

        const currentRoles = workspace.member_roles || [];
        const updatedRoles = currentRoles.filter(r => r.user_id !== validatedData.user_id);
        updatedRoles.push({ user_id: validatedData.user_id, role: validatedData.role });

        const result = await global.Workspace.updateOne({ _id: workspace_id }).set({ member_roles: updatedRoles });

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
