import { z } from 'zod';
import { searchSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { query, limit = 20, user_id } = request.query;

        // Validate the query parameters
        const validateQuery = searchSchema.parse({
            query,
            limit: parseInt(limit) || 20,
            user_id
        });

        // Search results arrays
        let folderResults = [];
        let pageResults = [];
        let groupResults = [];
        let teamResults = [];
        let spaceResults = [];

        // Create regex search pattern (case insensitive)
        const searchRegex = validateQuery.query;

        // Base search using Waterline's where criteria
        // Use directly supported query syntax without $or operator
        try {
            folderResults = await global.Folder.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...(validateQuery.user_id ? { user_id: validateQuery.user_id } : {})
                },
                limit: validateQuery.limit
            });
        } catch (e) {
            console.error('Folder search error:', e);
        }

        try {
            pageResults = await global.PageMeta.find({
                where: {
                    title: { contains: searchRegex },
                    ...(validateQuery.user_id ? { user_id: validateQuery.user_id } : {})
                },
                limit: validateQuery.limit
            });
        } catch (e) {
            console.error('Page search error:', e);
        }

        try {
            groupResults = await global.Group.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...(validateQuery.user_id ? { user_id: validateQuery.user_id } : {})
                },
                limit: validateQuery.limit
            });
        } catch (e) {
            console.error('Group search error:', e);
        }

        try {
            teamResults = await global.Team.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...(validateQuery.user_id ? { user_id: validateQuery.user_id } : {})
                },
                limit: validateQuery.limit
            });
        } catch (e) {
            console.error('Team search error:', e);
        }

        try {
            spaceResults = await global.Space.find({
                where: {
                    or: [
                        { name: { contains: searchRegex } },
                        { description: { contains: searchRegex } }
                    ],
                    ...(validateQuery.user_id ? { user_id: validateQuery.user_id } : {})
                },
                limit: validateQuery.limit
            });
        } catch (e) {
            console.error('Space search error:', e);
        }

        // Process and enrich search results
        const results = {
            folders: folderResults.map(item => ({ ...item, type: 'folder' })),
            pages: pageResults.map(item => ({ ...item, type: 'page' })),
            groups: groupResults.map(item => ({ ...item, type: 'group' })),
            teams: teamResults.map(item => ({ ...item, type: 'team' })),
            spaces: spaceResults.map(item => ({ ...item, type: 'space' })),
            total: folderResults.length + pageResults.length + groupResults.length + teamResults.length + spaceResults.length,
            all: [
                ...folderResults.map(item => ({ ...item, type: 'folder' })),
                ...pageResults.map(item => ({ ...item, type: 'page' })),
                ...groupResults.map(item => ({ ...item, type: 'group' })),
                ...teamResults.map(item => ({ ...item, type: 'team' })),
                ...spaceResults.map(item => ({ ...item, type: 'space' })),
            ]
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