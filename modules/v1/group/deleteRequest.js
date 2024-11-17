import { z } from 'zod';
import { deleteGroupSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteGroupFolderAndChildren } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteGroupSchema.parse({ _id });

        if (validatedParams._id) {
            await deleteGroupFolderAndChildren(validatedParams._id); // Assuming similar structure for group
        } else {
            return response.status(400).json(formatErrorMessage('Group ID must be provided'));
        }

        // deleting the group at last
        await global.Group.destroyOne({ _id: validatedParams._id });

        response.json(formatSuccessMessage('Group deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};