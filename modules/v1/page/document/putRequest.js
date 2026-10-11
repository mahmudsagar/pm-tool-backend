import { z } from 'zod';
import { putPageMetaSchema, putPageContentSchema, customMetaValuesSchema } from './config/validation.js';
import { mergeValues } from '../../utils/boardTasks.js';
import { valuesEqual, evaluateRuleTrigger, applyRuleAction } from '../../utils/boardAutomation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { buildCommentWithUserInfo, canUserAccessEntity } from '../../utils/helper.js';
import { createHistoryEntry, detectMetaChanges, resolveAction } from '../../utils/history.js';
import { createNotification } from '../../utils/notificationService.js';
import { isEntityAccessible } from '../../utils/entities.js';
import { canManagePageLock, LOCK_PROTECTED_FIELDS, PAGE_LOCKED_MESSAGE, withStudioDefaults } from '../../utils/pageLock.js';

export default async (request, response) => {
    try {
        const { id: _id, content: contentWrapper, ...topLevel } = request.body;

        // Support both flat payload and nested `content` wrapper
        const rest = contentWrapper && typeof contentWrapper === 'object' && !Array.isArray(contentWrapper)
            ? { ...topLevel, ...contentWrapper }
            : { ...topLevel, content: contentWrapper };

        let mediaAttachments = [];
        let boardData = {};
        let pageContentResult, pageMetaResult;

        const pageMetaData = putPageMetaSchema.parse({
            _id,
            page_type: rest.page_type,
            title: rest.title,
            folder_id: rest.folder_id,
            board_id: rest.board_id,
            space_id: rest.space_id,
            group_id: rest.group_id,
            custom_meta: rest.custom_meta,
            shared_members: rest.shared_members,
            shared_teams: rest.shared_teams,
            attachments: rest.attachments,
            last_updated_by: rest.last_updated_by,
            pinned: rest.pinned,
            entity_type: rest.entity_type,
            inner_comments: rest.inner_comments,
            icon: rest.icon,
            subtitle: rest.subtitle,
            doc_status: rest.doc_status,
            cover_position: rest.cover_position,
            locked: rest.locked,
            sort_order: rest.sort_order,
        });
        const customMetaValues = rest.custom_meta_values !== undefined
            ? customMetaValuesSchema.parse(rest.custom_meta_values)
            : undefined;

        // Capture snapshots BEFORE any updates (history comparison + lock checks)
        const previousMeta = _id ? await global.PageMeta.findOne({ _id }) : null;
        if (!previousMeta) {
            return response.status(404).json(formatErrorMessage('PageMeta not found'));
        }
        let previousContent = null;
        try {
            previousContent = await global.PageContent.findOne({ _id: previousMeta.page_content_id });
        } catch (_) {
            // Snapshot capture failure should not block the update
        }

        const userId = request.user.id;
        // Board tasks: access is decided by the board itself (a private board is not opened up
        // by access to its parent space). 404 so the task's existence is not revealed.
        let taskBoard = null;
        if (previousMeta.board_id) {
            taskBoard = await global.Board.findOne({ _id: previousMeta.board_id });
            if (taskBoard && !(await canUserAccessEntity(taskBoard, userId, request.workspaceId))) {
                return response.status(404).json(formatErrorMessage('PageMeta not found'));
            }
        }
        if (!(await isEntityAccessible('page', previousMeta, userId, request.workspaceId))) {
            return response.status(403).json(formatErrorMessage('Access denied to this resource'));
        }

        // custom_meta_values: shallow-merge into custom_meta.values (on top of a custom_meta sent
        // in the same request, else the stored one); null deletes a key; fields stay intact.
        if (customMetaValues) {
            const parseMeta = (m) => {
                if (typeof m === 'string') {
                    try { return JSON.parse(m); } catch { return {}; }
                }
                return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
            };
            const base = parseMeta(pageMetaData.custom_meta !== undefined ? pageMetaData.custom_meta : previousMeta.custom_meta);
            pageMetaData.custom_meta = { ...base, values: mergeValues(base.values, customMetaValues) };
        }

        // --- Lock rules ---------------------------------------------------------------------
        // The lock change is applied first, so unlocking + editing in one request works.
        const wasLocked = previousMeta.locked === true;
        const lockChange = pageMetaData.locked !== undefined && pageMetaData.locked !== wasLocked;
        let mayManageLock = null;
        const canManage = async () => {
            if (mayManageLock === null) mayManageLock = await canManagePageLock(previousMeta, userId, request.workspaceId);
            return mayManageLock;
        };
        if (lockChange && !(await canManage())) {
            return response.status(403).json(formatErrorMessage('Only the page creator, the lock holder or a workspace admin can lock or unlock this page'));
        }
        const willBeLocked = pageMetaData.locked !== undefined ? pageMetaData.locked : wasLocked;
        if (willBeLocked) {
            const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
            const before = withStudioDefaults(previousMeta);
            const metaEdit = LOCK_PROTECTED_FIELDS.some((f) => pageMetaData[f] !== undefined && differs(pageMetaData[f], before[f]));
            const contentEdit = (rest.content !== undefined && rest.content !== null && rest.content !== ''
                    && differs(rest.content, previousContent?.content))
                || (rest.summary !== undefined && differs(rest.summary, previousContent?.summary));
            if ((metaEdit || contentEdit) && !(await canManage())) {
                return response.status(423).json(formatErrorMessage(PAGE_LOCKED_MESSAGE));
            }
        }
        if (lockChange) {
            pageMetaData.locked_by = pageMetaData.locked ? String(userId) : null;
            pageMetaData.locked_at = pageMetaData.locked ? new Date().toISOString() : null;
        } else {
            delete pageMetaData.locked;
        }
        // The server knows who is editing; don't trust a client-supplied value.
        pageMetaData.last_updated_by = String(userId);

        pageMetaResult = await global.PageMeta.update(
            { _id },
            pageMetaData
        ).fetch();

        if (!pageMetaResult || !pageMetaResult.length) {
            return response.status(404).json(formatErrorMessage('PageMeta not found'));
        }

        if (pageMetaResult.length > 0) pageMetaResult = pageMetaResult[0];

        // Apply configurable board automation workflow rules on server-side updates.
        try {
            const boardId = pageMetaResult.board_id || rest.board_id;
            if (boardId && pageMetaResult?.custom_meta?.values) {
                const board = await global.Board.findOne({ _id: boardId });
                const rules = board?.automations?.workflowRules || [];
                if (Array.isArray(rules) && rules.length > 0) {
                    const previousValues = previousMeta?.custom_meta?.values || {};
                    const nextValues = { ...(pageMetaResult.custom_meta.values || {}) };
                    const changedFields = new Set(
                        Object.keys({ ...previousValues, ...nextValues }).filter((key) => !valuesEqual(previousValues[key], nextValues[key]))
                    );

                    let hasRuleMutation = false;
                    rules
                        .filter((rule) => rule && rule.enabled !== false)
                        .forEach((rule) => {
                            if (!evaluateRuleTrigger(rule, nextValues, changedFields)) return;
                            const before = JSON.stringify(nextValues);
                            const mutated = applyRuleAction(rule, nextValues);
                            if (mutated && before !== JSON.stringify(nextValues)) {
                                hasRuleMutation = true;
                            }
                        });

                    if (hasRuleMutation) {
                        const mergedMeta = {
                            ...(pageMetaResult.custom_meta || {}),
                            values: nextValues,
                        };
                        const ruleResult = await global.PageMeta.update(
                            { _id },
                            { custom_meta: mergedMeta }
                        ).fetch();
                        if (ruleResult?.length > 0) {
                            pageMetaResult = ruleResult[0];
                        }
                    }
                }
            }
        } catch (automationErr) {
            console.error('Failed to apply automation rules:', automationErr.message);
        }

        if (rest.content || rest.summary) {
            const pageContentData = putPageContentSchema.parse({
                _id: pageMetaResult.page_content_id,
                content: rest.content,
                summary: rest.summary,
            });

            pageContentResult = await global.PageContent.update(
                { _id: pageMetaResult.page_content_id },
                pageContentData
            ).fetch();
            if (!pageContentResult || !pageContentResult.length) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }

            if (pageContentResult.length > 0) pageContentResult = pageContentResult[0];
        } else {
            pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }
        }

        if (pageMetaResult.attachments && pageMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                pageMetaResult.attachments?.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: pageMetaResult._id });
                })
            );
        }

        // --- Record history ---
        try {
            if (previousMeta) {
                const trackedFields = ['title', 'subtitle', 'icon', 'doc_status', 'locked', 'custom_meta', 'shared_members', 'shared_teams', 'pinned', 'page_type'];
                const metaChanges = detectMetaChanges(previousMeta, pageMetaResult, trackedFields);
                const hasContentChange = rest.content && previousContent &&
                    JSON.stringify(previousContent.content) !== JSON.stringify(rest.content);

                if (hasContentChange || Object.keys(metaChanges).length > 0) {
                    const action = resolveAction(metaChanges, hasContentChange);

                    let contentChangeDetail = null;
                    if (hasContentChange) {
                        const pageType = previousMeta.page_type;
                        const snap = previousContent.content;
                        if (pageType === 'whiteboard') {
                            const count = (snap?.elements || []).length;
                            contentChangeDetail = `${count} element${count !== 1 ? 's' : ''} on whiteboard`;
                        } else if (pageType === 'sheet') {
                            const sheets = Object.values(snap?.sheets || snap || {});
                            const sheetCount = sheets.length;
                            contentChangeDetail = `${sheetCount} sheet${sheetCount !== 1 ? 's' : ''}`;
                        } else if (pageType === 'document') {
                            const extractText = (node) => {
                                if (!node) return '';
                                if (node.text) return node.text;
                                if (Array.isArray(node.children)) return node.children.map(extractText).join(' ');
                                return '';
                            };
                            try {
                                // Lexical stores content as a JSON string — parse it before traversal
                                const parsed = typeof snap === 'string' ? JSON.parse(snap) : snap;
                                const root = parsed?.root || parsed;
                                const text = extractText(root).replace(/\s+/g, ' ').trim();
                                const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
                                contentChangeDetail = { words: wordCount, preview: text.slice(0, 120) || null, text: text || null };
                            } catch (_) {
                                contentChangeDetail = { words: 0, preview: null, text: null };
                            }
                        }
                    }

                    await createHistoryEntry({
                        pageId: _id,
                        pageContentId: pageMetaResult.page_content_id,
                        userId,
                        action,
                        contentSnapshot: hasContentChange ? previousContent.content : null,
                        metaSnapshot: Object.keys(metaChanges).length > 0
                            ? Object.fromEntries(trackedFields.filter(f => previousMeta[f] !== undefined).map(f => [f, previousMeta[f]]))
                            : null,
                        changes: { ...metaChanges, ...(hasContentChange ? { content: { updated: true, description: contentChangeDetail } } : {}) },
                    });
                }
            }
        } catch (historyErr) {
            // History recording should not block the update response
            console.error('Failed to record history:', historyErr.message);
        }


        const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id });
        const commentsWithMeta = await Promise.all(
            commentsMeta.map(async (comment) => {
                const withInfo = await buildCommentWithUserInfo(comment);
                const childComments = await global.CommentMeta.find({ parent_id: comment._id });
                const childs = await Promise.all(childComments.map(c => buildCommentWithUserInfo(c)));
                return { ...withInfo, childs };
            })
        );

        if (rest.board_id) {
            if (rest.custom_meta?.fields) {
                // A task is reporting an updated field schema (e.g. a new field was added).
                // Merge incoming fields into the board's existing schema by field name so that:
                // - Fields added via board settings are preserved even if an older task sends
                //   a stale fields array.
                // - New fields added on a task are promoted to the board for all tasks to share.
                // We NEVER touch board-level values here.
                const existingBoard = await global.Board.findOne({ _id: rest.board_id });
                const existingFields = existingBoard?.custom_meta?.fields || [];
                const incomingFields = rest.custom_meta.fields;

                // Build a map keyed by field name; incoming fields win on conflict
                const fieldMap = {};
                existingFields.forEach(f => { fieldMap[f.name] = f; });
                incomingFields.forEach(f => { fieldMap[f.name] = f; });

                const updatedBoardMeta = {
                    ...(existingBoard?.custom_meta || {}),
                    fields: Object.values(fieldMap),
                };
                const boardResult = await global.Board.update(
                    { _id: rest.board_id },
                    { custom_meta: updatedBoardMeta }
                ).fetch();
                boardData = boardResult || [];
            } else {
                // No field schema change — just fetch the board for the response.
                const boardResult = await global.Board.find({ _id: rest.board_id });
                boardData = boardResult || [];
            }
        }

        // Send notification
        try {
            await createNotification({
                workspaceId: request.workspaceId,
                entity: pageMetaResult,
                entityType: pageMetaData.page_type || 'page',
                action: 'update',
                currentUserId: request.user.id,
                metadata: {
                    actor_name: request.user.name || 'User',
                    changes: Object.keys(rest).filter(k => rest[k] !== undefined)
                }
            });
        } catch (notifErr) {
            console.error('Failed to create notification:', notifErr.message);
        }

        response.json(formatSuccessMessage("Page updated successfully", { ...withStudioDefaults(pageMetaResult), mediaAttachments, pageContent: pageContentResult, comments: commentsWithMeta, board: Array.isArray(boardData) && boardData.length > 0 ? boardData[0] : {} }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};