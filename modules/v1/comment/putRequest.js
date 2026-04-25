import { z } from 'zod';
import { postCommentContentSchema, putCommentContentSchema, putCommentMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = request.body;

        let commentContentResult = {};
        let commentMetaResult;
        let mediaAttachments = [];

        // Validate the comment_meta part of the request body
        const commentMetaData = putCommentMetaSchema.parse({
            _id: body.id,
            comment_body: body.comment_body,
            attachments: body.attachments,
        });

        // Fetch the existing CommentMeta
        const existingCommentMeta = await global.CommentMeta.findOne({ _id: commentMetaData._id });
        if (!existingCommentMeta) {
            throw new Error("CommentMeta not found");
        }

        // Check if the CommentMeta doesn't have the associate_id and body.content is provided
        if (!existingCommentMeta.associate_id && body.content && Object.keys(body.content).length > 0) {
            // Validate the comment_content part of the request body
            const commentContentData = postCommentContentSchema.parse({
                user_id: body.user_id,
                content: body.content,
            });

            // Save the validated comment_content data to MongoDB
            commentContentResult = await global.CommentContent.create(commentContentData).fetch();

            // Update the associate_id in CommentMeta
            await global.CommentMeta.updateOne({ _id: commentMetaData._id }).set({ associate_id: commentContentResult._id }).fetch();
        } else if (body.content) {
            // Validate the comment_content part of the request body
            const commentContentData = putCommentContentSchema.parse({
                _id: existingCommentMeta.associate_id,
                content: body.content,
            });

            // Update the validated comment_content data in MongoDB
            commentContentResult = await global.CommentContent.updateOne({ _id: existingCommentMeta.associate_id }).set(commentContentData).fetch();
        }

        // Update the validated comment_meta data in MongoDB
        commentMetaResult = await global.CommentMeta.updateOne({ _id: commentMetaData._id }).set(commentMetaData).fetch();

        if (!commentMetaResult) {
            throw new Error("CommentMeta not found");
        }

        if (commentMetaResult.attachments && commentMetaResult.attachments.length > 0) {
            // Fetch media attachments if any
            mediaAttachments = await Promise.all(
                commentMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: commentMetaResult._id });
                })
            );
        }

        // Returning user and media attachments of user for each comment
        const user = await global.User.findOne({ _id: commentMetaResult.user_id });
        const attachments = Array.isArray(user.attachments) ? user.attachments : [];
        const userMediaAttachments = await Promise.all(
            attachments.map(async (attachment) => {
                return await global.Media.findOne({ _id: attachment });
            })
        );

        response.json(formatSuccessMessage("CommentMeta updated successfully",
            {
                ...commentMetaResult, commentContent: commentContentResult, mediaAttachments,
                userInfo: {
                    name: user.full_name,
                    url: userMediaAttachments?.length > 0 ? userMediaAttachments[0]?.url : ''
                }
            }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            // Handle other errors
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};