import { z } from 'zod';
import { postTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the request body using Zod
        const validatedData = postTeamSchema.parse(body);

        // Save the validated data to MongoDB
        let result = await global.Team.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        response.json(formatSuccessMessage("Team created successfully", result));
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