import { z } from 'zod';
import { postFolderSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = postFolderSchema.parse(body);

        // Enforce parent sharing constraints
        const parentType = validatedData.space_id ? 'space' : validatedData.group_id ? 'group' : validatedData.parent_id ? 'folder' : null;
        const parentId = validatedData.space_id || validatedData.group_id || validatedData.parent_id;
        if (parentType && parentId) {
            await validateChildSharing(parentType, parentId, validatedData.shared_members, validatedData.shared_teams);
        }

        let result = await global.Folder.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        response.json(formatSuccessMessage("Folder created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};