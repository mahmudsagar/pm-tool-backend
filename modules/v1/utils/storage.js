import { collection, toObjectId } from './boardTasks.js';
import { createDirectNotifications } from './notificationService.js';
import { DEFAULT_STORAGE_QUOTA_BYTES } from '../workspace/config/validation.js';

/**
 * Workspace storage accounting and quota.
 *
 * Quota: workspace.storage_quota_bytes. A number is the limit, null means unlimited, and a missing
 * field (workspaces created before quotas existed) means the default of 5 GiB (lazy fill: nothing is
 * written until an owner changes it). New workspaces get the default stored by the model.
 */

export { DEFAULT_STORAGE_QUOTA_BYTES };
export const STORAGE_ALERT_THRESHOLDS = [80, 95];

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'ico']);
const DOCUMENT_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods', 'odp', 'json']);
const DOCUMENT_MIME = /^(application\/(pdf|msword|rtf|json|vnd\.ms-|vnd\.openxmlformats-officedocument|vnd\.oasis\.opendocument)|text\/)/;

export const classifyMedia = (media) => {
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

/** Effective quota in bytes for a workspace row: number, or null for unlimited. */
export const effectiveQuota = (workspace) => {
    const raw = workspace?.storage_quota_bytes;
    if (raw === undefined) return DEFAULT_STORAGE_QUOTA_BYTES;
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_STORAGE_QUOTA_BYTES;
};

/**
 * Raw storage_quota_bytes as stored (native read, so a missing field is distinguishable from
 * null). Returns the effective quota.
 */
export const loadQuota = async (workspaceId) => {
    const row = await collection('workspace').findOne({ _id: toObjectId(workspaceId) }, { projection: { storage_quota_bytes: 1 } });
    if (!row) return DEFAULT_STORAGE_QUOTA_BYTES;
    return effectiveQuota('storage_quota_bytes' in row ? row : {});
};

/**
 * Media rows attributed to the workspace: by their workspace_id (new uploads) or, for older rows,
 * by what they are attached to / referenced from (pages, comments on those pages, spaces).
 * Returns { used_bytes, by_type, file_count, active_contributors, media }.
 */
export const computeStorageUsage = async (workspaceId) => {
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
    const media = [];
    const seen = new Set();
    for (const row of mediaRows) {
        if (seen.has(String(row._id))) continue;
        seen.add(String(row._id));
        // Rows attributed to another workspace explicitly are not ours.
        if (row.workspace_id && String(row.workspace_id) !== String(workspaceId)) continue;
        const size = Number(row.size) || 0;
        usedBytes += size;
        byType[classifyMedia(row)] += size;
        media.push(row);
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

    return {
        used_bytes: usedBytes,
        by_type: byType,
        file_count: media.length,
        active_contributors: contributors.size,
        media,
    };
};

export const storagePercent = (used, quota) =>
    (quota ? Math.round((used / quota) * 10000) / 100 : null);

/** 1536 -> "1.5 KB" (binary units). */
export const formatBytes = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Math.max(0, Number(bytes) || 0);
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    const rounded = i === 0 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
    return `${rounded} ${units[i]}`;
};

export const storageLimitMessage = (used, quota) =>
    `Storage limit reached: ${formatBytes(used)} of ${formatBytes(quota)} used. Free up space or ask an owner to raise the limit.`;

/**
 * Would storing `incomingBytes` more (net of `releasedBytes`, e.g. a replaced file) exceed the
 * workspace quota? Returns { ok, used_bytes, quota_bytes }. Workspaces without an id (user
 * avatars) are never limited.
 */
export const checkStorageQuota = async (workspaceId, incomingBytes, releasedBytes = 0) => {
    if (!workspaceId) return { ok: true, used_bytes: 0, quota_bytes: null };
    const quota = await loadQuota(workspaceId);
    if (quota === null) return { ok: true, used_bytes: null, quota_bytes: null };
    const { used_bytes: used } = await computeStorageUsage(String(workspaceId));
    const next = used - Math.max(0, Number(releasedBytes) || 0) + Math.max(0, Number(incomingBytes) || 0);
    return { ok: next <= quota, used_bytes: used, quota_bytes: quota };
};

/** Express helper: answer 413 with the standard message and { used_bytes, quota_bytes }. */
export const sendStorageLimit = (response, formatErrorMessage, check) =>
    response.status(413).json({
        ...formatErrorMessage(storageLimitMessage(check.used_bytes, check.quota_bytes)),
        data: { used_bytes: check.used_bytes, quota_bytes: check.quota_bytes },
    });

/**
 * Usage alerts at 80% and 95%: one notification to the owner and active admins per threshold,
 * deduplicated through workspace.storage_alerts_sent (claimed atomically); thresholds are cleared
 * again once usage drops below them. Never throws.
 */
export const evaluateStorageAlerts = async (workspaceId, usage = null) => {
    try {
        if (!workspaceId) return [];
        const raw = await collection('workspace').findOne({ _id: toObjectId(workspaceId) });
        if (!raw) return [];
        const quota = effectiveQuota('storage_quota_bytes' in raw ? raw : {});
        const used = usage ? usage.used_bytes : (await computeStorageUsage(String(workspaceId))).used_bytes;
        const percent = quota ? (used / quota) * 100 : 0;
        const sent = Array.isArray(raw.storage_alerts_sent) ? raw.storage_alerts_sent.map(Number) : [];

        const reset = sent.filter((t) => percent < t);
        if (reset.length) {
            await collection('workspace').updateOne({ _id: raw._id }, { $pull: { storage_alerts_sent: { $in: reset } } });
        }

        const claimed = [];
        for (const t of STORAGE_ALERT_THRESHOLDS) {
            if (percent < t || sent.includes(t)) continue;
            const res = await collection('workspace').updateOne(
                { _id: raw._id, storage_alerts_sent: { $ne: t } },
                { $addToSet: { storage_alerts_sent: t } },
            );
            if (res.modifiedCount === 1) claimed.push(t);
        }
        if (!claimed.length) return [];

        // One notification for the highest threshold crossed by this change.
        const threshold = Math.max(...claimed);
        const roles = Array.isArray(raw.member_roles) ? raw.member_roles : [];
        const admins = roles
            .filter((r) => r?.role === 'admin' && r.status !== 'suspended'
                && (raw.members || []).map(String).includes(String(r.user_id)))
            .map((r) => String(r.user_id));
        await createDirectNotifications({
            workspaceId: String(raw._id),
            recipientIds: [String(raw.owner_id), ...admins],
            actorId: 'system',
            action: 'storage_alert',
            entityType: 'workspace',
            entityId: String(raw._id),
            entityName: raw.name || 'Workspace',
            message: `Storage is ${threshold}% full: ${formatBytes(used)} of ${formatBytes(quota)} used.`,
            metadata: { threshold, used_bytes: used, quota_bytes: quota, percent: storagePercent(used, quota) },
        });
        return claimed;
    } catch (err) {
        console.error('evaluateStorageAlerts failed:', err.message);
        return [];
    }
};
