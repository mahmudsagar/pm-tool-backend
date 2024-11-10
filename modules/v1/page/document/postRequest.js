import { z } from 'zod';
import { postDocumentSchema, postPageMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the document part of the request body
        const documentData = postDocumentSchema.parse({
            user_id: body.user_id,
            content: body.content,
            summary: body.summery,
            folder_id: body.folder_id,
            space_id: body.space_id,
            group_id: body.group_id,
        });

        // Save the validated document data to MongoDB
        const documentResult = await global.Document.create(documentData).fetch();

        // Validate the page_meta part of the request body
        const pageMetaData = postPageMetaSchema.parse({
            page_type: body.page_type,
            page_content_id: documentResult._id,
            title: body.title,
            last_updated_by: body.user_id,
            shared_teams: body.shared_teams,
            shared_members: body.shared_members,
            custom_meta: body.custom_meta,
            // attachments: body.attachments
        });

        // Add the document _id to the page_meta data
        pageMetaData.page_content_id = documentResult._id;

        // Save the validated page_meta data to MongoDB
        const pageMetaResult = await global.PageMeta.create(pageMetaData).fetch();

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