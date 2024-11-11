import { z } from 'zod';
import { getPageMetaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
	try {
		const { id } = request.query;

		// Validate the query parameters
		const validateQuery = getPageMetaSchema.parse({ _id: id });

		// Fetch PageMeta by _id
		const pageMetaResult = await global.PageMeta.findOne({ _id: validateQuery._id });
		if (!pageMetaResult) {
			return response.status(404).json({ status: 'failed', error: 'Page not found' });
		}

		// Fetch PageContent by page_content_id
		const pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });

		// Fetch media attachments if any
		const mediaAttachments = pageMetaResult.attachments && pageMetaResult.attachments.length > 0
			? await Promise.all(
				pageMetaResult.attachments.map(async (attachment) => {
					return await global.Media.findOne({ reference_id: pageMetaResult._id });
				})
			)
			: [];

		// Fetch commentsMeta by page_id
		const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id });
		const commentsWithMeta = await Promise.all(
			commentsMeta.map(async (comment) => {
				const commentContent = await global.CommentContent.findOne({ _id: comment.associate_id });
				const mediaAttachments = comment.attachments && comment.attachments.length > 0
					? await Promise.all(
						comment.attachments.map(async (attachment) => {
							return await global.Media.findOne({ reference_id: comment._id });
						})
					)
					: [];

				return { ...comment, commentContent, mediaAttachments };

			})
		);
		response.json({ status: "success", data: { ...pageMetaResult, pageContent: pageContentResult, mediaAttachments, comments: commentsWithMeta } });
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