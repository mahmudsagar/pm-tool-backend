import { z } from 'zod';
import { deleteCommentMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteAttachments } from '../utils/helper.js';

export default async (request, response) => {
    try {
        let message = 'Comment deleted successfully';
        const { id: _id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteCommentMetaSchema.parse({ _id });

        // Find the corresponding comment_meta by associate_id
        const commentMeta = await global.CommentMeta.findOne({ _id: validatedParams._id });
        if (!commentMeta) {
            return response.status(404).json(formatErrorMessage('Comment not found'));
        }

        if (commentMeta && commentMeta.attachments && commentMeta.attachments.length > 0) {
            // Delete the attachments from S3 and Media table
            await deleteAttachments(commentMeta.attachments);
        }

        // Delete the corresponding comment_meta by associate_id
        await global.CommentMeta.destroy({ _id: validatedParams._id });

        // Delete the comment_content by _id from MongoDB
        const commentContentResult = await global.CommentContent.destroyOne({ _id: commentMeta.associate_id });
        // if (!commentContentResult) {
        //     return response.status(404).json(formatErrorMessage('Comment content not found'));
        // }

        // Find the corresponding comment by _id
        if (commentMeta.has_childs) {
            // Find the corresponding comment_meta by associate_id for each child comment
            const childCommentMeta = await global.CommentMeta.find({ parent_id: commentMeta._id });
            for (const childComment of childCommentMeta) {
                if (childComment.attachments && childComment.attachments.length > 0) {
                    // Delete the attachments from S3 and Media table for each child comment
                    await deleteAttachments(childComment.attachments);
                }

                // Delete the corresponding comment_meta by associate_id for each child comment
                await global.CommentMeta.destroy({ parent_id: commentMeta._id });

                // Delete the child comment_content by _id from MongoDB
                await global.CommentContent.destroyOne({ _id: childComment.associate_id });
            }

            message = 'Comment and its child comments deleted successfully';
        }

        response.json(formatSuccessMessage(message, null));
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