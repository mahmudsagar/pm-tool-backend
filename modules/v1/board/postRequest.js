import { z } from 'zod';
import { postBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { validateChildSharing } from '../utils/helper.js';
import { createNotification } from '../utils/notificationService.js';

export default async (request, response) => {
    try {
        const body = request.body;

        const validatedData = postBoardSchema.parse({
            name: body.name,
            description: body.description,
            is_private: body.is_private,
            shared_members: body.shared_members,
            shared_teams: body.shared_teams,
            user_id: body.user_id,
            pinned: body.pinned,
            folder_id: body.folder_id,
            space_id: body.space_id,
            group_id: body.group_id,
            custom_meta: body.custom_meta,
            automations: body.automations,
            saved_view: body.saved_view,
        });

        // Enforce parent sharing constraints
        const parentType = validatedData.folder_id ? 'folder' : validatedData.space_id ? 'space' : validatedData.group_id ? 'group' : null;
        const parentId = validatedData.folder_id || validatedData.space_id || validatedData.group_id;
        if (parentType && parentId) {
            await validateChildSharing(parentType, parentId, validatedData.shared_members, validatedData.shared_teams);
        }

        let result = await global.Board.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        
        // Send notification
        await createNotification({
            workspaceId: request.workspaceId,
            entity: result,
            entityType: 'board',
            action: 'create',
            currentUserId: request.user.id,
            metadata: {
                actor_name: request.user.name || 'User'
            }
        });

        response.json(formatSuccessMessage("Board created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};

