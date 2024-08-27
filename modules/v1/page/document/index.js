import { z } from 'zod';
import { getDocumentSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
	try {
		const { id } = request.query;

		let result;
		if (id) {
			// Validate the _id if present in query
			const validatedParams = getDocumentSchema.parse({ _id: id });

			// Fetch document by _id
			const document = await global.Document.findOne({ _id: validatedParams._id });
			if (!document) {
				return response.status(404).json({ status: 'failed', error: 'Document not found' });
			}

			// Fetch page_meta by page_content_id
			const pageMeta = await global.PageMeta.findOne({ page_content_id: validatedParams._id });
			if (!pageMeta) {
				return response.status(404).json({ status: 'failed', error: 'PageMeta not found' });
			}

			result = { ...document, pageMeta };
		} else {
			// Fetch all page_meta entries
			const pageMetas = await global.PageMeta.find();

			// Populate each page_meta with its corresponding document
			const populatedPageMetas = await Promise.all(pageMetas.map(async (pageMeta) => {
				const document = await global.Document.findOne({ _id: pageMeta.page_content_id });
				return { ...document, pageMeta };
			}));

			result = populatedPageMetas;
		}

		response.json({ status: "success", data: result });
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