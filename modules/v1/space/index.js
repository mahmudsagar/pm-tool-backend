import { z } from 'zod';
import { getSpaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id, user_id } = request.query;
        const workspaceId = request.workspaceId;
        const userId = request.user.id;

        const validateQuery = getSpaceSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id) {
            // Single lookup by ID
            result = await global.Space.find({ _id: validateQuery._id, workspace_id: workspaceId });
        } else {
            // Return all workspace spaces the requesting user can access
            const allSpaces = await global.Space.find({ workspace_id: workspaceId });
            const accessible = await Promise.all(
                allSpaces.map(async (space) => (await canUserAccessEntity(space, userId, workspaceId)) ? space : null)
            );
            result = accessible.filter(Boolean);
        }

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
            const boards = await global.Board.find({ space_id: spcae._id }).sort('createdAt ASC');
            const pageMeta = await global.PageMeta.find({ space_id: spcae._id }).sort('createdAt ASC');

            let combinedData = [...folders, ...groups, ...boards, ...pageMeta];

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