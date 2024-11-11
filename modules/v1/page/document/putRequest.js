import { z } from 'zod';
import { putPageMetaSchema, putPageContentSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        let mediaAttachments = [];
        let comments = [];
        let pageContentResult, pageMetaResult;

        // Validate and update the page_meta
        const pageMetaData = putPageMetaSchema.parse({
            _id,
            page_type: rest.page_type,
            title: rest.title,
            folder_id: rest.folder_id,
            space_id: rest.space_id,
            group_id: rest.group_id,
            custom_meta: rest.custom_meta,
            shared_members: rest.shared_members,
            shared_teams: rest.shared_teams,
            attachments: rest.attachments,
            last_updated_by: rest.last_updated_by,
            entity_type: rest.entity_type,
        });

        pageMetaResult = await global.PageMeta.update(
            { _id },
            pageMetaData
        ).fetch();

        if (!pageMetaResult || !pageMetaResult.length) {
            return response.status(404).json({ status: 'failed', error: 'PageMeta not found' });
        }

        // take the array into an object
        if (pageMetaResult.length > 0) pageMetaResult = pageMetaResult[0];

        // Validate and update the page_content if its fields are present in the rest
        if (rest.content || rest.summary) {
            const pageContentData = putPageContentSchema.parse({
                _id: pageMetaResult.page_content_id,
                content: rest.content,
                summary: rest.summary,
            });

            pageContentResult = await global.PageContent.update(
                { _id: pageMetaResult.page_content_id },
                pageContentData
            ).fetch();
            if (!pageContentResult || !pageContentResult.length) {
                return response.status(404).json({ status: 'failed', error: 'PageContent not found' });
            }

            // take the array into an object
            if (pageContentResult.length > 0) pageContentResult = pageContentResult[0];
        } else {
            pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json({ status: 'failed', error: 'PageContent not found' });
            }
        }

        // Fetch comments by page_id
        // const comments = await global.Comment.find({ page_id: pageMetaResult._id });
        // commentsWithMeta = await Promise.all(
        // 	comments.map(async (comment) => {
        // 		const commentMeta = await global.CommentMeta.findOne({ associate_id: comment._id });
        // 		return { ...comment, commentMeta };
        // 	})
        // );

        if (pageMetaResult.attachments && pageMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                pageMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: pageMetaResult._id });
                })
            );
        }

        response.json({ status: "success", data: { ...pageMetaResult, comments, mediaAttachments, pageContent: pageContentResult } });
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json({ status: 'failed', error: formattedErrors });
        } else {
            response.status(400).json({ status: 'failed', error: err.message });
        }
    }
};