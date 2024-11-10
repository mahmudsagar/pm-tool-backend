import { z } from 'zod';
import { getCommentSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id } = request.query;

        // Validate the query parameters
        const validateQuery = getCommentSchema.parse({ _id: id });

        let commentResult;
        let commentMetaResult;

        // Fetch comment by _id
        commentResult = await global.Comment.findOne({ _id: validateQuery._id });
        if (!commentResult) {
            return response.status(404).json({ status: 'failed', error: 'Comment not found' });
        }

        // Fetch comment meta by associate_id
        commentMetaResult = await global.CommentMeta.findOne({ associate_id: validateQuery._id });

        // Fetch child comments and their meta
        const childComments = await global.Comment.find({ parent_id: validateQuery._id });
        const childCommentsWithMeta = await Promise.all(
            childComments.map(async (childComment) => {
                const childCommentMeta = await global.CommentMeta.findOne({ associate_id: childComment._id });
                return { ...childComment, commentMeta: childCommentMeta };
            })
        );

        return response.json({ status: "success", data: { ...commentResult, commentMeta: commentMetaResult, childs: childCommentsWithMeta } });
        // else {
        // Fetch all comments
        //     commentResult = await global.Comment.find();

        //     // Fetch comment meta for each comment by associate_id
        //     commentMetaResult = await Promise.all(
        //         commentResult.map(async (comment) => {
        //             const commentMeta = await global.CommentMeta.findOne({ associate_id: comment._id });
        //             const childComments = await global.Comment.find({ parent_id: comment._id });
        //             const childCommentsWithMeta = await Promise.all(
        //                 childComments.map(async (childComment) => {
        //                     const childCommentMeta = await global.CommentMeta.findOne({ associate_id: childComment._id });
        //                     return { ...childComment, commentMeta: childCommentMeta };
        //                 })
        //             );
        //             return { ...comment, commentMeta, childComments: childCommentsWithMeta };
        //         })
        //     );

        //     return response.json({ status: "success", data: commentMetaResult });
        // }
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