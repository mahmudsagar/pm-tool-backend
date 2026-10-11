import { z } from 'zod';
import { getPageMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { buildCommentWithUserInfo } from '../../utils/helper.js';
import { withStudioDefaults } from '../../utils/pageLock.js';

export default async (request, response) => {
    try {
        const { id } = request.query;

        const validateQuery = getPageMetaSchema.parse({ _id: id });

        const pageMetaResult = await global.PageMeta.findOne({ _id: validateQuery._id });
        if (!pageMetaResult) {
            return response.status(404).json(formatErrorMessage('Page not found'));
        }

        const pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });

        const mediaAttachments = pageMetaResult.attachments && pageMetaResult.attachments.length > 0
            ? await Promise.all(
                pageMetaResult.attachments?.map(async (attachment) => {
                    return await global.Media.findOne({ _id: attachment });
                })
            )
            : [];

        const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id });

        const commentsWithMeta = await Promise.all(
            commentsMeta.map(async (comment) => {
                const withInfo = await buildCommentWithUserInfo(comment);
                const childComments = await global.CommentMeta.find({ parent_id: comment._id });
                const childs = await Promise.all(childComments.map(c => buildCommentWithUserInfo(c)));
                return { ...withInfo, childs };
            })
        );

        if (pageMetaResult.board_id !== "") {
            const boardData = await global.Board.findOne({ _id: pageMetaResult.board_id });
            if (boardData) {
                pageMetaResult.board = boardData;
            }
        }

        // Attach subtasks (child tasks) for this document
        const subtasks = await global.PageMeta.find({ parent_id: pageMetaResult._id }).sort('createdAt ASC');
        pageMetaResult.subtasks = subtasks;

        response.json(formatSuccessMessage("Page data fetched successfully",
            {
                ...withStudioDefaults(pageMetaResult),
                pageContent: pageContentResult,
                mediaAttachments,
                comments: commentsWithMeta
            }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};