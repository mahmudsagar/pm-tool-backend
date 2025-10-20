import { z } from 'zod';
import { deleteBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteBoardAndChildren } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteBoardSchema.parse({ _id });

        if (validatedParams._id) {
            await deleteBoardAndChildren(validatedParams._id);
        } else {
            return response.status(400).json(formatErrorMessage('Board ID must be provided'));
        }

        response.json(formatSuccessMessage('Board deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};