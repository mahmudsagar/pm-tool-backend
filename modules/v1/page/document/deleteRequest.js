import { z } from 'zod';
import { deletePageMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';
import { deleteAttachments } from '../../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deletePageMetaSchema.parse({ _id });

        if (validatedParams._id) {
            // Find the PageMeta by page_content_id
            const pageMeta = await global.PageMeta.findOne({ _id: validatedParams._id });
            if (!pageMeta) {
                return response.status(404).json({ status: 'failed', error: 'PageMeta not found' });
            }

            // Check if there are attachments and delete them
            if (pageMeta.attachments && pageMeta.attachments.length > 0) {
                await deleteAttachments(pageMeta.attachments);
            }

            // Delete the PageMeta by page_content_id
            await global.PageMeta.destroy({ _id: validatedParams._id });

            // Delete the PageContent by _id
            const pageContentResult = await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json({ status: 'failed', error: 'PageContent not found' });
            }
        } else {
            return response.status(400).json({ status: 'failed', error: 'Page ID must be provided' });
        }

        response.json({
            status: "success", data: [{
                message: 'Page deleted successfully'
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