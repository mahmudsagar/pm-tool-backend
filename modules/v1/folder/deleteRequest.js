import { z } from 'zod';
import { deleteFolderSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteFolderAndChildren } from '../utils/helper.js';
import { createNotification } from '../utils/notificationService.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteFolderSchema.parse({ _id });

        if (validatedParams._id) {
            // Fetch folder before deletion for notification
            const folderToDelete = await global.Folder.findOne({ _id: validatedParams._id });
            
            await deleteFolderAndChildren(validatedParams._id);
            
            // Send notification
            if (folderToDelete) {
                await createNotification({
                    workspaceId: request.workspaceId,
                    entity: folderToDelete,
                    entityType: 'folder',
                    action: 'delete',
                    currentUserId: request.user.id,
                    metadata: {
                        actor_name: request.user.name || 'User'
                    }
                });
            }
        } else {
            return response.status(400).json(formatErrorMessage('Folder ID must be provided'));
        }

        response.json(formatSuccessMessage('Folder deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};