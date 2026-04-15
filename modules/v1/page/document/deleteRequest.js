import { z } from 'zod';
import { deletePageMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { deleteAttachments } from '../../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deletePageMetaSchema.parse({ _id });

        if (validatedParams._id) {
            const pageMeta = await global.PageMeta.findOne({ _id: validatedParams._id });
            if (!pageMeta) {
                return response.status(404).json(formatErrorMessage('PageMeta not found'));
            }

            if (pageMeta.attachments && pageMeta.attachments.length > 0) {
                await deleteAttachments(pageMeta.attachments);
            }

            await global.PageMeta.destroy({ _id: validatedParams._id });

            const pageContentResult = await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }

            // Delete all comments related to the page
            const commentsMeta = await global.CommentMeta.find({ page_id: validatedParams._id });
            for (const commentMeta of commentsMeta) {
                if (commentMeta.attachments && commentMeta.attachments.length > 0) {
                    await deleteAttachments(commentMeta.attachments);
                }

                await global.CommentMeta.destroy({ _id: commentMeta._id });

                if (commentMeta.associate_id) {
                    await global.CommentContent.destroyOne({ _id: commentMeta.associate_id });
                }

                // Delete child comments
                if (commentMeta.has_childs) {
                    const childCommentsMeta = await global.CommentMeta.find({ parent_id: commentMeta._id });
                    for (const childCommentMeta of childCommentsMeta) {
                        if (childCommentMeta.attachments && childCommentMeta.attachments.length > 0) {
                            await deleteAttachments(childCommentMeta.attachments);
                        }

                        await global.CommentMeta.destroy({ _id: childCommentMeta._id });

                        if (childCommentMeta.associate_id) {
                            await global.CommentContent.destroyOne({ _id: childCommentMeta.associate_id });
                        }
                    }
                }
            }
        } else {
            return response.status(400).json(formatErrorMessage('Page ID must be provided'));
        }

        response.json(formatSuccessMessage('Page deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};