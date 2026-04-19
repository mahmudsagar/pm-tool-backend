import { z } from 'zod';
import { putSpaceAccessSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

// Role priority for resolving conflicts (higher = more permissive)
const ROLE_PRIORITY = { manager: 3, contributor: 2, viewer: 1 };

export default async (request, response) => {
    try {
        const body = await request.json();
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
        let isManager = false;
        if (!isOwner && Array.isArray(space.shared_members)) {
            const memberEntry = space.shared_members.find(m => 
                (typeof m === 'string' ? m : m.user_id) === userId
            );
            if (memberEntry && typeof memberEntry === 'object' && memberEntry.role === 'manager') {
                isManager = true;
            }
        }

        // Also check workspace admin
        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        const wsRole = (workspace?.member_roles || []).find(r => r.user_id === userId);
        const isWsAdmin = workspace?.owner_id === userId || (wsRole && wsRole.role === 'admin');

        if (!isOwner && !isManager && !isWsAdmin) {
            return response.status(403).json(formatErrorMessage('Only space owner, managers, or workspace admins can manage access'));
        }

        const validatedData = putSpaceAccessSchema.parse(body);

        const updateData = {};
        
        if (validatedData.shared_teams !== undefined) {
            // Validate all team_ids exist
            for (const teamAccess of validatedData.shared_teams) {
                const team = await global.Team.findOne({ _id: teamAccess.team_id });
                if (!team) {
                    return response.status(404).json(formatErrorMessage(`Team ${teamAccess.team_id} not found`));
                }
                // Check guest ceiling: if team lead is a guest, they can't be manager
                if (workspace) {
                    const teamObj = await global.Team.findOne({ _id: teamAccess.team_id });
                    if (teamObj?.team_lead) {
                        const leadRole = (workspace.member_roles || []).find(r => r.user_id === teamObj.team_lead);
                        if (leadRole?.role === 'guest' && teamAccess.role === 'manager') {
                            return response.status(400).json(formatErrorMessage(
                                `Team "${teamObj.name}" lead is a Guest at workspace level and cannot be given Manager role`
                            ));
                        }
                    }
                }
            }
            updateData.shared_teams = validatedData.shared_teams;
        }

        if (validatedData.shared_members !== undefined) {
            // Validate all user_ids exist and are workspace members
            for (const memberAccess of validatedData.shared_members) {
                const user = await global.User.findOne({ _id: memberAccess.user_id });
                if (!user) {
                    return response.status(404).json(formatErrorMessage(`User ${memberAccess.user_id} not found`));
                }
                // Check guest ceiling
                if (workspace) {
                    const memberWsRole = (workspace.member_roles || []).find(r => r.user_id === memberAccess.user_id);
                    if (memberWsRole?.role === 'guest' && memberAccess.role === 'manager') {
                        return response.status(400).json(formatErrorMessage(
                            `User is a Guest at workspace level and cannot be given Manager role on a space`
                        ));
                    }
                }
            }
            updateData.shared_members = validatedData.shared_members;
        }

        const result = await global.Space.updateOne({ _id: id }).set(updateData);

        // Build response with effective permissions info
        const warnings = [];
        
        // Check if any member has access via both team and individual with different roles
        if (result.shared_teams && result.shared_members) {
            const teamMembers = {};
            for (const teamAccess of result.shared_teams) {
                const team = await global.Team.findOne({ _id: teamAccess.team_id });
                if (team) {
                    for (const memberId of (team.shared_members || [])) {
                        if (!teamMembers[memberId] || ROLE_PRIORITY[teamAccess.role] > ROLE_PRIORITY[teamMembers[memberId]]) {
                            teamMembers[memberId] = teamAccess.role;
                        }
                    }
                    // Include team owner
                    if (!teamMembers[team.user_id] || ROLE_PRIORITY[teamAccess.role] > ROLE_PRIORITY[teamMembers[team.user_id]]) {
                        teamMembers[team.user_id] = teamAccess.role;
                    }
                }
            }

            for (const memberAccess of result.shared_members) {
                const uid = typeof memberAccess === 'string' ? memberAccess : memberAccess.user_id;
                if (teamMembers[uid]) {
                    const teamRole = teamMembers[uid];
                    const individualRole = typeof memberAccess === 'object' ? memberAccess.role : 'contributor';
                    if (teamRole !== individualRole) {
                        const effectiveRole = ROLE_PRIORITY[individualRole] >= ROLE_PRIORITY[teamRole] ? individualRole : teamRole;
                        warnings.push({
                            user_id: uid,
                            message: `Also in team with ${teamRole} role. Individual ${individualRole} role takes precedence. Effective: ${effectiveRole}`,
                        });
                    }
                }
            }
        }

        // Check if space has no manager
        const hasManager = (result.shared_members || []).some(m => typeof m === 'object' && m.role === 'manager') ||
            result.user_id === userId;
        if (!hasManager) {
            warnings.push({ message: 'Space has no Manager. Consider assigning one.' });
        }

        response.json(formatSuccessMessage("Space access updated successfully", { ...result, warnings }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
