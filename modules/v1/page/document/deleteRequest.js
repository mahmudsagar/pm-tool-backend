import { z } from 'zod';
import { deletePageMetaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { deleteAttachments, canUserAccessEntity } from '../../utils/helper.js';
import { isEntityAccessible } from '../../utils/entities.js';
import { createNotification } from '../../utils/notificationService.js';
import { snapshotPage, createTrashItem } from '../../utils/trash.js';

export default async (request, response) => {
    try {
        const { id: _id } = request.query;

        const validatedParams = deletePageMetaSchema.parse({ _id });

        // Declared here (not inside the if) so the notification below can see it.
        let pageMeta = null;
        // Media files stay in storage until the trash item is purged.
        const deleteOptions = { keepFiles: true };

        if (validatedParams._id) {
            pageMeta = await global.PageMeta.findOne({ _id: validatedParams._id });
            if (!pageMeta) {
                return response.status(404).json(formatErrorMessage('PageMeta not found'));
            }
            // Board tasks need access to the board itself (see PUT); other pages the usual rule.
            let taskBoard = null;
            if (pageMeta.board_id) {
                taskBoard = await global.Board.findOne({ _id: pageMeta.board_id });
                if (taskBoard && !(await canUserAccessEntity(taskBoard, request.user.id, request.workspaceId))) {
                    return response.status(404).json(formatErrorMessage('PageMeta not found'));
                }
            }
            if (!(await isEntityAccessible('page', pageMeta, request.user.id, request.workspaceId))) {
                return response.status(403).json(formatErrorMessage('Access denied to this resource'));
            }

            // Snapshot everything removed below so it can be restored from trash
            await createTrashItem({
                entityType: 'page',
                entityId: pageMeta._id,
                snapshot: await snapshotPage(pageMeta._id),
                userId: request.user.id,
                workspaceId: request.workspaceId,
            });

            if (pageMeta.attachments && pageMeta.attachments.length > 0) {
                await deleteAttachments(pageMeta.attachments, deleteOptions);
            }

            await global.PageMeta.destroy({ _id: validatedParams._id });

            const pageContentResult = await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }

            // Delete all comments related to the page
            const commentsMeta = await global.CommentMeta.find({ page_id: validatedParams._id });
            for (const commentMeta of commentsMeta) {
                if (commentMeta.attachments && commentMeta.attachments.length > 0) {
                    await deleteAttachments(commentMeta.attachments, deleteOptions);
                }

                await global.CommentMeta.destroy({ _id: commentMeta._id });

                if (commentMeta.associate_id) {
                    await global.CommentContent.destroyOne({ _id: commentMeta.associate_id });
                }

                // Delete child comments
                if (commentMeta.has_childs) {
                    const childCommentsMeta = await global.CommentMeta.find({ parent_id: commentMeta._id });
                    for (const childCommentMeta of childCommentsMeta) {
                        if (childCommentMeta.attachments && childCommentMeta.attachments.length > 0) {
                            await deleteAttachments(childCommentMeta.attachments, deleteOptions);
                        }

                        await global.CommentMeta.destroy({ _id: childCommentMeta._id });

                        if (childCommentMeta.associate_id) {
                            await global.CommentContent.destroyOne({ _id: childCommentMeta.associate_id });
                        }
                    }
                }
            }
        } else {
            return response.status(400).json(formatErrorMessage('Page ID must be provided'));
        }

        // Send notification for deletion
        if (pageMeta) {
            try {
                await createNotification({
                    workspaceId: request.workspaceId,
                    entity: pageMeta,
                    entityType: pageMeta.page_type || 'page',
                    action: 'delete',
                    currentUserId: request.user.id,
                    metadata: {
                        actor_name: request.user.name || 'User'
                    }
                });
            } catch (notifErr) {
                console.error('Failed to create notification:', notifErr.message);
            }
        }

        response.json(formatSuccessMessage('Page deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};