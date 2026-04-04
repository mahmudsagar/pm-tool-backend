import { z } from 'zod';
import { postWorkspaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = postWorkspaceSchema.parse(body);

        const result = await global.Workspace.create({
            name: validatedData.name,
            description: validatedData.description,
            owner_id: request.user.id,
            members: [],
        }).fetch();

        response.json(formatSuccessMessage("Workspace created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
