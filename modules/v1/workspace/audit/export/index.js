import { z } from 'zod';
import { auditFiltersSchema } from '../../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../../utils/error.js';
import { isWorkspaceAdmin } from '../../../utils/workspaceAccess.js';
import { queryAudit, decorateAuditRows, auditRowsToCsv } from '../../../utils/audit.js';

export const AUDIT_EXPORT_MAX_ROWS = 10000;

// GET /v1/workspace/audit/export?<same filters as /v1/workspace/audit> -> text/csv attachment,
// newest first, at most 10,000 rows. Owner / admin only.
export default async (request, response) => {
    try {
        if (!request.workspaceId) {
            return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
        }
        const filters = auditFiltersSchema.parse(request.query || {});
        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can export the audit log'));
        }

        const { rows } = await queryAudit(workspace._id, filters, { limit: AUDIT_EXPORT_MAX_ROWS });
        const csv = auditRowsToCsv(await decorateAuditRows(rows));
        const date = new Date().toISOString().slice(0, 10);
        response.status(200);
        response.set('Content-Type', 'text/csv; charset=utf-8');
        response.set('Content-Disposition', `attachment; filename="audit-log-${workspace._id}-${date}.csv"`);
        response.set('Cache-Control', 'no-store');
        response.set('Access-Control-Expose-Headers', 'Content-Disposition');
        response.send(csv);
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
