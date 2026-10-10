import { formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { purgeExpiredTrash, isWorkspaceAdmin, countSnapshotItems } from '../utils/trash.js';

// GET /v1/trash — workspace trash, newest first. Owners/admins see everything,
// other members see only what they deleted. Expired items are purged first.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;

        await purgeExpiredTrash(workspaceId);

        const isAdmin = await isWorkspaceAdmin(workspaceId, userId);
        const criteria = isAdmin
            ? { workspace_id: workspaceId }
            : { workspace_id: workspaceId, deleted_by: userId };
        const items = await global.TrashItem.find(criteria).sort('deleted_at DESC');

        const userIds = [...new Set(items.map((item) => item.deleted_by).filter(Boolean))];
        const users = userIds.length > 0 ? await global.User.find({ _id: { in: userIds } }) : [];
        const usersById = new Map(users.map((u) => [String(u._id), u]));

        const data = items.map((item) => {
            const user = usersById.get(String(item.deleted_by));
            return {
                _id: item._id,
                entity_type: item.entity_type,
                entity_id: item.entity_id,
                name: item.name,
                page_type: item.page_type || null,
                parent: item.parent || {},
                deleted_at: item.deleted_at,
                expires_at: item.expires_at,
                deleted_by: user
                    ? { _id: user._id, name: user.name, email: user.email, avatar: user.avatar || '' }
                    : { _id: item.deleted_by, name: '', email: '', avatar: '' },
                item_count: countSnapshotItems(item.snapshot),
            };
        });

        response.json(formatSuccessMessage('Trash fetched successfully', data));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
