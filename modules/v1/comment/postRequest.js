import { z } from 'zod';
import { postCommentSchema, postCommentMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the comment part of the request body
        const commentData = postCommentSchema.parse({
            page_id: body.page_id,
            user_id: body.user_id,
            parent_id: body.parent_id,
            content: body.content,
        });

        // check if the parent_id is present
        if (commentData.parent_id) {
            const parentComment = await global.Comment.findOne({ _id: commentData.parent_id });
            if (!parentComment) {
                throw new Error("Parent comment not found");
            }

            // updating the parent comment
            await global.Comment.updateOne({ _id: commentData.parent_id }).set({ has_childs: true }).fetch();
        }

        // Save the validated comment data to MongoDB
        const commentResult = await global.Comment.create(commentData).fetch();

        // Validate the comment_meta part of the request body
        const commentMetaData = postCommentMetaSchema.parse({
            associate_id: commentResult._id,
            comment_body: body.comment_body,
            // attachments: body.attachments
        });

        // Save the validated comment_meta data to MongoDB
        const commentMetaResult = await global.CommentMeta.create(commentMetaData).fetch();

        response.json({ status: "success", data: { ...commentResult, commentMeta: commentMetaResult } });
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