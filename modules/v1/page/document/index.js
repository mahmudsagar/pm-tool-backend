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
				pageMetaResult.attachments.map(async (attachment) => {
					return await global.Media.findOne({ _id: attachment });
				})
			)
			: [];

		const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id, inner_comment: false });
		const commentsWithMeta = await Promise.all(
			commentsMeta.map(async (comment) => {
				const commentContent = await global.CommentContent.findOne({ _id: comment.associate_id });
				const mediaAttachments = comment.attachments && comment.attachments.length > 0
					? await Promise.all(
						comment.attachments.map(async (attachment) => {
							return await global.Media.findOne({ _id: attachment });
						})
					)
					: [];

				return { ...comment, commentContent, mediaAttachments };

			})
		);

		// Fetch inner comments
		const innerComments = await global.CommentMeta.find({ page_id: pageMetaResult._id, inner_comment: true });
		const innerCommentsWithMeta = await Promise.all(
			innerComments.map(async (innerComment) => {
				const innerCommentContent = await global.CommentContent.findOne({ _id: innerComment.associate_id });

				// Fetch child comments for inner comments
				const childComments = await global.CommentMeta.find({ parent_id: innerComment._id });
				const childCommentsWithMeta = await Promise.all(
					childComments.map(async (childComment) => {
						const childCommentContent = await global.CommentContent.findOne({ _id: childComment.associate_id });
						const childMediaAttachments = childComment.attachments && childComment.attachments.length > 0
							? await Promise.all(
								childComment.attachments.map(async (attachment) => {
									return await global.Media.findOne({ _id: attachment });
								})
							)
							: [];
						return { ...childComment, commentContent: childCommentContent, mediaAttachments: childMediaAttachments };
					})
				);

				return { ...innerComment, commentContent: innerCommentContent, childComments: childCommentsWithMeta };
			})
		);

		response.json(formatSuccessMessage("Page data fetched successfully",
			{
				...pageMetaResult,
				pageContent: pageContentResult,
				mediaAttachments,
				comments: commentsWithMeta,
				innerComments: innerCommentsWithMeta
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