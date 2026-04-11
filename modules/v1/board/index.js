import { z } from 'zod';
import { getBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;
        const workspaceId = request.workspaceId;
        const userId = request.user.id;

        const validateQuery = getBoardSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id) {
            result = await global.Board.find({ _id: validateQuery._id, workspace_id: workspaceId });
        } else {
            const allBoards = await global.Board.find({ workspace_id: workspaceId });
            const accessible = await Promise.all(
                allBoards.map(async (board) => (await canUserAccessEntity(board, userId, workspaceId)) ? board : null)
            );
            result = accessible.filter(Boolean);
        }

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