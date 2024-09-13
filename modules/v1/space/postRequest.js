import { z } from 'zod';
import { postSpaceSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the request body using Zod
        const validatedData = postSpaceSchema.parse(body);

        // Check for existing default spaces only when user try to default space
        if (validatedData.is_default) {
            const existingDefaultSpaces = await global.Space.find({
                user_id: validatedData.user_id,
                is_default: true,
                is_private: validatedData.is_private
            });

            if (existingDefaultSpaces.length > 0) {
                return response.status(404).json({ status: 'failed', error: `User already has a default ${validatedData.is_private ? 'private' : 'public'} space` });
            }
        }

        // Save the validated data to MongoDB
        let result = await global.Space.create(validatedData).fetch();
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