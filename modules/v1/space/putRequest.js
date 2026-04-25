import { z } from 'zod';
import { putSpaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { createNotification } from '../utils/notificationService.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        const existingSpace = await global.Space.findOne({ _id });
        if (!existingSpace) {
            return response.status(404).json(formatErrorMessage('Space not found'));
        }

        if ('is_default' in rest) {
            return response.status(404).json(formatErrorMessage('Cannot change the is_default field'));
        }

        if (existingSpace.is_default && 'is_private' in rest && rest.is_private !== existingSpace.is_private) {
            return response.status(404).json(formatErrorMessage('Cannot change the is_private field when is_default is true'));
        }

        const validatedData = putSpaceSchema.parse({ _id, ...rest });

        // Strip _id from update values — Waterline/MongoDB cannot update the primary key
        const { _id: _stripped, ...updateValues } = validatedData;

        let result = await global.Space.update({ _id }, updateValues).fetch();
        if (result.length > 0) result = result[0];
        
        // Send notification
        await createNotification({
            workspaceId: request.workspaceId,
            entity: result,
            entityType: 'space',
            action: 'update',
            currentUserId: request.user.id,
            metadata: {
                actor_name: request.user.name || 'User',
                changes: Object.keys(rest).filter(k => rest[k] !== undefined)
            }
        });

        response.json(formatSuccessMessage("Space updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};