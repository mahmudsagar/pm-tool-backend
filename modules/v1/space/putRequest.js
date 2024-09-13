import { z } from 'zod';
import { putSpaceSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        // Fetch the existing space data
        const existingSpace = await global.Space.findOne({ _id });
        if (!existingSpace) {
            return response.status(404).json({ status: 'failed', error: 'Space not found' });
        }

        // Ensure the user cannot change the is_default field
        if ('is_default' in rest) {
            return response.status(404).json({ status: 'failed', error: 'Cannot change the is_default field' });
        }

        // Ensure the user cannot change the is_private field when is_default is true
        if (existingSpace.is_default && 'is_private' in rest && rest.is_private !== existingSpace.is_private) {
            return response.status(404).json({ status: 'failed', error: 'Cannot change the is_private field when is_default is true' });
        }

        // Validate the request body using Zod
        const validatedData = putSpaceSchema.parse({ _id, ...rest });

        // Save the validated data to MongoDB
        let result = await global.Space.update({ _id: validatedData._id }, validatedData).fetch();
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