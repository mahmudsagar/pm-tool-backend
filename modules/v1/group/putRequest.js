import { z } from 'zod';
import { putGroupSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        // Validate the request body using Zod
        const validatedData = putGroupSchema.parse({ _id, ...rest });

        // Fetch the existing group data
        const existingGroup = await global.Group.findOne({ _id: validatedData._id });
        if (!existingGroup) {
            return response.status(404).json(formatErrorMessage('Group not found'));
        }

        // Enforce parent sharing constraints if sharing is being changed
        if (validatedData.shared_members || validatedData.shared_teams) {
            const parentId = existingGroup.space_id;
            if (parentId) {
                await validateChildSharing('space', parentId, validatedData.shared_members ?? existingGroup.shared_members, validatedData.shared_teams ?? existingGroup.shared_teams);
            }
        }

        // Save the validated data to MongoDB
        let result = await global.Group.update({ _id: validatedData._id }, validatedData).fetch();
        if (result.length > 0) result = result[0];
        response.json(formatSuccessMessage("Group updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            // Handle other errors
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};