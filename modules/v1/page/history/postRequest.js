import { z } from 'zod';
import { rollbackSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { createHistoryEntry } from '../../utils/history.js';

export default async (request, response) => {
    try {
        const body = await request.json();
        const { page_id, history_id } = rollbackSchema.parse(body);

        // Fetch the target history entry
        const historyEntry = await global.PageHistory.findOne({ _id: history_id, page_id });
        if (!historyEntry) {
            return response.status(404).json(formatErrorMessage('History entry not found'));
        }

        if (!historyEntry.content_snapshot) {
            return response
                .status(400)
                .json(formatErrorMessage('This history entry has no content snapshot to rollback to'));
        }

        // Fetch current page to get page_content_id and current content for a new snapshot
        const pageMeta = await global.PageMeta.findOne({ _id: page_id });
        if (!pageMeta) {
            return response.status(404).json(formatErrorMessage('Page not found'));
        }

        const currentContent = await global.PageContent.findOne({ _id: pageMeta.page_content_id });
        if (!currentContent) {
            return response.status(404).json(formatErrorMessage('Page content not found'));
        }

        // Get the user from the request (set by JWT middleware)
        const userId = request.user?._id || request.user?.id || body.user_id;

        // Save current state as a history entry before overwriting
        await createHistoryEntry({
            pageId: page_id,
            pageContentId: pageMeta.page_content_id,
            userId,
            action: 'content_updated',
            contentSnapshot: currentContent.content,
            changes: { note: 'Auto-saved before rollback' },
        });

        // Rollback: update page content with the snapshot
        const updated = await global.PageContent.update(
            { _id: pageMeta.page_content_id },
            { content: historyEntry.content_snapshot }
        ).fetch();

        // Update last_updated_by on PageMeta
        await global.PageMeta.update({ _id: page_id }, { last_updated_by: userId }).fetch();

        // Record the rollback as a new history entry
        await createHistoryEntry({
            pageId: page_id,
            pageContentId: pageMeta.page_content_id,
            userId,
            action: 'restored',
            contentSnapshot: historyEntry.content_snapshot,
            changes: { restored_from_version: historyEntry.version },
        });

        response.json(
            formatSuccessMessage('Content rolled back successfully', {
                page_id,
                restored_to_version: historyEntry.version,
                content: updated.length > 0 ? updated[0] : updated,
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
