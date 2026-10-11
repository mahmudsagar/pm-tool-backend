import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { computeStorageUsage, loadQuota, storagePercent, evaluateStorageAlerts } from '../../utils/storage.js';

/**
 * GET /v1/workspace/storage — storage usage for the workspace in X-Workspace-ID (or ?id=).
 * -> { used_bytes, quota_bytes (null = unlimited), percent (0..100+, null when unlimited),
 *      by_type: { images, documents, other }, file_count, active_contributors }
 */
export default async (request, response) => {
    try {
        const workspaceId = request.workspaceId || request.query.id;
        if (!workspaceId) {
            return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
        }

        const usage = await computeStorageUsage(workspaceId);
        const quota = await loadQuota(workspaceId);
        // Clears alert thresholds once usage has dropped below them (files deleted elsewhere).
        await evaluateStorageAlerts(workspaceId, usage);

        response.json(formatSuccessMessage('Storage usage fetched successfully', {
            used_bytes: usage.used_bytes,
            quota_bytes: quota,
            percent: storagePercent(usage.used_bytes, quota),
            by_type: usage.by_type,
            file_count: usage.file_count,
            active_contributors: usage.active_contributors,
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
