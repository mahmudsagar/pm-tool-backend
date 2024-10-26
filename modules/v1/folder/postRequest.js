import { z } from 'zod';
import { postFolderSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    console.log("Create request started");
    try {
        const body = await request.json();

        // Validate the request body using Zod
        const validatedData = postFolderSchema.parse(body);

        // Save the validated data to MongoDB
        let result = await global.Folder.create(validatedData).fetch();
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