import { z } from 'zod';
import { putBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';
import { createNotification } from '../utils/notificationService.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        const validatedData = putBoardSchema.parse({ _id, ...rest });

        // Enforce parent sharing constraints if sharing is being changed
        if (validatedData.shared_members || validatedData.shared_teams) {
            const existingBoard = await global.Board.findOne({ _id: validatedData._id });
            if (existingBoard) {
                const parentType = existingBoard.folder_id ? 'folder' : existingBoard.space_id ? 'space' : existingBoard.group_id ? 'group' : null;
                const parentId = existingBoard.folder_id || existingBoard.space_id || existingBoard.group_id;
                if (parentType && parentId) {
                    await validateChildSharing(parentType, parentId, validatedData.shared_members ?? existingBoard.shared_members, validatedData.shared_teams ?? existingBoard.shared_teams);
                }
            }
        }

        let result = await global.Board.update({ _id: validatedData._id }, validatedData).fetch();
        if (result.length > 0) result = result[0];
        
        // Send notification
        await createNotification({
            workspaceId: request.workspaceId,
            entity: result,
            entityType: 'board',
            action: 'update',
            currentUserId: request.user.id,
            metadata: {
                actor_name: request.user.name || 'User',
                changes: Object.keys(rest).filter(k => rest[k] !== undefined)
            }
        });

        response.json(formatSuccessMessage("Board updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};