import { z } from 'zod';
import { getPageMetaSchema } from '../document/config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isEntityAccessible } from '../../utils/entities.js';

const MAX_VIEWERS = 8;

/**
 * GET /v1/page/stats?id=<page id>
 * → { views, viewers: [{ _id, name, email, avatar, viewed_at }], comment_count, updatedAt,
 *     last_updated_by: { _id, name, avatar } | null }
 *
 * views         distinct users with a recent_item row for this page (entity_type 'page')
 * viewers       the MAX_VIEWERS most recent of them
 * comment_count comment_meta threads on the page (page_id = id) plus their replies.
 *               Inline anchors in page_meta.inner_comments are not counted (they point at threads).
 */
export default async (request, response) => {
    try {
        const { _id } = getPageMetaSchema.parse({ _id: request.query.id });
        const userId = request.user.id;

        const page = await global.PageMeta.findOne({ _id });
        if (!page) {
            return response.status(404).json(formatErrorMessage('Page not found'));
        }
        if (!(await isEntityAccessible('page', page, userId, request.workspaceId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }

        // --- views / viewers ---
        const rows = await global.RecentItem.find({ entity_type: 'page', entity_id: _id }).sort('viewed_at DESC');
        const latestByUser = new Map();
        for (const row of rows) {
            if (!latestByUser.has(String(row.user_id))) latestByUser.set(String(row.user_id), row.viewed_at);
        }
        const recentIds = [...latestByUser.keys()].slice(0, MAX_VIEWERS);
        const viewerUsers = recentIds.length
            ? await global.User.find({ _id: { in: recentIds } })
            : [];
        const usersById = new Map(viewerUsers.map((u) => [String(u._id), u]));
        const viewers = recentIds
            .filter((id) => usersById.has(id))
            .map((id) => {
                const u = usersById.get(id);
                return { _id: u._id, name: u.name, email: u.email, avatar: u.avatar || '', viewed_at: latestByUser.get(id) };
            });

        // --- comments ---
        const threads = await global.CommentMeta.find({ page_id: _id }).select(['_id']);
        const threadIds = threads.map((c) => c._id);
        const orphanReplies = threadIds.length
            ? await global.CommentMeta.count({ parent_id: { in: threadIds }, page_id: { '!=': _id } })
            : 0;

        // --- last editor ---
        let lastUpdatedBy = null;
        if (page.last_updated_by && /^[0-9a-fA-F]{24}$/.test(String(page.last_updated_by))) {
            const u = await global.User.findOne({ _id: String(page.last_updated_by) });
            if (u) lastUpdatedBy = { _id: u._id, name: u.name, avatar: u.avatar || '' };
        }

        response.json(formatSuccessMessage('Page stats fetched successfully', {
            views: latestByUser.size,
            viewers,
            comment_count: threadIds.length + orphanReplies,
            updatedAt: page.updatedAt,
            last_updated_by: lastUpdatedBy,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
