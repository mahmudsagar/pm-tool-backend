import { z } from 'zod';
import { getMediaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        // Validate the query parameters
        const validateQuery = getMediaSchema.parse({ _id });

        // Fetch media by _id
        const mediaResult = await global.Media.findOne({ _id: validateQuery._id });
        if (!mediaResult) {
            return response.status(404).json(formatErrorMessage('Media not found'));
        }

        response.json(formatSuccessMessage("Media fetched successfully", mediaResult));
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