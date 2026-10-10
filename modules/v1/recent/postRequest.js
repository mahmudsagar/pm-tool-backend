import { z } from 'zod';
import { recentEntitySchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { loadEntity, isEntityAccessible } from '../utils/entities.js';

const MAX_RECENT = 50;

// POST /v1/recent { entity_type, entity_id } — record a view (upsert viewed_at = now).
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { entity_type, entity_id } = recentEntitySchema.parse(request.body || {});

        const entity = await loadEntity(entity_type, entity_id);
        if (!entity) {
            return response.status(404).json(formatErrorMessage('Entity not found'));
        }
        if (!(await isEntityAccessible(entity_type, entity, userId, workspaceId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }

        const key = { user_id: userId, entity_type, entity_id };
        const now = new Date();
        let item = await global.RecentItem.updateOne(key).set({ viewed_at: now, workspace_id: workspaceId });
        if (!item) {
            try {
                item = await global.RecentItem.create({ ...key, workspace_id: workspaceId, viewed_at: now }).fetch();
            } catch (createErr) {
                // Concurrent first view (unique index) — fall back to updating the winner's row.
                item = await global.RecentItem.updateOne(key).set({ viewed_at: now, workspace_id: workspaceId });
                if (!item) throw createErr;
            }
        }

        // Keep at most MAX_RECENT per user/workspace.
        const overflow = await global.RecentItem.find({ user_id: userId, workspace_id: workspaceId })
            .sort('viewed_at DESC')
            .skip(MAX_RECENT);
        if (overflow.length > 0) {
            await global.RecentItem.destroy({ _id: { in: overflow.map((r) => r._id) } });
        }

        response.json(formatSuccessMessage('Recent item recorded', {
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            viewed_at: item.viewed_at,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
