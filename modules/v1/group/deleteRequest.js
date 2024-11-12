import { z } from 'zod';
import { deleteFolderSchema, deleteGroupSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';
import { deleteFolderAndChildren, deleteCommentAndChildren } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteGroupSchema.parse({ _id });

        if (validatedParams._id) {
            await deleteFolderAndChildren(validatedParams._id); // Assuming similar structure for group
        } else {
            return response.status(400).json({ status: 'failed', error: 'Group ID must be provided' });
        }

        // deleting the group at last
        await global.Group.destroyOne({ _id: validatedParams._id });

        response.json({
            status: "success", data: [{
                message: 'Group deleted successfully'
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