import { z } from 'zod';
import { getCommentMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

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
            return response.status(404).json({ status: 'failed', error: 'CommentMeta not found' });
        }

        // Fetch CommentContent by associate_id
        commentContentResult = await global.CommentContent.findOne({ _id: commentMetaResult.associate_id });

        // Fetch media attachments if any
        if (commentMetaResult.attachments && commentMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                commentMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: commentMetaResult._id });
                })
            );
        }

        // Fetch child comments and their meta if has_childs is true
        if (commentMetaResult.has_childs) {
            const childComments = await global.CommentMeta.find({ parent_id: validateQuery._id });
            childCommentsWithMeta = await Promise.all(
                childComments.map(async (childComment) => {
                    const childCommentContent = await global.CommentContent.findOne({ _id: childComment.associate_id });
                    let childMediaAttachments = [];

                    // Fetch media attachments for child comments if any
                    if (childComment.attachments && childComment.attachments.length > 0) {
                        childMediaAttachments = await Promise.all(
                            childComment.attachments.map(async (attachment) => {
                                return await global.Media.findOne({ reference_id: childComment._id });
                            })
                        );
                    }

                    return { ...childComment, commentContent: childCommentContent, mediaAttachments: childMediaAttachments };
                })
            );
        }

        return response.json({ status: "success", data: { ...commentMetaResult, commentContent: commentContentResult, mediaAttachments, childs: childCommentsWithMeta } });
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