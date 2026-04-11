import { z } from 'zod';
import { getCommentMetaSchema, getCommentsByPageSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { buildCommentWithUserInfo } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id, page_id } = request.query;

        // Fetch by page_id: return all top-level comments with user info
        if (page_id) {
            const { page_id: validatedPageId } = getCommentsByPageSchema.parse({ page_id });
            const topLevelComments = await global.CommentMeta.find({ page_id: validatedPageId, parent_id: '' });
            const comments = await Promise.all(topLevelComments.map(async (comment) => {
                const withInfo = await buildCommentWithUserInfo(comment);
                const childComments = await global.CommentMeta.find({ parent_id: comment._id });
                const childs = await Promise.all(childComments.map(c => buildCommentWithUserInfo(c)));
                return { ...withInfo, childs };
            }));
            return response.json(formatSuccessMessage("Comments fetched successfully", comments));
        }

        // Validate the query parameters
        const validateQuery = getCommentMetaSchema.parse({ _id: id });


        // Fetch CommentMeta by _id
        const commentMetaResult = await global.CommentMeta.findOne({ _id: validateQuery._id });
        if (!commentMetaResult) {
            return response.status(404).json(formatErrorMessage('CommentMeta not found'));
        }

        const childComments = await global.CommentMeta.find({ parent_id: validateQuery._id });
        const childCommentsWithMeta = await Promise.all(childComments.map(c => buildCommentWithUserInfo(c)));

        const result = await buildCommentWithUserInfo(commentMetaResult);
        response.json(formatSuccessMessage("CommentMeta fetched successfully", {
            ...result,
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