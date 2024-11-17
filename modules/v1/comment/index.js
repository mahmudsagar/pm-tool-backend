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

        response.json(formatSuccessMessage("CommentMeta fetched successfully", { ...commentMetaResult, commentContent: commentContentResult, mediaAttachments }));
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