import { z } from 'zod';
import { deleteBoardTasksSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { canUserAccessEntity, deleteAttachments } from '../../utils/helper.js';
import { createNotification } from '../../utils/notificationService.js';
import { snapshotTaskTree, createTrashItem } from '../../utils/trash.js';

// Same rows as page/document/deleteRequest.js removes (media files stay until trash purge).
const destroyPage = async (pageMeta) => {
    const options = { keepFiles: true };
    if (pageMeta.attachments?.length) await deleteAttachments(pageMeta.attachments, options);
    await global.PageMeta.destroy({ _id: pageMeta._id });
    if (pageMeta.page_content_id) await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });
    const comments = await global.CommentMeta.find({ page_id: String(pageMeta._id) });
    for (const comment of comments) {
        if (comment.attachments?.length) await deleteAttachments(comment.attachments, options);
        await global.CommentMeta.destroy({ _id: comment._id });
        if (comment.associate_id) await global.CommentContent.destroyOne({ _id: comment.associate_id });
        if (comment.has_childs) {
            const children = await global.CommentMeta.find({ parent_id: comment._id });
            for (const child of children) {
                if (child.attachments?.length) await deleteAttachments(child.attachments, options);
                await global.CommentMeta.destroy({ _id: child._id });
                if (child.associate_id) await global.CommentContent.destroyOne({ _id: child.associate_id });
            }
        }
    }
};

const parseIds = (raw) => {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return raw;
};

/**
 * DELETE /v1/board/tasks?board_id=<id>&ids=<id>,<id>   (or JSON body { board_id, ids: [] })
 * Moves the tasks and their subtasks to trash: one page trash item per top-level target (its
 * snapshot holds the subtasks too), exactly like DELETE /v1/page/document.
 * Unknown / foreign ids → 400 { data: { invalid_ids } } and nothing is deleted.
 * → data: { deleted_ids: [all removed task ids incl. subtasks], trash_item_ids: [] }
 */
export default async (request, response) => {
    try {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const { board_id: boardId, ids } = deleteBoardTasksSchema.parse({
            board_id: request.query.board_id || body.board_id,
            ids: parseIds(request.query.ids ?? body.ids),
        });
        const userId = String(request.user.id);
        const workspaceId = request.workspaceId;

        const board = await global.Board.findOne({ _id: boardId, workspace_id: workspaceId });
        if (!board || !(await canUserAccessEntity(board, userId, workspaceId))) {
            return response.status(404).json(formatErrorMessage('Board not found'));
        }

        const uniqueIds = [...new Set(ids)];
        const tasks = await global.PageMeta.find({ _id: { in: uniqueIds } });
        const byId = new Map(tasks.map((t) => [String(t._id), t]));
        const invalidIds = uniqueIds.filter((id) => !byId.has(id) || String(byId.get(id).board_id || '') !== String(boardId));
        if (invalidIds.length) {
            return response.status(400).json({
                ...formatErrorMessage(`Tasks not found in this board: ${invalidIds.join(', ')}`),
                data: { invalid_ids: invalidIds },
            });
        }

        // Targets whose parent is also a target are covered by the parent's trash item.
        const targetSet = new Set(uniqueIds);
        const roots = uniqueIds.filter((id) => !(byId.get(id).parent_id && targetSet.has(String(byId.get(id).parent_id))));

        const deletedIds = [];
        const trashItemIds = [];
        for (const rootId of roots) {
            const { snapshot, pages } = await snapshotTaskTree(rootId);
            if (pages.length === 0) continue; // removed concurrently
            const item = await createTrashItem({ entityType: 'page', entityId: rootId, snapshot, userId, workspaceId });
            if (item) trashItemIds.push(item._id);
            for (const page of pages) {
                await destroyPage(page);
                deletedIds.push(String(page._id));
            }
            try {
                await createNotification({
                    workspaceId,
                    entity: pages[0],
                    entityType: pages[0].page_type || 'page',
                    action: 'delete',
                    currentUserId: request.user.id,
                    metadata: { actor_name: request.user.name || 'User' },
                });
            } catch (notifErr) {
                console.error('Failed to create notification:', notifErr.message);
            }
        }

        response.json(formatSuccessMessage('Tasks moved to trash', { deleted_ids: deletedIds, trash_item_ids: trashItemIds }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
