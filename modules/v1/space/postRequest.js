import { z } from 'zod';
import { postSpaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { createNotification } from '../utils/notificationService.js';
import { isWorkspaceAdmin } from '../utils/workspaceAccess.js';

export default async (request, response) => {
    try {
        const body = request.body;

        const validatedData = postSpaceSchema.parse(body);

        // Workspace policy: members may be barred from creating public spaces (unset = allowed).
        // Default spaces (onboarding) are exempt.
        if (validatedData.is_private === false && !validatedData.is_default) {
            const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
            if (workspace?.space_policies?.allow_member_public_create === false
                && !isWorkspaceAdmin(workspace, request.user.id)) {
                return response.status(403).json(formatErrorMessage('Only admins can create public spaces'));
            }
        }

        if (validatedData.is_default) {
            const existingDefaultSpaces = await global.Space.find({
                user_id: validatedData.user_id,
                is_default: true,
                is_private: validatedData.is_private
            });

            if (existingDefaultSpaces.length > 0) {
                return response.status(404).json(formatErrorMessage(`User already has a default ${validatedData.is_private ? 'private' : 'public'} space`));
            }
        }

        let result = await global.Space.create({ ...validatedData, workspace_id: request.workspaceId }).fetch();
        
        // Send notification
        await createNotification({
            workspaceId: request.workspaceId,
            entity: result,
            entityType: 'space',
            action: 'create',
            currentUserId: request.user.id,
            metadata: {
                actor_name: request.user.name || 'User'
            }
        });

        response.json(formatSuccessMessage("Space created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};