import { z } from 'zod';
import { putTeamSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        // Validate the request body using Zod
        const validatedData = putTeamSchema.parse({ _id, ...rest });

        // Save the validated data to MongoDB
        let result = await global.Team.update({ _id: validatedData._id }, validatedData).fetch();
        response.json({ status: "success", data: result });
    } catch (err) {
        if (err instanceof z.ZodError) {
            console.log("🚀 ~ err:", err)
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json({ status: 'failed', error: formattedErrors });
        } else {
            // Handle other errors
            response.status(400).json({ status: 'failed', error: err.message });
        }
    }
};