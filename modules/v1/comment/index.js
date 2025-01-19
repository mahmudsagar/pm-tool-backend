import { z } from 'zod';
import { getCommentMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id } = request.query;

        // Validate the query parameters
        const validateQuery = getCommentMetaSchema.parse({ _id: id });

        let commentMetaResult;
        let commentContentResult;
        let childCommentsWithMeta = [];
        let mediaAttachments = [];

        // Fetch CommentMeta by _id
        commentMetaResult = await global.CommentMeta.findOne({ _id: validateQuery._id });
        if (!commentMetaResult) {
            return response.status(404).json(formatErrorMessage('CommentMeta not found'));
        }

        // Returning user and media attachments of user for each comment
        const user = await global.User.findOne({ _id: commentMetaResult.user_id });
        const userMediaAttachments = await Promise.all(user.attachments.map(async (attachment) => {
            return await global.Media.findOne({ _id: attachment });
        }));

        // Fetch CommentContent by associate_id
        commentContentResult = await global.CommentContent.findOne({ _id: commentMetaResult.associate_id });

        // Fetch media attachments if any
        if (commentMetaResult.attachments && commentMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                commentMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ _id: attachment });
                })
            );
        }

        const childComments = await global.CommentMeta.find({ parent_id: validateQuery._id });

        childCommentsWithMeta = await Promise.all(
            childComments.map(async (childComment) => {
                // Returning user and media attachments of user for each comment
                const user = await global.User.findOne({ _id: childComment.user_id });
                const userMediaAttachments = await Promise.all(user.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ _id: attachment });
                }));

                const childCommentContent = await global.CommentContent.findOne({ _id: childComment.associate_id });
                let childMediaAttachments = [];
                if (childComment.attachments && childComment.attachments.length > 0) {
                    childMediaAttachments = await Promise.all(
                        childComment.attachments.map(async (attachment) => {
                            return await global.Media.findOne({ _id: attachment });
                        })
                    );
                }
                return {
                    ...childComment, commentContent: childCommentContent, mediaAttachments: childMediaAttachments,
                    userInfo: {
                        name: user.full_name,
                        url: userMediaAttachments?.length > 0 ? userMediaAttachments[0]?.url : ''
                    }
                };
            })
        );

        response.json(formatSuccessMessage("CommentMeta fetched successfully", {
            ...commentMetaResult,
            userInfo: {
                name: user.full_name,
                url: userMediaAttachments?.length > 0 ? userMediaAttachments[0]?.url : ''
            },
            commentContent: commentContentResult,
            mediaAttachments,
            childs: childCommentsWithMeta
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