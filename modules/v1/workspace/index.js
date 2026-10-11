import { z } from 'zod';
import { getWorkspaceSchema, WORKSPACE_DEFAULTS } from './config/validation.js';

// Older rows predate the settings fields; fill defaults so the response shape is stable.
const withDefaults = (workspace) => {
    const filled = { ...workspace };
    for (const [key, value] of Object.entries(WORKSPACE_DEFAULTS)) {
        if (filled[key] === undefined || filled[key] === null) filled[key] = value;
    }
    return filled;
};
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id } = request.query;
        const userId = request.user.id;

        if (id) {
            const validateQuery = getWorkspaceSchema.parse({ _id: id });

            const result = await global.Workspace.findOne({
                _id: validateQuery._id,
                or: [
                    { owner_id: userId },
                    { members: { contains: userId } }
                ]
            });

            if (!result) {
                return response.status(404).json(formatErrorMessage('Workspace not found'));
            }

            return response.json(formatSuccessMessage("Workspace fetched successfully", withDefaults(result)));
        }

        const result = await global.Workspace.find({
            or: [
                { owner_id: userId },
                { members: { contains: userId } }
            ]
        });

        if (!result || result.length === 0) {
            return response.status(404).json(formatErrorMessage('No workspaces found'));
        }

        response.json(formatSuccessMessage("Workspaces fetched successfully", result.map(withDefaults)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
