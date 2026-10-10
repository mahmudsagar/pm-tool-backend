import { z } from 'zod';
import { deleteTrashSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { purgeTrashItems, isWorkspaceAdmin } from '../utils/trash.js';

// DELETE /v1/trash?id=<trashItemId>  — permanently delete one item
// DELETE /v1/trash?all=true          — empty the trash (owner/admin: whole workspace; members: own items)
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { id, all } = deleteTrashSchema.parse({ id: request.query.id, all: request.query.all });
        const isAdmin = await isWorkspaceAdmin(workspaceId, userId);

        if (id) {
            const item = await global.TrashItem.findOne({ _id: id, workspace_id: workspaceId });
            if (!item) {
                return response.status(404).json(formatErrorMessage('Trash item not found'));
            }
            if (!isAdmin && String(item.deleted_by) !== String(userId)) {
                return response.status(403).json(formatErrorMessage('Access denied to this resource'));
            }
            await purgeTrashItems([item]);
            return response.json(formatSuccessMessage('Trash item deleted permanently', { deleted: 1 }));
        }

        if (all === 'true') {
            const criteria = isAdmin
                ? { workspace_id: workspaceId }
                : { workspace_id: workspaceId, deleted_by: userId };
            const items = await global.TrashItem.find(criteria);
            const deleted = await purgeTrashItems(items);
            return response.json(formatSuccessMessage('Trash emptied', { deleted }));
        }

        response.status(400).json(formatErrorMessage('Either id or all=true must be provided'));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
