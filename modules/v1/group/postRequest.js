import { z } from 'zod';
import { postGroupSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the request body using Zod
        const validatedData = postGroupSchema.parse(body);

        // Enforce parent sharing constraints
        if (validatedData.space_id) {
            await validateChildSharing('space', validatedData.space_id, validatedData.shared_members, validatedData.shared_teams);
        }

        // Save the validated data to MongoDB
        let result = await global.Group.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        response.json(formatSuccessMessage("Group created successfully", result));
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