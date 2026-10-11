import { z } from 'zod';
import { postInvitationSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { isWorkspaceAdmin, isWorkspaceMember, addUserToWorkspace, addUserToSpaces } from '../../utils/workspaceAccess.js';
import { findUserByEmail, newInvitationToken, newInvitationExpiry, serializeInvitation } from '../../utils/invitations.js';

// POST /v1/workspace/invitation { emails, role, space_ids? }
// -> { results: [{ email, outcome: 'added'|'invited'|'skipped', reason?, invitation? }] }
export default async (request, response) => {
    try {
        const { emails, role, space_ids } = postInvitationSchema.parse(request.body || {});
        const userId = request.user.id;

        let workspace = await global.Workspace.findOne({ _id: request.workspaceId });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }
        if (!isWorkspaceAdmin(workspace, userId)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can invite members'));
        }

        const spaceIds = [...new Set(space_ids)];
        if (spaceIds.length > 0) {
            const spaces = await global.Space.find({ _id: { in: spaceIds }, workspace_id: workspace._id });
            if (spaces.length !== spaceIds.length) {
                return response.status(400).json(formatErrorMessage('All space_ids must be spaces in this workspace'));
            }
        }

        const results = [];
        for (const email of [...new Set(emails)]) {
            const user = await findUserByEmail(email);

            if (user && isWorkspaceMember(workspace, user._id)) {
                results.push({ email, outcome: 'skipped', reason: 'Already a member of this workspace' });
                continue;
            }

            if (user) {
                ({ workspace } = await addUserToWorkspace(workspace, user._id, role));
                await addUserToSpaces(spaceIds, workspace._id, user._id);
                results.push({ email, outcome: 'added' });
                continue;
            }

            // Unknown email: create or refresh the pending invitation for this workspace
            const fields = {
                role,
                space_ids: spaceIds,
                token: newInvitationToken(),
                expires_at: newInvitationExpiry(),
                invited_by: userId,
                status: 'pending',
            };
            const existing = await global.Invitation.find({ workspace_id: workspace._id, email, status: 'pending' }).limit(1);
            const invitation = existing.length > 0
                ? await global.Invitation.updateOne({ _id: existing[0]._id }).set(fields)
                : await global.Invitation.create({
                    ...fields,
                    workspace_id: workspace._id,
                    email,
                    created_at: new Date().toISOString(),
                }).fetch();

            results.push({ email, outcome: 'invited', invitation: serializeInvitation(invitation) });
        }

        response.json(formatSuccessMessage('Invitations processed', { results }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
