import { z } from 'zod';
import { postMemberSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = postMemberSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (workspace.owner_id !== request.user.id) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can add members'));
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
        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({ members: updatedMembers });

        response.json(formatSuccessMessage("Member added successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
