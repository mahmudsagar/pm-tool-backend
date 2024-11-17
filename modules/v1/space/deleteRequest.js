import { z } from 'zod';
import { deleteSpaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        const validatedParams = deleteSpaceSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {
            const space = await global.Space.findOne({ _id: validatedParams._id });
            if (space.is_default) {
                return response.status(400).json(formatErrorMessage('Default spaces cannot be deleted'));
            }

            result = await global.Space.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Space not found'));
            }
        } else if (validatedParams.user_id) {
            const spaces = await global.Space.find({ user_id: validatedParams.user_id });
            const nonDefaultSpaces = spaces.filter(space => !space.is_default);

            if (nonDefaultSpaces.length === 0) {
                return response.status(404).json(formatErrorMessage('No non-default spaces found for the given user_id'));
            }

            result = await global.Space.destroy({ user_id: validatedParams.user_id, is_default: false });
        } else {
            return response.status(400).json(formatErrorMessage('Either _id or user_id must be provided'));
        }

        response.json(formatSuccessMessage('Space deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};