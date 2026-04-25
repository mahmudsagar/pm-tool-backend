import { z } from 'zod';
import { putFolderSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';
import { createNotification } from '../utils/notificationService.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        const validatedData = putFolderSchema.parse({ _id, ...rest });

        // Enforce parent sharing constraints if sharing is being changed
        if (validatedData.shared_members || validatedData.shared_teams) {
            const existingFolder = await global.Folder.findOne({ _id: validatedData._id });
            if (existingFolder) {
                const parentType = existingFolder.space_id ? 'space' : existingFolder.group_id ? 'group' : existingFolder.parent_id ? 'folder' : null;
                const parentId = existingFolder.space_id || existingFolder.group_id || existingFolder.parent_id;
                if (parentType && parentId) {
                    await validateChildSharing(parentType, parentId, validatedData.shared_members ?? existingFolder.shared_members, validatedData.shared_teams ?? existingFolder.shared_teams);
                }
            }
        }

        let result = await global.Folder.update({ _id: validatedData._id }, validatedData).fetch();
        if (result.length > 0) result = result[0];
        
        // Send notification
        await createNotification({
            workspaceId: request.workspaceId,
            entity: result,
            entityType: 'folder',
            action: 'update',
            currentUserId: request.user.id,
            metadata: {
                actor_name: request.user.name || 'User',
                changes: Object.keys(rest).filter(k => rest[k] !== undefined)
            }
        });

        response.json(formatSuccessMessage("Folder updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};