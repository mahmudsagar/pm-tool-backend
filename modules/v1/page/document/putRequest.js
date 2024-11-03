import { z } from 'zod';
import { putDocumentSchema, putPageMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        let documentResult, pageMetaResult;

        // Validate and update the document if its fields are present in the rest
        if (rest.content || rest.summary) {
            const documentData = putDocumentSchema.parse({
                _id,
                content: rest.content,
                summary: rest.summary,
                folder_id: rest.folder_id,
                space_id: rest.space_id,
                group_id: rest.group_id,
            });

            documentResult = await global.Document.update(
                { _id },
                documentData
            ).fetch();
            if (!documentResult || !documentResult.length) {
                return response.status(404).json({ status: 'failed', error: 'Document not found' });
            }

            // take the array into an object
            if (documentResult.length > 0) documentResult = documentResult[0];

        }

        // Validate and update the page_meta if its fields are present in the rest
        if (rest.page_type || rest.title || rest.user_id || rest.last_updated_by || rest.folder_id || rest.shared_teams || rest.shared_members || rest.custom_meta || rest.workspace_id) {
            const pageMetaData = putPageMetaSchema.parse({
                last_updated_by: rest.last_updated_by,
                page_type: rest.page_type,
                page_content_id: documentResult._id,
                title: rest.title,
                shared_teams: rest.shared_teams,
                shared_members: rest.shared_members,
                custom_meta: rest.custom_meta,
                attachments: rest.attachments
            });

            pageMetaResult = await global.PageMeta.update(
                { page_content_id: documentResult._id },
                pageMetaData
            ).fetch();

            if (!pageMetaResult || !pageMetaResult.length) {
                return response.status(404).json({ status: 'failed', error: 'PageMeta not found' });
            }

            // take the array into an object
            if (pageMetaResult.length > 0) pageMetaResult = pageMetaResult[0];
        }

        response.json({ status: "success", data: { ...documentResult, pageMeta: pageMetaResult } });
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