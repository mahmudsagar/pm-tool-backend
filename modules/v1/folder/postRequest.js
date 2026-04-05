import { z } from 'zod';
import { postFolderSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = postFolderSchema.parse(body);

        let result = await global.Folder.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        response.json(formatSuccessMessage("Folder created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};