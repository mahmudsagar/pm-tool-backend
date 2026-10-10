import { z } from 'zod';
import { restoreTrashSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { restoreTrashItem, isWorkspaceAdmin, RestoreError } from '../../utils/trash.js';

// POST /v1/trash/restore { id } — re-insert the snapshot (original _ids) and remove the trash item.
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const { id } = restoreTrashSchema.parse(request.body || {});

        const item = await global.TrashItem.findOne({ _id: id, workspace_id: workspaceId });
        if (!item) {
            return response.status(404).json(formatErrorMessage('Trash item not found'));
        }
        if (String(item.deleted_by) !== String(userId) && !(await isWorkspaceAdmin(workspaceId, userId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }
        if (item.expires_at && new Date(item.expires_at) < new Date()) {
            return response.status(410).json(formatErrorMessage('Trash item has expired'));
        }

        const result = await restoreTrashItem(item);
        response.json(formatSuccessMessage('Restored successfully', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else if (err instanceof RestoreError) {
            response.status(err.status).json(formatErrorMessage(err.message));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
