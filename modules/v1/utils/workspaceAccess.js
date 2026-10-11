/**
 * Workspace membership helpers.
 *
 * Owner = workspace.owner_id. Everyone else is listed in workspace.members ([user_id]) with an
 * entry in workspace.member_roles: [{ user_id, role: 'admin'|'member'|'guest', status?, joined_at? }].
 * A missing member_roles entry means role 'member', status 'active'.
 */

export const WORKSPACE_ROLES = ['admin', 'member', 'guest'];
export const MEMBER_STATUSES = ['active', 'suspended'];

const sameId = (a, b) => String(a ?? '') === String(b ?? '');

export const isWorkspaceOwner = (workspace, userId) => !!workspace && sameId(workspace.owner_id, userId);

export const isWorkspaceMember = (workspace, userId) =>
    !!workspace && (isWorkspaceOwner(workspace, userId)
        || (Array.isArray(workspace.members) && workspace.members.some((m) => sameId(m, userId))));

export const getMemberEntry = (workspace, userId) =>
    (Array.isArray(workspace?.member_roles) ? workspace.member_roles : []).find((r) => sameId(r?.user_id, userId)) || null;

export const getMemberStatus = (workspace, userId) => {
    if (isWorkspaceOwner(workspace, userId)) return 'active';
    return getMemberEntry(workspace, userId)?.status === 'suspended' ? 'suspended' : 'active';
};

export const isMemberSuspended = (workspace, userId) => getMemberStatus(workspace, userId) === 'suspended';

/** Owner, or an active member whose role is 'admin'. */
export const isWorkspaceAdmin = (workspace, userId) => {
    if (!workspace) return false;
    if (isWorkspaceOwner(workspace, userId)) return true;
    const entry = getMemberEntry(workspace, userId);
    return !!entry && entry.role === 'admin' && entry.status !== 'suspended'
        && isWorkspaceMember(workspace, userId);
};

/** Returns member_roles with `userId`'s entry replaced by `{ ...existing, ...patch }`. */
export const upsertMemberEntry = (workspace, userId, patch) => {
    const roles = Array.isArray(workspace.member_roles) ? workspace.member_roles : [];
    const existing = getMemberEntry(workspace, userId);
    const next = { role: 'member', ...(existing || {}), ...patch, user_id: String(userId) };
    return [...roles.filter((r) => !sameId(r?.user_id, userId)), next];
};

/**
 * Add `userId` to the workspace as `role` (no-op if they are the owner or already a member).
 * Returns { workspace, added }.
 */
export const addUserToWorkspace = async (workspace, userId, role = 'member') => {
    if (isWorkspaceMember(workspace, userId)) return { workspace, added: false };
    const updated = await global.Workspace.updateOne({ _id: workspace._id }).set({
        members: [...(workspace.members || []), String(userId)],
        member_roles: upsertMemberEntry(workspace, userId, {
            role,
            status: 'active',
            joined_at: new Date().toISOString(),
        }),
    });
    return { workspace: updated || workspace, added: true };
};

/**
 * Give `userId` access to the given spaces of `workspaceId`.
 * Spaces that are restricted (private, or already shared to specific members/teams) get the user
 * appended to shared_members; open public spaces are visible to every workspace member already,
 * so only a member_roles entry is recorded (appending would restrict the space to that user).
 */
export const addUserToSpaces = async (spaceIds, workspaceId, userId, spaceRole = 'contributor') => {
    const ids = [...new Set((spaceIds || []).map(String))];
    if (ids.length === 0) return [];
    const spaces = await global.Space.find({ _id: { in: ids }, workspace_id: workspaceId });
    const uid = String(userId);
    const touched = [];
    for (const space of spaces) {
        const shared = Array.isArray(space.shared_members) ? space.shared_members : [];
        const restricted = space.is_private === true || shared.length > 0
            || (Array.isArray(space.shared_teams) && space.shared_teams.length > 0);
        const alreadyShared = shared.some((m) => String(typeof m === 'object' && m ? m.user_id : m) === uid);
        const memberRoles = { ...(space.member_roles || {}) };
        const updates = {};
        if (restricted && !alreadyShared) {
            const objectFormat = shared.length > 0 && typeof shared[0] === 'object';
            updates.shared_members = [...shared, objectFormat ? { user_id: uid, role: spaceRole } : uid];
        }
        if (!memberRoles[uid] && !sameId(space.user_id, uid)) {
            memberRoles[uid] = spaceRole;
            updates.member_roles = memberRoles;
        }
        if (Object.keys(updates).length > 0) {
            await global.Space.updateOne({ _id: space._id }).set(updates);
        }
        touched.push(space._id);
    }
    return touched;
};

/** Spaces of a workspace that `userId` is explicitly part of (creator, shared_members or member_roles). */
export const spaceIdsForUser = (spaces, userId) => {
    const uid = String(userId);
    return spaces
        .filter((space) => sameId(space.user_id, uid)
            || (Array.isArray(space.shared_members)
                && space.shared_members.some((m) => String(typeof m === 'object' && m ? m.user_id : m) === uid))
            || (space.member_roles && typeof space.member_roles === 'object' && !Array.isArray(space.member_roles)
                && space.member_roles[uid]))
        .map((space) => space._id);
};

// --- last seen ---------------------------------------------------------------------------------

const LAST_SEEN_INTERVAL_MS = 60 * 1000;
const lastSeenWrites = new Map(); // userId -> ms of last write (per process)

/** Fire-and-forget `user.last_seen_at = now`, at most once per minute per user. */
export const touchLastSeen = (userId) => {
    if (!userId || !global.User) return;
    const key = String(userId);
    if (!/^[0-9a-fA-F]{24}$/.test(key)) return;
    const now = Date.now();
    if (now - (lastSeenWrites.get(key) || 0) < LAST_SEEN_INTERVAL_MS) return;
    lastSeenWrites.set(key, now);
    if (lastSeenWrites.size > 50000) lastSeenWrites.clear();
    try {
        global.User.updateOne({ _id: key }).set({ last_seen_at: new Date(now).toISOString() })
            .catch((err) => console.error('touchLastSeen failed:', err.message));
    } catch (err) {
        console.error('touchLastSeen failed:', err.message);
    }
};

/** True for Waterline/Mongo duplicate-key errors. */
export const isUniqueViolation = (err) =>
    err?.code === 'E_UNIQUE' || err?.code === 11000 || err?.raw?.code === 11000
    || /E11000|duplicate key/i.test(String(err?.message || ''));
