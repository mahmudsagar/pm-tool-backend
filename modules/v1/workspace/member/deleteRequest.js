import { z } from 'zod';
import { deleteMemberSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { workspace_id, user_id } = request.query;

        const validatedParams = deleteMemberSchema.parse({ workspace_id, user_id });

        const workspace = await global.Workspace.findOne({ _id: validatedParams.workspace_id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (workspace.owner_id !== request.user.id) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can remove members'));
        }

        if (validatedParams.user_id === workspace.owner_id) {
            return response.status(400).json(formatErrorMessage('Cannot remove the workspace owner'));
        }

        const currentMembers = workspace.members || [];
        if (!currentMembers.includes(validatedParams.user_id)) {
            return response.status(404).json(formatErrorMessage('User is not a member of this workspace'));
        }

        const updatedMembers = currentMembers.filter(id => id !== validatedParams.user_id);
        const result = await global.Workspace.updateOne({ _id: workspace._id }).set({ members: updatedMembers });

        response.json(formatSuccessMessage("Member removed successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
