import { z } from 'zod';
import { getHistorySchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { page_id, limit, skip } = getHistorySchema.parse(request.query || {});

        // Verify the page exists
        const page = await global.PageMeta.findOne({ _id: page_id });
        if (!page) {
            return response.status(404).json(formatErrorMessage('Page not found'));
        }

        // Fetch all matching entries then apply skip/limit in JS to avoid relying on
        // adapter-specific query options that may not be supported uniformly.
        const allHistory = await global.PageHistory.find({ page_id });

        // Sort descending by version
        allHistory.sort((a, b) => b.version - a.version);

        const total = allHistory.length;
        const paged = allHistory.slice(skip, skip + limit);

        // Enrich with user info
        const enriched = await Promise.all(
            paged.map(async (entry) => {
                const user = await global.User.findOne({ _id: entry.user_id });
                return {
                    ...entry,
                    user: user
                        ? { _id: user._id, name: user.name, email: user.email, avatar: user.avatar }
                        : { _id: entry.user_id, name: 'Unknown User' },
                };
            })
        );

        response.json(
            formatSuccessMessage('History fetched successfully', {
                history: enriched,
                total,
                page_id,
            })
        );
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
