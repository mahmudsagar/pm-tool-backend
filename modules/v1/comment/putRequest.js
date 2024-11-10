import { z } from 'zod';
import { putCommentSchema, putCommentMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate the comment part of the request body
        const commentData = putCommentSchema.parse({
            _id: body.id,
            content: body.content,
        });

        // Update the validated comment data in MongoDB
        const commentResult = await global.Comment.updateOne({ _id: commentData._id }).set(commentData).fetch();
        console.log("🚀 ~ commentResult:", commentResult)

        if (!commentResult) {
            throw new Error("Comment not found");
        }

        // Validate the comment_meta part of the request body
        const commentMetaData = putCommentMetaSchema.parse({
            associate_id: commentResult._id,
            comment_body: body.comment_body,
            // attachments: body.attachments
        });

        // Update the validated comment_meta data in MongoDB
        const commentMetaResult = await global.CommentMeta.updateOne({ associate_id: commentMetaData.associate_id }).set(commentMetaData).fetch();

        if (!commentMetaResult) {
            throw new Error("CommentMeta not found");
        }

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