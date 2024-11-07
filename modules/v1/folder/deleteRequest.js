import { z } from 'zod';
import { deleteFolderSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteFolderSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {
            // Check if the folder has child folders
            const childFolders = await global.Folder.find({ parent_id: validatedParams._id });
            if (childFolders.length > 0) {
                return response.status(400).json({ status: 'failed', error: 'This folder has some child folders. Delete them first.' });
            }

            // Delete the data by _id from MongoDB
            result = await global.Folder.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Folder not found' });
            }
        } else if (validatedParams.user_id) {
            // Delete all folders by user_id from MongoDB
            result = await global.Folder.destroy({ user_id: validatedParams.user_id });
            if (result?.length === 0) {
                return response.status(404).json({ status: 'failed', error: 'No folders found for the given user_id' });
            }
        } else {
            return response.status(400).json({ status: 'failed', error: 'Either _id or user_id must be provided' });
        }

        response.json({
            status: "success", data: [{
                message: 'Folder deleted successfully'
            }]
        });
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