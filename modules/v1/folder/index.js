import { z } from 'zod';
import { getFolderSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;

        // Validate the query parameters
        const validateQuery = getFolderSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id && validateQuery.user_id) {
            // Fetch data by both _id and user_id
            result = await global.Folder.findOne({ _id: validateQuery._id, user_id: validateQuery.user_id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Folder not found for the given _id and user_id' });
            }
        } else if (validateQuery._id) {
            // Fetch data by _id
            result = await global.Folder.findOne({ _id: validateQuery._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Folder not found' });
            }
        } else if (validateQuery.user_id) {
            // Fetch data by user_id
            result = await global.Folder.find({ user_id: validateQuery.user_id });
            if (result.length === 0) {
                return response.status(404).json({ status: 'failed', error: 'No folders found for the given user_id' });
            }
        } else {
            // Fetch all data
            result = await global.Folder.find();
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