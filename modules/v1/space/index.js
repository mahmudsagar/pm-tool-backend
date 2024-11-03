import { z } from 'zod';
import { getSpaceSchema } from './config/validation.js';
import { formatZodErrors } from '../utils/error.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;

        // Validate the query parameters
        const validateQuery = getSpaceSchema.parse({ _id: id, user_id });

        const query = {};
        if (validateQuery._id) query._id = validateQuery._id;
        if (validateQuery.user_id) query.user_id = validateQuery.user_id;

        let result = await global.Space.find(query);

        if (!result || (Array.isArray(result) && result.length === 0)) {
            const error = validateQuery._id && validateQuery.user_id ?
                'Space not found for the given _id and user_id' :
                validateQuery._id ?
                    'Space not found' :
                    validateQuery.user_id ?
                        'No spaces found for the given user_id' :
                        'No spaces found';
            return response.status(404).json({ status: 'failed', error });
        }

        // Fetch related data from Group, Folder, and Document collections for each space _id
        for (const space of result) {
            const groups = await global.Group.find({ space_id: space._id }).sort('createdAt ASC');
            const folders = await global.Folder.find({ space_id: space._id }).sort('createdAt ASC');
            const documents = await global.Document.find({ space_id: space._id }).sort('createdAt ASC');

            // Initialize an empty array for combined data
            let combinedData = [...groups, ...folders];

            // Check if documents is not an empty array
            if (documents.length > 0) {
                // Find the page_meta under the document
                for (const document of documents) {
                    const pageMeta = await global.PageMeta.find({ page_content_id: document._id });
                    document.pageMeta = pageMeta;
                }
                combinedData = [...combinedData, ...documents];
            }

            // Sort all data by createdAt
            combinedData.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            // Add the combined data to the space under the 'child' array
            space.childs = combinedData;
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