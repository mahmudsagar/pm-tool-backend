import { z } from 'zod';
import { getRecentSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { resolveEntityRows, summarizeEntity } from '../utils/entities.js';

// GET /v1/recent?limit=20 (max 50) — newest first, skipping missing/inaccessible entities.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { limit } = getRecentSchema.parse({ limit: request.query.limit });

        // Rows are capped at 50 per user/workspace, so fetching all and filtering is cheap.
        const rows = await global.RecentItem.find({ user_id: userId, workspace_id: workspaceId }).sort('viewed_at DESC');
        const { live } = await resolveEntityRows(rows, userId, workspaceId);

        const data = live.slice(0, limit).map(({ row, entity }) => ({
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            viewed_at: row.viewed_at,
            entity: summarizeEntity(row.entity_type, entity),
        }));

        response.json(formatSuccessMessage('Recent items fetched successfully', data));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
