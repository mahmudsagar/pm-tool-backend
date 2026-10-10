import { formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { resolveEntityRows, summarizeEntity } from '../utils/entities.js';

// GET /v1/favorite — current user's favorites in the current workspace, newest first.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;

        const rows = await global.Favorite.find({ user_id: userId, workspace_id: workspaceId }).sort('created_at DESC');
        const { live, stale } = await resolveEntityRows(rows, userId, workspaceId);

        if (stale.length > 0) {
            await global.Favorite.destroy({ _id: { in: stale.map((r) => r._id) } });
        }

        const data = live.map(({ row, entity }) => ({
            _id: row._id,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            created_at: row.created_at,
            entity: summarizeEntity(row.entity_type, entity),
        }));

        response.json(formatSuccessMessage('Favorites fetched successfully', data));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
