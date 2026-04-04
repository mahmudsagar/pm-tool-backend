import { z } from 'zod';
import { getBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, user_id, workspace_id } = request.query;

        const validateQuery = getBoardSchema.parse({ _id: id, user_id });

        const query = {};
        if (validateQuery._id) query._id = validateQuery._id;
        if (validateQuery.user_id) query.user_id = validateQuery.user_id;
        if (workspace_id) query.workspace_id = workspace_id;

        let result = await global.Board.find(query);

        if (!result || (Array.isArray(result) && result.length === 0)) {
            const error = validateQuery._id && validateQuery.user_id ?
                'Board not found for the given _id and user_id' :
                validateQuery._id ?
                    'Board not found' :
                    validateQuery.user_id ?
                        'No boards found for the given user_id' :
                        'No boards found';
            return response.status(404).json(formatErrorMessage(error));
        }

        for (const board of result) {
            const pageMetas = await global.PageMeta.find({ board_id: board._id }).sort('createdAt ASC');
            board.documents = pageMetas;
        }
        response.json(formatSuccessMessage("Boards fetched successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};