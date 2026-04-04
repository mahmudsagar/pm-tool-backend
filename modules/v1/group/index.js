import { z } from 'zod';
import { getGroupSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, user_id, workspace_id } = request.query;

        // Validate the query parameters
        const validateQuery = getGroupSchema.parse({ _id: id, user_id });

        const query = {};
        if (validateQuery._id) query._id = validateQuery._id;
        if (validateQuery.user_id) query.user_id = validateQuery.user_id;
        if (workspace_id) query.workspace_id = workspace_id;

        let result = await global.Group.find(query);

        if (!result || (Array.isArray(result) && result.length === 0)) {
            const error = validateQuery._id && validateQuery.user_id ?
                'Group not found for the given _id and user_id' :
                validateQuery._id ?
                    'Group not found' :
                    validateQuery.user_id ?
                        'No groups found for the given user_id' :
                        'No groups found';
            return response.status(404).json(formatErrorMessage(error));
        }

        for (const group of result) {
            const folders = await global.Folder.find({ group_id: group._id }).sort('createdAt ASC');
            const boards = await global.Board.find({ group_id: group._id }).sort('createdAt ASC');
            const pageMeta = await global.PageMeta.find({ group_id: group._id }).sort('createdAt ASC');

            let combinedData = [...folders, ...boards, ...pageMeta];

            combinedData.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            group.childs = combinedData;
        }

        response.json(formatSuccessMessage("Groups fetched successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            // Handle other errors
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};