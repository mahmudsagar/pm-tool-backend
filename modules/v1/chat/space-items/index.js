import { z } from 'zod';
import { getSpaceItemsSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity } from '../../utils/helper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = getSpaceItemsSchema.parse(request.query);

        const space = await global.Space.findOne({ _id: query.space_id, workspace_id: workspaceId });
        if (!space) {
            return response.status(404).json(formatErrorMessage('Space not found'));
        }

        if (!(await canUserAccessEntity(space, userId, workspaceId))) {
            return response.status(403).json(formatErrorMessage('Access denied'));
        }

        const boards = await global.Board.find({ space_id: query.space_id, workspace_id: workspaceId });
        const boardIds = boards.map(b => b._id);
        const boardMap = Object.fromEntries(boards.map(b => [b._id, b]));

        if (boardIds.length === 0) {
            return response.json(formatSuccessMessage('Space items fetched', []));
        }

        const allPages = await global.PageMeta.find({ workspace_id: workspaceId });
        const searchQ = query.query.trim().toLowerCase();

        let items = allPages.filter(p => p.board_id && boardIds.includes(p.board_id));

        if (searchQ) {
            items = items.filter(p => (p.title || '').toLowerCase().includes(searchQ));
        }

        items = items.slice(0, query.limit);

        const enriched = await Promise.all(
            items.map(async (page) => {
                if (!(await canUserAccessEntity(page, userId, workspaceId))) return null;

                const board = boardMap[page.board_id];
                const isScrum = board?.custom_meta?.board_kind === 'scrum';
                let kind = 'task';
                if (page.parent_id) kind = 'subtask';
                else if (isScrum) kind = 'story';

                const status = page.custom_meta?.values?.status || '';
                const assignee = page.custom_meta?.values?.assignee || '';
                const storyPoints = page.custom_meta?.values?.story_points || '';
                const sprint = page.custom_meta?.values?.sprint || '';

                return {
                    _id: page._id,
                    title: page.title,
                    kind,
                    status,
                    assignee,
                    story_points: storyPoints,
                    sprint,
                    board_id: page.board_id,
                    board_name: board?.name || '',
                    board_kind: isScrum ? 'scrum' : 'board',
                    parent_id: page.parent_id || null,
                    url: `/document/${page._id}`,
                    board_url: isScrum ? `/scrum/${page.board_id}` : `/board/${page.board_id}`,
                };
            })
        );

        response.json(formatSuccessMessage('Space items fetched', enriched.filter(Boolean)));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
