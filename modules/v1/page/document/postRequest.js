import { z } from 'zod';
import { postPageMetaSchema, postPageContentSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { validateChildSharing } from '../../utils/helper.js';
import { createHistoryEntry } from '../../utils/history.js';

export default async (request, response) => {
    try {
        let boardData = {};
        const body = await request.json();

        const pageContentData = postPageContentSchema.parse({
            user_id: body.user_id,
            content: body.content,
            summary: body.summary,
        });

        const pageContentResult = await global.PageContent.create(pageContentData).fetch();

        const pageMetaData = postPageMetaSchema.parse({
            title: body.title,
            user_id: body.user_id,
            folder_id: body.folder_id,
            board_id: body.board_id,
            space_id: body.space_id,
            group_id: body.group_id,
            page_content_id: pageContentResult._id,
            custom_meta: body.custom_meta,
            shared_members: body.shared_members,
            shared_teams: body.shared_teams,
            attachments: body.attachments,
            page_type: body.page_type,
            last_updated_by: body.user_id,
            entity_type: body.entity_type,
            inner_comments: body.inner_comments,
        });

        if (body.board_id && body.custom_meta?.fields) {
            // Only update the board's field definitions, not task-specific values
            const currentBoard = await global.Board.findOne({ _id: body.board_id });
            if (currentBoard) {
                boardData = await global.Board.update({ _id: body.board_id }, {
                    custom_meta: { fields: body.custom_meta.fields }
                }).fetch();
            }
        }

        // Enforce parent sharing constraints
        const parentType = pageMetaData.board_id ? 'board' : pageMetaData.folder_id ? 'folder' : pageMetaData.space_id ? 'space' : pageMetaData.group_id ? 'group' : null;
        const parentId = pageMetaData.board_id || pageMetaData.folder_id || pageMetaData.space_id || pageMetaData.group_id;
        if (parentType && parentId) {
            await validateChildSharing(parentType, parentId, pageMetaData.shared_members, pageMetaData.shared_teams);
        }

        const pageMetaResult = await global.PageMeta.create({ ...pageMetaData, workspace_id: request.workspaceId }).fetch();

        // Record initial creation history
        try {
            await createHistoryEntry({
                pageId: pageMetaResult._id,
                pageContentId: pageContentResult._id,
                userId: body.user_id,
                action: 'created',
                contentSnapshot: pageContentData.content || null,
                metaSnapshot: { title: pageMetaData.title, page_type: pageMetaData.page_type },
                changes: {},
            });
        } catch (historyErr) {
            console.error('Failed to record creation history:', historyErr.message);
        }

        response.json(formatSuccessMessage("Page content, meta data, and inner comments saved successfully", { ...pageMetaResult, pageContent: pageContentResult, board: boardData?.length > 0 ? boardData[0] : {} }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};