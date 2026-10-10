import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'ico']);
const DOCUMENT_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods', 'odp', 'json']);
const DOCUMENT_MIME = /^(application\/(pdf|msword|rtf|json|vnd\.ms-|vnd\.openxmlformats-officedocument|vnd\.oasis\.opendocument)|text\/)/;

const classify = (media) => {
    const mime = String(media.mime_type || '').toLowerCase();
    if (mime) {
        if (mime.startsWith('image/')) return 'images';
        if (DOCUMENT_MIME.test(mime)) return 'documents';
        return 'other';
    }
    const path = String(media.url || '').split('?')[0];
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    if (IMAGE_EXT.has(ext)) return 'images';
    if (DOCUMENT_EXT.has(ext)) return 'documents';
    return 'other';
};

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /v1/workspace/storage — storage usage for the workspace in X-Workspace-ID (or ?id=).
 * Media rows are attributed to the workspace by their workspace_id (new uploads) or, for older
 * rows, by what they are attached to / referenced from (pages, comments on those pages, spaces).
 */
export default async (request, response) => {
    try {
        const workspaceId = request.workspaceId || request.query.id;
        if (!workspaceId) {
            return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
        }

        const pages = await global.PageMeta.find({
            where: { workspace_id: workspaceId },
            select: ['_id', 'attachments', 'user_id', 'last_updated_by', 'updatedAt'],
        });
        const spaces = await global.Space.find({ where: { workspace_id: workspaceId }, select: ['_id'] });
        const pageIds = pages.map((p) => p._id);
        const comments = pageIds.length > 0
            ? await global.CommentMeta.find({ where: { page_id: { in: pageIds } }, select: ['_id', 'attachments'] })
            : [];

        const attachmentIds = new Set();
        for (const row of [...pages, ...comments]) {
            for (const id of row.attachments || []) attachmentIds.add(String(id));
        }
        const referenceIds = [...pageIds, ...comments.map((c) => c._id), ...spaces.map((s) => s._id)];

        const or = [{ workspace_id: workspaceId }];
        if (attachmentIds.size > 0) or.push({ _id: { in: [...attachmentIds] } });
        if (referenceIds.length > 0) or.push({ reference_id: { in: referenceIds } });
        const mediaRows = await global.Media.find({ or });

        const byType = { images: 0, documents: 0, other: 0 };
        let usedBytes = 0;
        let fileCount = 0;
        const seen = new Set();
        for (const media of mediaRows) {
            if (seen.has(String(media._id))) continue;
            seen.add(String(media._id));
            // Rows attributed to another workspace explicitly are not ours.
            if (media.workspace_id && String(media.workspace_id) !== String(workspaceId)) continue;
            const size = Number(media.size) || 0;
            usedBytes += size;
            fileCount += 1;
            byType[classify(media)] += size;
        }

        const since = Date.now() - ACTIVE_WINDOW_MS;
        const contributors = new Set();
        for (const page of pages) {
            const updated = page.updatedAt ? new Date(page.updatedAt).getTime() : 0;
            if (updated >= since) {
                const who = page.last_updated_by || page.user_id;
                if (who) contributors.add(String(who));
            }
        }

        response.json(formatSuccessMessage('Storage usage fetched successfully', {
            used_bytes: usedBytes,
            quota_bytes: null,
            by_type: byType,
            file_count: fileCount,
            active_contributors: contributors.size,
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
