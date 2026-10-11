import { z } from 'zod';
import { auditQuerySchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';
import { queryAudit, decorateAuditRows } from '../../utils/audit.js';

// GET /v1/workspace/audit?cursor=&limit=1..100&action=<prefix>&actor_id=&target_id=&from=&to=&q=
// -> { entries: [{ ..., actor: { _id, name, email, avatar } | null }], next_cursor } newest first.
// Owner / admin of the X-Workspace-ID workspace only.
export default async (request, response) => {
    try {
        if (!request.workspaceId) {
            return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
        }
        const { cursor, limit, ...filters } = auditQuerySchema.parse(request.query || {});
        const workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can view the audit log'));
        }

        const { rows, next_cursor } = await queryAudit(workspace._id, filters, { cursor, limit });
        response.json(formatSuccessMessage('Audit log fetched successfully', {
            entries: await decorateAuditRows(rows),
            next_cursor,
        }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
