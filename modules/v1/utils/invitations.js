import crypto from 'crypto';
import { dbConfig } from '../../../db/connection.js';
import { addUserToWorkspace, addUserToSpaces, isWorkspaceMember } from './workspaceAccess.js';

/**
 * Workspace invitations. There is no email provider: a pending invitation is resolved when a user
 * with the invited email registers / logs in / signs in via OAuth / validates their token
 * (`acceptPendingInvitationsForUser`), or explicitly through the invite link (`acceptInvitation`).
 */

export const INVITATION_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const newInvitationToken = () => crypto.randomBytes(32).toString('hex');
export const newInvitationExpiry = () => new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS).toISOString();

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isInvitationExpired = (invitation) =>
    !!invitation?.expires_at && new Date(invitation.expires_at).getTime() <= Date.now();

/** Flip a pending-but-past-expiry invitation to 'expired'. Returns the (possibly updated) row. */
export const expireIfNeeded = async (invitation) => {
    if (invitation?.status === 'pending' && isInvitationExpired(invitation)) {
        await global.Invitation.updateOne({ _id: invitation._id }).set({ status: 'expired' });
        return { ...invitation, status: 'expired' };
    }
    return invitation;
};

/** Find a user by email, tolerating rows stored with a different case. */
export const findUserByEmail = async (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const exact = await global.User.find({ email: normalized }).limit(1);
    if (exact.length > 0) return exact[0];
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const db = dbConfig.adapters.mongo.datastores?.default?.manager;
    if (db && typeof db.collection === 'function') {
        const row = await db.collection('user').findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } }, { projection: { _id: 1 } });
        if (row) return global.User.findOne({ _id: String(row._id) });
    }
    return null;
};

/**
 * Accept one invitation for `user`: add them to the workspace with the invited role (if not already
 * a member) and to the invited spaces, then mark the invitation accepted.
 * Returns the workspace, or null when the workspace no longer exists (invitation is revoked).
 */
export const acceptInvitation = async (invitation, user) => {
    let workspace = await global.Workspace.findOne({ _id: invitation.workspace_id });
    if (!workspace) {
        await global.Invitation.updateOne({ _id: invitation._id }).set({ status: 'revoked' });
        return null;
    }
    if (!isWorkspaceMember(workspace, user._id)) {
        ({ workspace } = await addUserToWorkspace(workspace, user._id, invitation.role || 'member'));
    }
    await addUserToSpaces(invitation.space_ids, workspace._id, user._id);
    await global.Invitation.updateOne({ _id: invitation._id }).set({
        status: 'accepted',
        accepted_by: String(user._id),
        accepted_at: new Date().toISOString(),
    });
    return workspace;
};

/**
 * Accept every pending, unexpired invitation addressed to `user.email`. Expired ones are marked
 * 'expired'. Never throws (sign-in must not fail because of an invitation); returns accepted count.
 */
export const acceptPendingInvitationsForUser = async (user) => {
    if (!user?._id || !user.email || !global.Invitation) return 0;
    try {
        const pending = await global.Invitation.find({ email: normalizeEmail(user.email), status: 'pending' });
        let accepted = 0;
        for (const invitation of pending) {
            const current = await expireIfNeeded(invitation);
            if (current.status !== 'pending') continue;
            if (await acceptInvitation(current, user)) accepted += 1;
        }
        return accepted;
    } catch (err) {
        console.error('acceptPendingInvitationsForUser failed:', err.message);
        return 0;
    }
};

/** Public-safe invitation shape for admins (token included so the UI can build invite links). */
export const serializeInvitation = (invitation) => ({
    _id: invitation._id,
    workspace_id: invitation.workspace_id,
    email: invitation.email,
    role: invitation.role,
    space_ids: invitation.space_ids || [],
    token: invitation.token,
    status: invitation.status,
    invited_by: invitation.invited_by,
    created_at: invitation.created_at,
    expires_at: invitation.expires_at,
});
