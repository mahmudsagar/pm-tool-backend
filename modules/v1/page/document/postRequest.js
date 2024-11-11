import { z } from 'zod';
import { postPageMetaSchema, postPageContentSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the page_content part of the request body
        const pageContentData = postPageContentSchema.parse({
            user_id: body.user_id,
            content: body.content,
            summary: body.summary,
        });

        // Save the validated page_content data to MongoDB
        const pageContentResult = await global.PageContent.create(pageContentData).fetch();

        // Validate the page_meta part of the request body
        const pageMetaData = postPageMetaSchema.parse({
            title: body.title,
            user_id: body.user_id,
            folder_id: body.folder_id,
            space_id: body.space_id,
            group_id: body.group_id,
            page_content_id: pageContentResult._id,
            custom_meta: body.custom_meta,
            shared_members: body.shared_members,
            shared_teams: body.shared_teams,
            attachments: body.attachments,
            page_type: body.page_type,
            last_updated_by: body.user_id,
            entity_type: body.entity_type,
        });

        // Save the validated page_meta data to MongoDB
        const pageMetaResult = await global.PageMeta.create(pageMetaData).fetch();

        response.json({ status: "success", data: { ...pageMetaResult, pageContent: pageContentResult } });
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