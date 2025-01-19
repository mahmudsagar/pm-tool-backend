import { z } from 'zod';
import { putPageMetaSchema, putPageContentSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        let mediaAttachments = [];
        let comments = [];
        let pageContentResult, pageMetaResult;

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
            pinned: rest.pinned,
            entity_type: rest.entity_type,
            inner_comments: rest.inner_comments,
        });

        pageMetaResult = await global.PageMeta.update(
            { _id },
            pageMetaData
        ).fetch();

        if (!pageMetaResult || !pageMetaResult.length) {
            return response.status(404).json(formatErrorMessage('PageMeta not found'));
        }

        if (pageMetaResult.length > 0) pageMetaResult = pageMetaResult[0];

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
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }

            if (pageContentResult.length > 0) pageContentResult = pageContentResult[0];
        } else {
            pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }
        }

        if (pageMetaResult.attachments && pageMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                pageMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: pageMetaResult._id });
                })
            );
        }

        const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id });
        const commentsWithMeta = await Promise.all(
            commentsMeta.map(async (comment) => {
                const commentContent = await global.CommentContent.findOne({ _id: comment.associate_id });
                const mediaAttachments = comment.attachments && comment.attachments.length > 0
                    ? await Promise.all(
                        comment.attachments.map(async (attachment) => {
                            return await global.Media.findOne({ reference_id: comment._id });
                        })
                    )
                    : [];

                return { ...comment, commentContent, mediaAttachments };

            })
        );

        response.json(formatSuccessMessage("Page updated successfully", { ...pageMetaResult, mediaAttachments, pageContent: pageContentResult, comments: commentsWithMeta }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};