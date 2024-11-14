import { z } from 'zod';
import { getTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;

        // Validate the query parameters
        const validateQuery = getTeamSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id && validateQuery.user_id) {
            // Fetch data by both _id and user_id
            result = await global.Team.findOne({ _id: validateQuery._id, user_id: validateQuery.user_id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found for the given _id and user_id'));
            }
        } else if (validateQuery._id) {
            // Fetch data by _id
            result = await global.Team.findOne({ _id: validateQuery._id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found'));
            }
        } else if (validateQuery.user_id) {
            // Fetch data by user_id
            result = await global.Team.find({ user_id: validateQuery.user_id });
            if (result.length === 0) {
                return response.status(404).json(formatErrorMessage('No teams found for the given user_id'));
            }
        }

        response.json(formatSuccessMessage("Team fetched successfully", result));
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