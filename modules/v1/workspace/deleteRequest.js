import { z } from 'zod';
import { deleteWorkspaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { deleteFolderAndChildren, deleteGroupFolderAndChildren, deleteBoardAndChildren } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deleteWorkspaceSchema.parse({ _id });

        const workspace = await global.Workspace.findOne({ _id: validatedParams._id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        if (workspace.owner_id !== request.user.id) {
            return response.status(403).json(formatErrorMessage('Only the workspace owner can delete this workspace'));
        }

        // Cascade delete all entities belonging to this workspace
        const workspaceId = workspace._id;

        // Delete all boards and their children
        const boards = await global.Board.find({ workspace_id: workspaceId });
        for (const board of boards) {
            await deleteBoardAndChildren(board._id);
        }

        // Delete all folders and their children
        const folders = await global.Folder.find({ workspace_id: workspaceId, parent_id: undefined });
        for (const folder of folders) {
            await deleteFolderAndChildren(folder._id);
        }

        // Delete all groups and their children
        const groups = await global.Group.find({ workspace_id: workspaceId });
        for (const group of groups) {
            await deleteGroupFolderAndChildren(group._id);
            await global.Group.destroyOne({ _id: group._id });
        }

        // Delete all spaces
        await global.Space.destroy({ workspace_id: workspaceId });

        // Delete all teams
        await global.Team.destroy({ workspace_id: workspaceId });

        // Delete custom meta
        await global.CustomMeta.destroy({ workspace_id: workspaceId });

        // Delete the workspace itself
        await global.Workspace.destroyOne({ _id: workspaceId });

        response.json(formatSuccessMessage('Workspace deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
