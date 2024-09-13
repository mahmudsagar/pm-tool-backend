import { z } from 'zod';
import { deleteDocumentSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteDocumentSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {
            // Delete the document by _id from MongoDB
            result = await global.Document.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json({ status: 'failed', error: 'Document not found' });
            }

            // Delete the corresponding page_meta by page_content_id
            await global.PageMeta.destroy({ page_content_id: validatedParams._id });
        } else if (validatedParams.user_id) {
            // Delete all documents by user_id from MongoDB
            result = await global.Document.destroy({ user_id: validatedParams.user_id });
            if (result?.length === 0) {
                return response.status(404).json({ status: 'failed', error: 'No documents found for the given user_id' });
            }

            // Delete all corresponding page_meta by user_id
            await global.PageMeta.destroy({ user_id: validatedParams.user_id });
        } else {
            return response.status(400).json({ status: 'failed', error: 'Either _id or user_id must be provided' });
        }

        response.json({
            status: "success", data: [{
                message: 'Document deleted successfully'
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