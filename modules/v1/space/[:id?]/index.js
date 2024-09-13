import { z } from 'zod';
import { getSpaceSchema } from '../config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.params;

        // Validate the query parameters
        const validateQuery = getSpaceSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id && validateQuery.user_id) {
            // Fetch data by both _id and user_id
            result = await global.Space.findOne({ _id: validateQuery._id, user_id: validateQuery.user_id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Space not found for the given _id and user_id' });
            }
        } else if (validateQuery._id) {
            // Fetch data by _id
            result = await global.Space.findOne({ _id: validateQuery._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Space not found' });
            }
        } else if (validateQuery.user_id) {
            // Fetch data by user_id
            result = await global.Space.find({ user_id: validateQuery.user_id });
            if (result.length === 0) {
                return response.status(404).json({ status: 'failed', error: 'No spaces found for the given user_id' });
            }
        } else {
            // Fetch all data
            result = await global.Space.find();
        }

        response.json({ status: "success", data: result });
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