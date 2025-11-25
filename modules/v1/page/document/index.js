import { z } from 'zod';
import { getPageMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

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

            commentsMeta?.map(async (comment) => {
                const user = await global.User.findOne({ _id: comment.user_id });
                const userAttachments = Array.isArray(user.attachments) ? user.attachments : [];
                const userMediaAttachments = await Promise.all(userAttachments.map(async (attachment) => {
                    return await global.Media.findOne({ _id: attachment });
                }));

                const commentContent = await global.CommentContent.findOne({ _id: comment.associate_id });
                console.log('commentContent', commentContent)
                const mediaAttachments = comment.attachments && comment.attachments.length > 0
                    ? await Promise.all(
                        comment.attachments?.map(async (attachment) => {
                            return await global.Media.findOne({ _id: attachment });
                        })
                    )
                    : [];

                return {
                    ...comment, commentContent, mediaAttachments,
                    userInfo: {
                        name: user.full_name,
                        url: userMediaAttachments?.length > 0 ? userMediaAttachments[0]?.url : ''
                    }
                };
            })
        );

        if (pageMetaResult.board_id !== "") {
            const boardData = await global.Board.findOne({ _id: pageMetaResult.board_id });
            if (boardData) {
                pageMetaResult.board = boardData;
            }
        }

        response.json(formatSuccessMessage("Page data fetched successfully",
            {
                ...pageMetaResult,
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