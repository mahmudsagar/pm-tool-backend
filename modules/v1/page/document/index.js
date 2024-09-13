import { z } from 'zod';
import { getDocumentSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

export default async (request, response) => {
	try {
		const { id, user_id } = request.query;

		// Validate the query parameters
		const validateQuery = getDocumentSchema.parse({ _id: id, user_id });

		let documentResult;
		let pageMetaResult;

		if (validateQuery._id && validateQuery.user_id) {
			// Fetch data by both _id and user_id
			documentResult = await global.Document.findOne({ _id: validateQuery._id, user_id: validateQuery.user_id });
			if (!documentResult) {
				return response.status(404).json({ status: 'failed', error: 'Document not found for the given _id and user_id' });
			}

			// Fetch page meta by page_content_id
			pageMetaResult = await global.PageMeta.findOne({ page_content_id: validateQuery._id });
		} else if (validateQuery._id) {
			// Fetch data by _id
			documentResult = await global.Document.findOne({ _id: validateQuery._id });
			if (!documentResult) {
				return response.status(404).json({ status: 'failed', error: 'Document not found' });
			}

			// Fetch page meta by page_content_id
			pageMetaResult = await global.PageMeta.findOne({ page_content_id: validateQuery._id });
		} else if (validateQuery.user_id) {
			// Fetch data by user_id
			documentResult = await global.Document.find({ user_id: validateQuery.user_id });
			if (documentResult.length === 0) {
				return response.status(404).json({ status: 'failed', error: 'No documents found for the given user_id' });
			}

			// Fetch page meta for each document by page_content_id
			pageMetaResult = await Promise.all(
				documentResult.map(async (doc) => {
					const pageMeta = await global.PageMeta.findOne({ page_content_id: doc._id });
					return { ...doc, pageMeta };
				})
			);

			return response.json({ status: "success", data: pageMetaResult });
		} else {
			// Fetch all documents
			documentResult = await global.Document.find();

			// Fetch page meta for each document by page_content_id
			pageMetaResult = await Promise.all(
				documentResult.map(async (doc) => {
					const pageMeta = await global.PageMeta.findOne({ page_content_id: doc._id });
					return { ...doc, pageMeta };
				})
			);

			return response.json({ status: "success", data: pageMetaResult });
		}

		response.json({ status: "success", data: { ...documentResult, pageMeta: pageMetaResult } });
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