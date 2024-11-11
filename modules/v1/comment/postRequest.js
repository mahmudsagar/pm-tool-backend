import { z } from 'zod';
import { postCommentContentSchema, postCommentMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        let commentContentResult = {};
        if (body.content && Object.keys(body.content).length > 0) {
            // Validate the comment_content part of the request body
            const commentContentData = postCommentContentSchema.parse({
                user_id: body.user_id,
                content: body.content,
            });

            // Save the validated comment_content data to MongoDB
            commentContentResult = await global.CommentContent.create(commentContentData).fetch();

        }

        // Validate the comment_meta part of the request body
        const commentMetaData = postCommentMetaSchema.parse({
            user_id: body.user_id,
            page_id: body.page_id,
            parent_id: body.parent_id,
            associate_id: commentContentResult._id || '',
            comment_body: body.comment_body,
            attachments: body.attachments,
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

        response.json({ status: "success", data: { ...commentMetaResult, commentContent: commentContentResult } });
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