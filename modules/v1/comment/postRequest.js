import { z } from 'zod';
import { postCommentContentSchema, postCommentMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

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

        // Returning user and media attachments of user for each comment
        const user = await global.User.findOne({ _id: body.user_id });
        // Ensure attachments is an array before iterating
        const attachments = Array.isArray(user.attachments) ? user.attachments : [];
        const userMediaAttachments = await Promise.all(
            attachments.map(async (attachment) => {
                return await global.Media.findOne({ _id: attachment });
            })
        );

        response.json(formatSuccessMessage("CommentMeta created successfully",
            {
                ...commentMetaResult, commentContent: commentContentResult,
                userInfo: {
                    name: user.name,
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