import { z } from 'zod';
import { deleteMemberSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { user_id } = request.query;
        const workspace_id = request.workspaceId;

        const validatedParams = deleteMemberSchema.parse({ workspace_id, user_id });

        const workspace = await global.Workspace.findOne({ _id: validatedParams.workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Allow admins to remove members too
        const requesterRole = (workspace.member_roles || []).find(r => r.user_id === request.user.id);
        const isAdmin = workspace.owner_id === request.user.id || (requesterRole && requesterRole.role === 'admin');
        if (!isAdmin) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can remove members'));
        }

        if (validatedParams.user_id === workspace.owner_id) {
            return response.status(400).json(formatErrorMessage('Cannot remove the workspace owner'));
        }

        // If an admin tries to remove themselves, check they are not the last admin
        if (validatedParams.user_id === request.user.id) {
            const adminCount = (workspace.member_roles || []).filter(r => r.role === 'admin').length;
            // Owner is always implicitly admin, so self-removal is fine as long as owner exists
        }

        const currentMembers = workspace.members || [];
        if (!currentMembers.includes(validatedParams.user_id)) {
            return response.status(404).json(formatErrorMessage('User is not a member of this workspace'));
        }

        const updatedMembers = currentMembers.filter(id => id !== validatedParams.user_id);
        const updatedRoles = (workspace.member_roles || []).filter(r => r.user_id !== validatedParams.user_id);

        // Clean up: remove from teams in this workspace
        const teams = await global.Team.find({ workspace_id: workspace._id });
        const affectedTeams = [];
        for (const team of teams) {
            let changed = false;
            const updatedSharedMembers = (team.shared_members || []).filter(id => {
                if (id === validatedParams.user_id) { changed = true; return false; }
                return true;
            });
            const updates = {};
            if (changed) updates.shared_members = updatedSharedMembers;
            if (team.team_lead === validatedParams.user_id) {
                updates.team_lead = null;
                affectedTeams.push({ team_id: team._id, team_name: team.name, was_lead: true });
            }
            if (Object.keys(updates).length > 0) {
                await global.Team.updateOne({ _id: team._id }).set(updates);
            }
        }

        // Clean up: remove from space access in this workspace
        const spaces = await global.Space.find({ workspace_id: workspace._id });
        const affectedSpaces = [];
        for (const space of spaces) {
            const updates = {};
            if (space.space_lead === validatedParams.user_id) {
                updates.space_lead = null;
                affectedSpaces.push({ space_id: space._id, space_name: space.name, was_lead: true });
            }
            // Remove from shared_members (handle both legacy string[] and new object[] formats)
            if (Array.isArray(space.shared_members) && space.shared_members.length > 0) {
                if (typeof space.shared_members[0] === 'string') {
                    const filtered = space.shared_members.filter(id => id !== validatedParams.user_id);
                    if (filtered.length !== space.shared_members.length) updates.shared_members = filtered;
                } else {
                    const filtered = space.shared_members.filter(m => m.user_id !== validatedParams.user_id);
                    if (filtered.length !== space.shared_members.length) updates.shared_members = filtered;
                }
            }
            if (Object.keys(updates).length > 0) {
                await global.Space.updateOne({ _id: space._id }).set(updates);
            }
        }

        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({ 
            members: updatedMembers,
            member_roles: updatedRoles,
        });

        response.json(formatSuccessMessage("Member removed successfully", {
            ...result,
            affected_teams: affectedTeams,
            affected_spaces: affectedSpaces,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
