import { z } from 'zod';
import { deleteTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteTeamSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {

            // Delete the data by _id from MongoDB
            result = await global.Team.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found'));
            }
        } else if (validatedParams.user_id) {
            // Delete all teams by user_id from MongoDB
            result = await global.Team.destroy({ user_id: validatedParams.user_id });
            if (result?.length === 0) {
                return response.status(404).json(formatErrorMessage('No teams found for the given user_id'));
            }
        } else {
            return response.status(400).json(formatErrorMessage('Either _id or user_id must be provided'));
        }

        response.json(formatSuccessMessage('Team deleted successfully', null));
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