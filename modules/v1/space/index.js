import { z } from 'zod';
import { getSpaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;

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
            return response.status(404).json(formatErrorMessage(error));
        }

        for (const spcae of result) {
            const groups = await global.Group.find({ space_id: spcae._id }).sort('createdAt ASC');
            const folders = await global.Folder.find({ space_id: spcae._id }).sort('createdAt ASC');
            const pageMeta = await global.PageMeta.find({ space_id: spcae._id }).sort('createdAt ASC');

            let combinedData = [...folders, ...groups, ...pageMeta];

            combinedData.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            spcae.childs = combinedData;
        }

        response.json(formatSuccessMessage("Spaces fetched successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};