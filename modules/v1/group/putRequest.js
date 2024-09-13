import { z } from 'zod';
import { putGroupSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        // Fetch the existing group data
        const existingGroup = await global.Group.findOne({ _id });
        if (!existingGroup) {
            return response.status(404).json({ status: 'failed', error: 'Group not found' });
        }

        // Validate the request body using Zod
        const validatedData = putGroupSchema.parse({ _id, ...rest });

        // Save the validated data to MongoDB
        let result = await global.Group.update({ _id: validatedData._id }, validatedData).fetch();
        if (result.length > 0) result = result[0];
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