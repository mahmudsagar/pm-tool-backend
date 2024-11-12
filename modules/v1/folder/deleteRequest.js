import { z } from 'zod';
import { deleteFolderSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';
import { deleteFolderAndChildren } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteFolderSchema.parse({ _id });

        if (validatedParams._id) {
            await deleteFolderAndChildren(validatedParams._id);
        } else {
            return response.status(400).json({ status: 'failed', error: 'Folder ID must be provided' });
        }

        response.json({
            status: "success", data: [{
                message: 'Folder deleted successfully'
            }]
        });
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json({ status: 'failed', error: formattedErrors });
        } else {
            response.status(400).json({ status: 'failed', error: err.message });
        }
    }
};