import { z } from 'zod';
import { putWorkspaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = putWorkspaceSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: validatedData._id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (workspace.owner_id !== request.user.id) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can update this workspace'));
        }

        const updateData = {};
        if (validatedData.name !== undefined) updateData.name = validatedData.name;
        if (validatedData.description !== undefined) updateData.description = validatedData.description;

        const result = await global.Workspace.updateOne({ _id: validatedData._id }).set(updateData);

        response.json(formatSuccessMessage("Workspace updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
