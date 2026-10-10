import { z } from 'zod';
import { deleteGroupSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteGroupFolderAndChildren } from '../utils/helper.js';
import { snapshotGroup, createTrashItem } from '../utils/trash.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteGroupSchema.parse({ _id });

        if (validatedParams._id) {
            // Snapshot everything the cascade (and the final Group.destroyOne) removes for the trash
            const snapshot = await snapshotGroup(validatedParams._id);
            await createTrashItem({
                entityType: 'group',
                entityId: validatedParams._id,
                snapshot,
                userId: request.user.id,
                workspaceId: request.workspaceId,
            });

            await deleteGroupFolderAndChildren(validatedParams._id, { keepFiles: true }); // Assuming similar structure for group
        } else {
            return response.status(400).json(formatErrorMessage('Group ID must be provided'));
        }

        // deleting the group at last
        await global.Group.destroyOne({ _id: validatedParams._id });

        response.json(formatSuccessMessage('Group deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};