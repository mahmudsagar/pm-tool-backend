import { z } from 'zod';
import { searchSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';

export default async (request, response) => {
    try {
        const { query, limit = 20, user_id } = request.query;
        const workspaceId = request.workspaceId;
        const userId = request.user.id;

        // Validate the query parameters
        const validateQuery = searchSchema.parse({
            query,
            limit: parseInt(limit) || 20,
            user_id
        });

        const searchRegex = validateQuery.query;
        const workspaceFilter = workspaceId ? { workspace_id: workspaceId } : {};
        const userFilter = validateQuery.user_id ? { user_id: validateQuery.user_id } : {};

        const filterByAccess = async (items) => {
            const results = await Promise.all(
                items.map(async (item) => (await canUserAccessEntity(item, userId, workspaceId)) ? item : null)
            );
            return results.filter(Boolean);
        };

        // Search results arrays
        let folderResults = [];
        let pageResults = [];
        let groupResults = [];
        let teamResults = [];
        let spaceResults = [];
        let boardResults = [];

        try {
            const raw = await global.Folder.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            folderResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Folder search error:', e);
        }

        try {
            const raw = await global.PageMeta.find({
                where: {
                    title: { contains: searchRegex },
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            pageResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Page search error:', e);
        }

        try {
            const raw = await global.Group.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            groupResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Group search error:', e);
        }

        try {
            const raw = await global.Team.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            teamResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Team search error:', e);
        }

        try {
            const raw = await global.Space.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            spaceResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Space search error:', e);
        }

        try {
            const raw = await global.Board.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...workspaceFilter,
                    ...userFilter
                },
                limit: validateQuery.limit
            });
            boardResults = await filterByAccess(raw);
        } catch (e) {
            console.error('Board search error:', e);
        }

        const results = {
            total: folderResults.length + pageResults.length + groupResults.length + teamResults.length + spaceResults.length + boardResults.length,
            all: {
                folders: folderResults.map(item => ({ ...item, type: 'folder' })),
                pages: pageResults.map(item => ({ ...item, type: 'page' })),
                groups: groupResults.map(item => ({ ...item, type: 'group' })),
                teams: teamResults.map(item => ({ ...item, type: 'team' })),
                spaces: spaceResults.map(item => ({ ...item, type: 'space' })),
                boards: boardResults.map(item => ({ ...item, type: 'board' })),
            }
        };

        response.json(formatSuccessMessage('Search results', results));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(500).json(formatErrorMessage(err.message));
        }
    }
};