import { z } from 'zod';
import { deleteSpaceSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteSpaceSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {
            // Check if the space is default
            const space = await global.Space.findOne({ _id: validatedParams._id });
            if (space.is_default) {
                return response.status(400).json({ status: 'failed', error: 'Default spaces cannot be deleted' });
            }

            // Delete the data by _id from MongoDB
            result = await global.Space.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Space not found' });
            }
        } else if (validatedParams.user_id) {
            // Delete all non-default spaces by user_id from MongoDB
            const spaces = await global.Space.find({ user_id: validatedParams.user_id });
            const nonDefaultSpaces = spaces.filter(space => !space.is_default);

            if (nonDefaultSpaces.length === 0) {
                return response.status(404).json({ status: 'failed', error: 'No non-default spaces found for the given user_id' });
            }

            result = await global.Space.destroy({ user_id: validatedParams.user_id, is_default: false });
        } else {
            return response.status(400).json({ status: 'failed', error: 'Either _id or user_id must be provided' });
        }

        response.json({
            status: "success", data: [{
                message: 'Space deleted successfully'
            }]
        });
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json({ status: 'failed', error: formattedErrors });
        } else {
            // Handle other errors
            response.status(400).json({ status: 'failed', error: err.message });
        }
    }
};