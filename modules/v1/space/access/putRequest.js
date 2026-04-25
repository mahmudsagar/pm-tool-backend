import { z } from 'zod';
import { putSpaceAccessSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { getUserRoleInEntity } from '../../utils/helper.js';

// Role priority for resolving conflicts (higher = more permissive)
const ROLE_PRIORITY = { manager: 3, contributor: 2, viewer: 1 };

export default async (request, response) => {
    try {
        const body = request.body;
        const { id } = request.query;
        const userId = request.user.id;
        const workspaceId = request.workspaceId;

        if (!id) {
            return response.status(400).json(formatErrorMessage('Space ID is required'));
        }

        const space = await global.Space.findOne({ _id: id });
        if (!space) {
            return response.status(404).json(formatErrorMessage('Space not found'));
        }

        // Check if user is space owner or has Manager role
        const isOwner = space.user_id === userId;
        const userRole = getUserRoleInEntity(space, userId);
        const isManager = userRole === 'manager';

        // Also check workspace admin
        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        const wsRole = (workspace?.member_roles || []).find(r => r.user_id === userId);
        const isWsAdmin = workspace?.owner_id === userId || (wsRole && wsRole.role === 'admin');

        if (!isOwner && !isManager && !isWsAdmin) {
            return response.status(403).json(formatErrorMessage('Only space owner, managers, or workspace admins can manage access'));
        }

        const validatedData = putSpaceAccessSchema.parse(body);

        const updateData = {};
        const memberRoles = { ...space.member_roles };  // Preserve existing roles
        const teamRoles = { ...space.team_roles };      // Preserve existing roles
        
        if (validatedData.shared_teams !== undefined) {
            // Validate all team_ids exist and extract roles
            const teamIds = [];
            for (const teamAccess of validatedData.shared_teams) {
                const team = await global.Team.findOne({ _id: teamAccess.team_id });
                if (!team) {
                    return response.status(404).json(formatErrorMessage(`Team ${teamAccess.team_id} not found`));
                }
                
                // Check guest ceiling: if team lead is a guest, they can't be manager
                if (workspace && teamAccess.role === 'manager') {
                    const leadRole = (workspace.member_roles || {})[team.team_lead];
                    if (leadRole === 'guest') {
                        return response.status(400).json(formatErrorMessage(
                            `Team "${team.name}" lead is a Guest at workspace level and cannot be given Manager role`
                        ));
                    }
                }
                
                teamIds.push(teamAccess.team_id);
                teamRoles[teamAccess.team_id] = teamAccess.role;  // Store role separately
            }
            updateData.shared_teams = teamIds;
        }

        if (validatedData.shared_members !== undefined) {
            // Validate all user_ids exist and extract roles
            const memberIds = [];
            for (const memberAccess of validatedData.shared_members) {
                const user = await global.User.findOne({ _id: memberAccess.user_id });
                if (!user) {
                    return response.status(404).json(formatErrorMessage(`User ${memberAccess.user_id} not found`));
                }
                
                // Check guest ceiling
                if (workspace && memberAccess.role === 'manager') {
                    const memberWsRole = (workspace.member_roles || {})[memberAccess.user_id];
                    if (memberWsRole === 'guest') {
                        return response.status(400).json(formatErrorMessage(
                            `User is a Guest at workspace level and cannot be given Manager role on a space`
                        ));
                    }
                }
                
                memberIds.push(memberAccess.user_id);
                memberRoles[memberAccess.user_id] = memberAccess.role;  // Store role separately
            }
            updateData.shared_members = memberIds;
        }

        // Always update roles if we updated access
        if (Object.keys(updateData).length > 0) {
            if (validatedData.shared_teams !== undefined) {
                updateData.team_roles = teamRoles;
            }
            if (validatedData.shared_members !== undefined) {
                updateData.member_roles = memberRoles;
            }
        }

        const result = await global.Space.updateOne({ _id: id }).set(updateData);

        if (!result) {
            return response.status(404).json(formatErrorMessage('Space not found during update'));
        }

        // Build response with updated space
        const warnings = [];
        
        // Check if space has no manager
        const hasManager = (result.shared_members && result.shared_members.length > 0) || isOwner;
        if (!hasManager) {
            warnings.push({ message: 'Space has no Manager. Consider assigning one.' });
        }

        response.json(formatSuccessMessage("Space access updated successfully", { space: result, warnings }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
