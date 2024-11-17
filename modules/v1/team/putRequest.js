import { z } from 'zod';
import { putTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        // Validate the request body using Zod
        const validatedData = putTeamSchema.parse({ _id, ...rest });

        // Save the validated data to MongoDB
        let result = await global.Team.update({ _id: validatedData._id }, validatedData).fetch();
        if (result.length > 0) result = result[0];
        response.json(formatSuccessMessage("Team updated successfully", result));
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