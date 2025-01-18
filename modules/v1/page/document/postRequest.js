import { z } from 'zod';
import { postPageMetaSchema, postPageContentSchema } from './config/validation.js';
import { postCommentContentSchema, postCommentMetaSchema } from '../../comment/config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const pageContentData = postPageContentSchema.parse({
            user_id: body.user_id,
            content: body.content,
            summary: body.summary,
        });

        const pageContentResult = await global.PageContent.create(pageContentData).fetch();

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

        const pageMetaResult = await global.PageMeta.create(pageMetaData).fetch();

        // Handle inner_comments
        const innerComments = body.inner_comments || [];
        const innerCommentResults = [];

        for (const comment of innerComments) {
            let commentContentResult = {};
            if (comment.content && Object.keys(comment.content).length > 0) {
                // Validate the comment_content part of the request body
                const commentContentData = postCommentContentSchema.parse({
                    user_id: comment.user_id,
                    content: comment.content,
                });

                // Save the validated comment_content data to MongoDB
                commentContentResult = await global.CommentContent.create(commentContentData).fetch();
            }

            // Validate the comment_meta part of the request body
            const commentMetaData = postCommentMetaSchema.parse({
                user_id: comment.user_id,
                page_id: pageMetaResult._id, // _id from page_meta
                parent_id: comment.parent_id,
                associate_id: commentContentResult._id || '',
                comment_body: comment.comment_body,
                // attachments: comment.attachments, // there will be no attachments for inner comments
                inner_comment: true,
            });

            // Check if the parent_id is present
            if (commentMetaData.parent_id) {
                const parentComment = await global.CommentMeta.findOne({ _id: commentMetaData.parent_id });
                if (!parentComment) {
                    throw new Error("Parent comment not found");
                }

                // Updating the parent comment
                await global.CommentMeta.updateOne({ _id: commentMetaData.parent_id }).set({ has_childs: true }).fetch();
            }

            // Save the validated comment_meta data to MongoDB
            const commentMetaResult = await global.CommentMeta.create(commentMetaData).fetch();
            innerCommentResults.push({ ...commentMetaResult, commentContent: commentContentResult });
        }

        response.json(formatSuccessMessage("Page content, meta data, and inner comments saved successfully", { ...pageMetaResult, pageContent: pageContentResult, innerComments: innerCommentResults }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};