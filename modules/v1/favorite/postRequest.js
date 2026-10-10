import { z } from 'zod';
import { favoriteEntitySchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { loadEntity, isEntityAccessible, summarizeEntity } from '../utils/entities.js';

// POST /v1/favorite { entity_type, entity_id } — idempotent star.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { entity_type, entity_id } = favoriteEntitySchema.parse(request.body || {});

        const entity = await loadEntity(entity_type, entity_id);
        if (!entity) {
            return response.status(404).json(formatErrorMessage('Entity not found'));
        }
        if (!(await isEntityAccessible(entity_type, entity, userId, workspaceId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }

        const key = { user_id: userId, entity_type, entity_id };
        let favorite = await global.Favorite.findOne(key);
        if (!favorite) {
            try {
                favorite = await global.Favorite.create({
                    ...key,
                    workspace_id: workspaceId,
                    created_at: new Date(),
                }).fetch();
            } catch (createErr) {
                // Lost a race against a concurrent request (unique index) — return the existing row.
                favorite = await global.Favorite.findOne(key);
                if (!favorite) throw createErr;
            }
        }

        response.json(formatSuccessMessage('Favorite added successfully', {
            _id: favorite._id,
            entity_type: favorite.entity_type,
            entity_id: favorite.entity_id,
            created_at: favorite.created_at,
            entity: summarizeEntity(entity_type, entity),
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
