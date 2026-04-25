import { z } from 'zod';
import { postMemberSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const body = request.body;

        const validatedData = postMemberSchema.parse(body);
        console.log('workspace', request.workspaceId);
        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Allow admins to add members too
        const memberRole = (workspace.member_roles || []).find(r => r.user_id === request.user.id);
        const isAdmin = workspace.owner_id === request.user.id || (memberRole && memberRole.role === 'admin');
        if (!isAdmin) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can add members'));
        }

        // Find the user to add
        let userToAdd;
        if (validatedData.email) {
            userToAdd = await global.User.findOne({ email: validatedData.email });
            if (!userToAdd) {
                return response.status(404).json(formatErrorMessage('User not found with this email'));
            }
        } else {
            userToAdd = await global.User.findOne({ _id: validatedData.user_id });
            if (!userToAdd) {
                return response.status(404).json(formatErrorMessage('User not found'));
            }
        }

        // Cannot add the owner as a member
        if (userToAdd._id === workspace.owner_id) {
            return response.status(400).json(formatErrorMessage('Owner is already part of the workspace'));
        }

        // Deduplicate
        const currentMembers = workspace.members || [];
        if (currentMembers.includes(userToAdd._id)) {
            return response.status(400).json(formatErrorMessage('User is already a member of this workspace'));
        }

        const updatedMembers = [...currentMembers, userToAdd._id];
        
        // Add role to member_roles
        const currentRoles = workspace.member_roles || [];
        const role = validatedData.role || 'member';
        const updatedRoles = [...currentRoles.filter(r => r.user_id !== userToAdd._id), { user_id: userToAdd._id, role }];
        
        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({ 
            members: updatedMembers,
            member_roles: updatedRoles,
        });

        // Populate member users (strip passwords)
        const populatedMembers = await Promise.all(
            result.members.map(async (memberId) => {
                const user = await global.User.findOne({ _id: memberId });
                if (!user) return null;
                const { password: _p, ...userWithoutPassword } = user;
                return userWithoutPassword;
            })
        );

        response.json(formatSuccessMessage("Member added successfully", {
            ...result,
            members: populatedMembers.filter(Boolean),
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
