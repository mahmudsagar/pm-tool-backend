import { z } from 'zod';
import { deleteBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteBoardAndChildren } from '../utils/helper.js';
import { createNotification } from '../utils/notificationService.js';
import { snapshotBoard, createTrashItem } from '../utils/trash.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteBoardSchema.parse({ _id });

        if (validatedParams._id) {
            // Fetch board before deletion for notification
            const boardToDelete = await global.Board.findOne({ _id: validatedParams._id });
            
            // Snapshot everything the cascade removes so it can be restored from trash
            if (boardToDelete) {
                await createTrashItem({
                    entityType: 'board',
                    entityId: validatedParams._id,
                    snapshot: await snapshotBoard(validatedParams._id),
                    userId: request.user.id,
                    workspaceId: request.workspaceId,
                });
            }

            await deleteBoardAndChildren(validatedParams._id, { keepFiles: true });
            
            // Send notification
            if (boardToDelete) {
                await createNotification({
                    workspaceId: request.workspaceId,
                    entity: boardToDelete,
                    entityType: 'board',
                    action: 'delete',
                    currentUserId: request.user.id,
                    metadata: {
                        actor_name: request.user.name || 'User'
                    }
                });
            }
        } else {
            return response.status(400).json(formatErrorMessage('Board ID must be provided'));
        }

        response.json(formatSuccessMessage('Board deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};