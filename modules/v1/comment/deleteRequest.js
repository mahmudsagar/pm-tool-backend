import { z } from 'zod';
import { deleteCommentSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';
import { deleteAttachments } from '../utils/helper.js';

export default async (request, response) => {
    try {
        let message = 'Comment deleted successfully';
        const { id: _id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteCommentSchema.parse({ _id });

        // Delete the comment by _id from MongoDB
        const commentResult = await global.Comment.destroyOne({ _id: validatedParams._id });
        if (!commentResult) {
            return response.status(404).json({ status: 'failed', error: 'Comment not found' });
        }

        // Find the corresponding comment_meta by associate_id
        const commentMeta = await global.CommentMeta.findOne({ associate_id: validatedParams._id });
        if (commentMeta && commentMeta.attachments && commentMeta.attachments.length > 0) {
            // Delete the attachments from S3 and Media table
            await deleteAttachments(commentMeta.attachments);
        }

        // Delete the corresponding comment_meta by associate_id
        await global.CommentMeta.destroy({ associate_id: validatedParams._id });

        // Fetch child comments by parent_id
        const childComments = await global.Comment.find({ parent_id: validatedParams._id });
        for (const childComment of childComments) {
            // Find the corresponding comment_meta by associate_id for each child comment
            const childCommentMeta = await global.CommentMeta.findOne({ associate_id: childComment._id });
            if (childCommentMeta && childCommentMeta.attachments && childCommentMeta.attachments.length > 0) {
                // Delete the attachments from S3 and Media table for each child comment
                await deleteAttachments(childCommentMeta.attachments);
            }

            // Delete the corresponding comment_meta by associate_id for each child comment
            await global.CommentMeta.destroy({ associate_id: childComment._id });

            // Delete the child comment by _id from MongoDB
            await global.Comment.destroyOne({ _id: childComment._id });
            message = 'Comment and its child comments deleted successfully';
        }

        response.json({
            status: "success", data: [{
                message: message
            }]
        });
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