import { z } from 'zod';
import { getUserSchema } from '../config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id } = request.params;

        let result;
        if (id) {
            // Validate the _id if present in query
            const validatedParams = getUserSchema.parse({ _id: id });

            // Fetch data by _id
            result = await global.User.findOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'User not found' });
            }
        } else {
            // Fetch all data
            result = await global.User.find();
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