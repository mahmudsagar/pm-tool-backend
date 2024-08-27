import { z } from 'zod';
import { getFolderSchema } from '../config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id } = request.params;

        let result;
        if (id) {
            // Validate the _id if present in query
            const validatedParams = getFolderSchema.parse({ _id: id });

            // Fetch data by _id
            result = await global.Folder.findOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Folder not found' });
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