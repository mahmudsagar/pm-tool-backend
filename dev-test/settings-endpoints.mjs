#!/usr/bin/env node
/**
 * Settings endpoint checks: profile fields, workspace settings/admin actions, member management,
 * invitations, space archive, public-space policy, workspace logo upload.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   mongod --dbpath /tmp/setdb --port 27998 --bind_ip 127.0.0.1
 *   MONGODB_URI=mongodb://127.0.0.1:27998/settingstest PORT=3201 \
 *     R2_ENDPOINT=http://127.0.0.1:3299 R2_BUCKET=testbucket R2_URL=http://cdn.test \
 *     R2_ACCESS_KEY_ID=test R2_SECRET_ACCESS_KEY=test node server.js
 *   API_URL=http://127.0.0.1:3201 MONGODB_URI=mongodb://127.0.0.1:27998/settingstest node dev-test/settings-endpoints.mjs
 *
 * The script runs a stub S3 endpoint on S3_STUB_PORT (default 3299) that accepts every PUT, so the
 * server must be started with R2_ENDPOINT pointing at it for the logo upload check.
 */
import http from 'http';
import { MongoClient, ObjectId } from 'mongodb';

const API = process.env.API_URL || 'http://127.0.0.1:3201';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27998/settingstest';
const S3_STUB_PORT = Number(process.env.S3_STUB_PORT || 3299);
if (!/127\.0\.0\.1|localhost/.test(MONGO)) {
    console.error('Refusing to run against a non-local MONGODB_URI');
    process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (name, condition, detail) => {
    if (condition) {
        passed += 1;
        console.log(`PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${name}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    }
};

const call = async (method, path, { token, ws, body, form } = {}) => {
    const headers = {};
    if (!form) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-ID'] = ws;
    const res = await fetch(`${API}${path}`, {
        method, headers, body: form || (body ? JSON.stringify(body) : undefined),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json, data: json?.data };
};

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const registerEmail = async (label, email) => {
    const res = await call('POST', '/v1/auth/register', {
        body: { name: `Set ${label}`, email, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    const own = res.data.workspaces.find((w) => w.owner_id === res.data.user_info._id);
    return {
        token: res.data.token,
        userId: res.data.user_info._id,
        email: res.data.user_info.email,
        ws: own._id,
        auth: res.data,
    };
};
const register = (label) => registerEmail(label, `set-${label}-${stamp()}@example.test`);

const main = async () => {
    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();

    const s3 = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { ETag: '"stub"' }); res.end(); }); });
    await new Promise((resolve) => s3.listen(S3_STUB_PORT, '127.0.0.1', resolve));

    const owner = await register('owner');
    const admin = await register('admin');
    const member = await register('member');
    const outsider = await register('outsider');
    const as = (u, ws = owner.ws) => ({ token: u.token, ws });
    const o = as(owner);

    for (const [u, role] of [[admin, 'admin'], [member, 'member']]) {
        const r = await call('POST', '/v1/workspace/member', { ...o, body: { email: u.email, role } });
        check(`setup: add ${role}`, r.status === 200, r.json);
    }

    // --- 1. Profile ------------------------------------------------------------------------------
    const handle = `h.${stamp()}`.slice(0, 30);
    let r = await call('PUT', '/v1/user', {
        ...as(owner), body: {
            handle, title: 'Lead', pronouns: 'they/them', timezone: 'Europe/Berlin',
            preferences: { accent: 'violet' }, notification_prefs: { mentions: true, digest: 'daily' },
        },
    });
    check('profile: update fields', r.status === 200 && r.data.handle === handle && r.data.title === 'Lead'
        && r.data.timezone === 'Europe/Berlin' && r.data.preferences.accent === 'violet' && !('password' in r.data), r.json);
    r = await call('PUT', '/v1/user', { ...as(owner), body: { preferences: { density: 'compact' }, notification_prefs: { snooze_until: new Date().toISOString() } } });
    check('profile: json merge', r.status === 200 && r.data.preferences.accent === 'violet' && r.data.preferences.density === 'compact'
        && r.data.notification_prefs.digest === 'daily' && typeof r.data.notification_prefs.snooze_until === 'string', r.json);
    r = await call('PUT', '/v1/user', { ...as(owner), body: { notification_prefs: { snooze_until: null } } });
    check('profile: snooze_until null', r.status === 200 && r.data.notification_prefs.snooze_until === null, r.json);
    r = await call('PUT', '/v1/user', { ...as(member, member.ws), body: { handle } });
    check('profile: duplicate handle 409', r.status === 409 && JSON.stringify(r.json).includes('Handle is taken'), r.json);
    r = await call('PUT', '/v1/user', { ...as(member, member.ws), body: { handle: 'Bad Handle' } });
    check('profile: invalid handle 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/user', { ...as(member, member.ws), body: { timezone: 'Mars/Olympus' } });
    check('profile: invalid timezone 400', r.status === 400, r.json);
    r = await call('GET', `/v1/user/handle?handle=${handle}`, as(member, member.ws));
    check('handle availability: taken', r.status === 200 && r.data.available === false, r.json);
    r = await call('GET', `/v1/user/handle?handle=${handle}`, as(owner));
    check('handle availability: own handle available', r.status === 200 && r.data.available === true, r.json);
    r = await call('GET', `/v1/user/handle?handle=free-${stamp()}`, as(member, member.ws));
    check('handle availability: free', r.status === 200 && r.data.available === true, r.json);
    r = await call('GET', '/v1/auth', { token: owner.token });
    check('/v1/auth returns profile fields', r.status === 200 && r.data.user_info.handle === handle
        && r.data.user_info.preferences?.density === 'compact', r.json);
    r = await call('POST', '/v1/auth/login', { body: { email: owner.email, password: 'Passw0rd!123' } });
    check('login returns profile fields', r.status === 200 && r.data.user_info.handle === handle, r.json);
    owner.token = r.data.token; // login replaces the token
    o.token = owner.token;

    // --- 2. Workspace settings -------------------------------------------------------------------
    const slug = `ws-${stamp()}`.slice(0, 40);
    r = await call('PUT', '/v1/workspace', {
        ...as(admin), body: {
            _id: owner.ws, slug, language: 'de-DE', sprint_cadence: '3w', issue_prefix: 'ENG',
            features: { chat: false }, auto_archive_days: 30, space_policies: { allow_member_public_create: true },
        },
    });
    check('workspace: admin PUT new fields', r.status === 200 && r.data.slug === slug && r.data.issue_prefix === 'ENG'
        && r.data.features.chat === false && r.data.auto_archive_days === 30, r.json);
    r = await call('PUT', '/v1/workspace', { ...o, body: { _id: owner.ws, features: { scrum: true } } });
    check('workspace: features merge', r.status === 200 && r.data.features.chat === false && r.data.features.scrum === true, r.json);
    r = await call('PUT', '/v1/workspace', { ...as(member), body: { _id: owner.ws, language: 'fr' } });
    check('workspace: member PUT 403', r.status === 403, r.json);
    r = await call('PUT', '/v1/workspace', { ...as(outsider, outsider.ws), body: { _id: outsider.ws, slug } });
    check('workspace: duplicate slug 409', r.status === 409, r.json);
    r = await call('PUT', '/v1/workspace', { ...o, body: { _id: owner.ws, issue_prefix: 'eng' } });
    check('workspace: invalid issue_prefix 400', r.status === 400, r.json);
    r = await call('GET', `/v1/workspace/slug?slug=${slug}`, as(outsider, outsider.ws));
    check('slug availability: taken', r.status === 200 && r.data.available === false, r.json);
    r = await call('GET', `/v1/workspace/slug?slug=${slug}`, o);
    check('slug availability: own slug available', r.status === 200 && r.data.available === true, r.json);
    r = await call('GET', `/v1/workspace?id=${owner.ws}`, o);
    check('workspace: GET returns fields', r.status === 200 && r.data.slug === slug && r.data.sprint_cadence === '3w'
        && r.data.language === 'de-DE' && 'archived_at' in r.data, r.json);

    r = await call('PUT', '/v1/workspace/archive', { ...as(admin), body: { archived: true } });
    check('workspace archive: admin 403', r.status === 403, r.json);
    r = await call('PUT', '/v1/workspace/archive', { ...o, body: { archived: true } });
    check('workspace archive: owner sets archived_at', r.status === 200 && !!r.data.archived_at, r.json);
    r = await call('PUT', '/v1/workspace/archive', { ...o, body: { archived: false } });
    check('workspace archive: owner clears archived_at', r.status === 200 && !r.data.archived_at, r.json);

    // Ownership transfer on a separate workspace: outsider's workspace, with member `admin` joined
    const t = await register('transfer');
    await call('POST', '/v1/workspace/member', { token: t.token, ws: t.ws, body: { email: member.email, role: 'member' } });
    r = await call('PUT', '/v1/workspace/owner', { token: member.token, ws: t.ws, body: { user_id: member.userId } });
    check('owner transfer: non-owner 403', r.status === 403, r.json);
    r = await call('PUT', '/v1/workspace/owner', { token: t.token, ws: t.ws, body: { user_id: outsider.userId } });
    check('owner transfer: non-member target 404', r.status === 404, r.json);
    r = await call('PUT', '/v1/workspace/owner', { token: t.token, ws: t.ws, body: { user_id: member.userId } });
    const oldOwnerRole = (r.data?.member_roles || []).find((x) => x.user_id === t.userId);
    check('owner transfer: success', r.status === 200 && r.data.owner_id === member.userId
        && r.data.members.includes(t.userId) && !r.data.members.includes(member.userId)
        && oldOwnerRole?.role === 'admin' && !(r.data.member_roles || []).some((x) => x.user_id === member.userId), r.json);

    // --- 3. Members --------------------------------------------------------------------------------
    // Give `member` a space so space_ids is populated
    const mkSpace = async (auth, body) => call('POST', '/v1/space', { ...auth, body: { name: `S ${stamp()}`, is_default: false, ...body } });
    r = await mkSpace(o, { user_id: owner.userId, is_private: true, shared_members: [member.userId] });
    check('setup: private space shared with member', r.status === 200, r.json);
    const privateSpace = r.data;
    r = await call('GET', '/v1/workspace/member', as(member));
    const mRow = r.data?.members?.find((x) => x._id === member.userId);
    check('member list: new fields', r.status === 200 && r.data.owner.workspace_role === 'owner' && r.data.owner.status === 'active'
        && mRow?.status === 'active' && mRow?.workspace_role === 'member' && !!mRow?.joined_at
        && Array.isArray(mRow?.space_ids) && mRow.space_ids.includes(privateSpace._id)
        && 'title' in mRow && 'handle' in mRow && 'last_seen_at' in mRow && !('password' in mRow)
        && r.data.owner.handle === handle && r.data.owner.space_ids.includes(privateSpace._id), r.json);
    check('member list: last_seen_at set', !!r.data?.owner?.last_seen_at, r.data?.owner);

    r = await call('PUT', '/v1/workspace/member', { ...as(member), body: { user_id: admin.userId, role: 'guest' } });
    check('member role: non-admin 403', r.status === 403, r.json);
    r = await call('PUT', '/v1/workspace/member', { ...as(admin), body: { user_id: admin.userId, status: 'suspended' } });
    check('member status: cannot suspend self', r.status === 400, r.json);
    r = await call('PUT', '/v1/workspace/member', { ...as(admin), body: { user_id: owner.userId, status: 'suspended' } });
    check('member status: cannot suspend owner', r.status === 400, r.json);
    r = await call('PUT', '/v1/workspace/member', { ...as(admin), body: { user_id: member.userId, role: 'guest' } });
    const entryAfterRole = (r.data?.member_roles || []).find((x) => x.user_id === member.userId);
    check('member role: change keeps joined_at', r.status === 200 && entryAfterRole?.role === 'guest' && !!entryAfterRole?.joined_at, r.json);
    r = await call('PUT', '/v1/workspace/member', { ...as(admin), body: { user_id: member.userId, status: 'suspended' } });
    check('member status: suspend', r.status === 200 && (r.data.member_roles || []).find((x) => x.user_id === member.userId)?.status === 'suspended', r.json);
    r = await call('GET', '/v1/workspace/member', as(member));
    check('suspended: 403 with that workspace header', r.status === 403 && JSON.stringify(r.json).includes('suspended'), r.json);
    r = await call('GET', `/v1/space?user_id=${member.userId}`, as(member));
    check('suspended: 403 on entity routes too', r.status === 403, r.json);
    r = await call('GET', '/v1/workspace/member', as(member, member.ws));
    check('suspended: own workspace still works', r.status === 200, r.json);
    r = await call('GET', '/v1/workspace/member', o);
    check('member list: shows suspended status', r.data?.members?.find((x) => x._id === member.userId)?.status === 'suspended', r.json);
    r = await call('PUT', '/v1/workspace/member', { ...as(admin), body: { user_id: member.userId, status: 'active', role: 'member' } });
    r = await call('GET', '/v1/workspace/member', as(member));
    check('reactivated: access restored', r.status === 200, r.json);

    r = await call('PUT', '/v1/workspace/member/bulk', { ...as(admin), body: { user_ids: [member.userId, admin.userId, owner.userId, outsider.userId], role: 'guest' } });
    check('bulk: skips owner/self/non-members', r.status === 200 && r.data.updated === 1, r.json);
    r = await call('GET', '/v1/workspace/member', o);
    check('bulk: role applied', r.data?.members?.find((x) => x._id === member.userId)?.workspace_role === 'guest'
        && r.data?.members?.find((x) => x._id === admin.userId)?.workspace_role === 'admin', r.json);
    r = await call('PUT', '/v1/workspace/member/bulk', { ...as(member), body: { user_ids: [admin.userId], status: 'suspended' } });
    check('bulk: non-admin 403', r.status === 403, r.json);
    await call('PUT', '/v1/workspace/member', { ...o, body: { user_id: member.userId, role: 'member' } });

    // --- 4. Invitations ---------------------------------------------------------------------------
    r = await mkSpace(o, { user_id: owner.userId, is_private: true });
    const inviteSpace = r.data;
    const newEmail = `set-invitee-${stamp()}@example.test`;
    r = await call('POST', '/v1/workspace/invitation', {
        ...as(admin), body: { emails: [outsider.email.toUpperCase(), newEmail, member.email], role: 'guest', space_ids: [inviteSpace._id] },
    });
    const byEmail = Object.fromEntries((r.data?.results || []).map((x) => [x.email, x]));
    check('invite: existing non-member added', byEmail[outsider.email.toLowerCase()]?.outcome === 'added', r.json);
    check('invite: unknown email invited', byEmail[newEmail]?.outcome === 'invited' && /^[0-9a-f]{64}$/.test(byEmail[newEmail]?.invitation?.token || '')
        && !!byEmail[newEmail]?.invitation?._id && !!byEmail[newEmail]?.invitation?.expires_at, r.json);
    check('invite: existing member skipped', byEmail[member.email]?.outcome === 'skipped' && !!byEmail[member.email]?.reason, r.json);
    r = await call('POST', '/v1/workspace/invitation', { ...as(member), body: { emails: [newEmail], role: 'member' } });
    check('invite: non-admin 403', r.status === 403, r.json);
    r = await call('GET', '/v1/workspace/member', o);
    const outsiderRow = r.data?.members?.find((x) => x._id === outsider.userId);
    check('invite: added user has role + space', outsiderRow?.workspace_role === 'guest' && outsiderRow?.space_ids?.includes(inviteSpace._id), outsiderRow);

    r = await call('GET', '/v1/workspace/invitation', as(admin));
    const listed = (r.data || []).find((x) => x.email === newEmail);
    check('invite list: pending with inviter', r.status === 200 && listed?.status === 'pending' && listed?.invited_by?._id === admin.userId
        && listed?.invited_by?.email === admin.email && listed?.space_ids?.includes(inviteSpace._id), r.json);
    const firstToken = listed?.token;
    r = await call('POST', '/v1/workspace/invitation/resend', { ...as(admin), body: { id: listed?._id } });
    check('invite resend: new token', r.status === 200 && r.data.token && r.data.token !== firstToken, r.json);
    r = await call('GET', `/v1/invitation?token=${firstToken}`, {});
    check('invite: old token 404 after resend', r.status === 404, r.json);

    // Expired invitation is excluded from the list
    const expEmail = `set-expired-${stamp()}@example.test`;
    r = await call('POST', '/v1/workspace/invitation', { ...o, body: { emails: [expEmail], role: 'member' } });
    const expId = r.data?.results?.[0]?.invitation?._id;
    await db.collection('invitation').updateOne({ _id: new ObjectId(expId) }, { $set: { expires_at: new Date(Date.now() - 1000).toISOString() } });
    r = await call('GET', '/v1/workspace/invitation', o);
    check('invite list: expired excluded', !(r.data || []).some((x) => x._id === expId)
        && (await db.collection('invitation').findOne({ _id: new ObjectId(expId) }))?.status === 'expired', r.json);
    const expTok = (await db.collection('invitation').findOne({ _id: new ObjectId(expId) }))?.token;
    r = await call('GET', `/v1/invitation?token=${expTok}`, {});
    check('invite lookup: expired 410', r.status === 410, r.json);

    // Unknown email registers -> auto-accepted
    const invitee = await registerEmail('invitee', newEmail);
    check('register: invited workspace in response', invitee.auth.workspaces.some((w) => w._id === owner.ws), invitee.auth.workspaces.map((w) => w._id));
    r = await call('GET', '/v1/workspace/member', o);
    const inviteeRow = r.data?.members?.find((x) => x._id === invitee.userId);
    check('register: member with invited role + space', inviteeRow?.workspace_role === 'guest' && inviteeRow?.space_ids?.includes(inviteSpace._id), inviteeRow);
    const spaceRow = await db.collection('space').findOne({ _id: new ObjectId(inviteSpace._id) });
    check('register: in private space shared_members', (spaceRow?.shared_members || []).includes(invitee.userId), spaceRow);
    r = await call('GET', '/v1/workspace/invitation', o);
    check('invite list: accepted removed', !(r.data || []).some((x) => x.email === newEmail), r.json);

    // Invitation for an existing account resolved via /v1/auth (inserted directly to simulate a pending one)
    const lateUser = await register('late');
    const lateToken = 'ab'.repeat(32);
    await db.collection('invitation').insertOne({
        workspace_id: owner.ws, email: lateUser.email.toLowerCase(), role: 'member', space_ids: [], token: lateToken,
        invited_by: owner.userId, status: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString(),
    });
    r = await call('GET', '/v1/auth', { token: lateUser.token });
    check('/v1/auth: auto-accepts pending invitation', r.status === 200 && r.data.workspaces.some((w) => w._id === owner.ws), r.json);

    // Revoke
    const revEmail = `set-revoke-${stamp()}@example.test`;
    r = await call('POST', '/v1/workspace/invitation', { ...o, body: { emails: [revEmail], role: 'member' } });
    const rev = r.data?.results?.[0]?.invitation;
    r = await call('DELETE', `/v1/workspace/invitation?id=${rev?._id}`, o);
    check('invite revoke: ok', r.status === 200 && r.data.status === 'revoked', r.json);
    r = await call('GET', `/v1/invitation?token=${rev?.token}`, {});
    check('invite lookup: revoked 410', r.status === 410, r.json);

    // Public token lookup + accept
    const linkUser = await register('link');
    const linkEmailInvite = await call('POST', '/v1/workspace/invitation', { ...o, body: { emails: [`set-other-${stamp()}@example.test`], role: 'member' } });
    const otherTok = linkEmailInvite.data?.results?.[0]?.invitation?.token;
    const linkTok = 'cd'.repeat(32);
    await db.collection('invitation').insertOne({
        workspace_id: owner.ws, email: linkUser.email.toLowerCase(), role: 'admin', space_ids: [], token: linkTok,
        invited_by: owner.userId, status: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString(),
    });
    r = await call('GET', `/v1/invitation?token=${linkTok}`, {});
    check('invite lookup: public', r.status === 200 && r.data.workspace._id === owner.ws && r.data.email === linkUser.email.toLowerCase()
        && r.data.role === 'admin' && r.data.status === 'pending' && !!r.data.expires_at, r.json);
    r = await call('GET', `/v1/invitation?token=${'ef'.repeat(32)}`, {});
    check('invite lookup: unknown 404', r.status === 404, r.json);
    r = await call('POST', '/v1/invitation/accept', { token: linkUser.token, body: { token: otherTok } });
    check('invite accept: email mismatch 403', r.status === 403, r.json);
    r = await call('POST', '/v1/invitation/accept', { body: { token: linkTok } });
    check('invite accept: requires auth', r.status === 401, r.json);
    r = await call('POST', '/v1/invitation/accept', { token: linkUser.token, body: { token: linkTok } });
    check('invite accept: ok', r.status === 200 && r.data.workspace._id === owner.ws
        && (r.data.workspace.member_roles || []).some((x) => x.user_id === linkUser.userId && x.role === 'admin'), r.json);
    r = await call('GET', `/v1/invitation?token=${linkTok}`, {});
    check('invite lookup: accepted status', r.status === 200 && r.data.status === 'accepted', r.json);

    // --- 5. Spaces -----------------------------------------------------------------------------------
    r = await mkSpace(o, { user_id: owner.userId, is_private: false });
    const archSpace = r.data;
    r = await call('PUT', '/v1/space/archive', { ...as(member), body: { id: archSpace._id, archived: true } });
    check('space archive: plain member 403', r.status === 403, r.json);
    r = await call('PUT', '/v1/space/archive', { ...as(admin), body: { id: archSpace._id, archived: true } });
    check('space archive: ws admin ok', r.status === 200 && !!r.data.archived_at, r.json);
    r = await call('GET', `/v1/space?user_id=${owner.userId}`, o);
    check('space list: archived hidden', r.status === 200 && !r.data.some((s) => s._id === archSpace._id), r.json);
    r = await call('GET', `/v1/space?user_id=${owner.userId}&include_archived=true`, o);
    check('space list: include_archived shows it', r.status === 200 && r.data.some((s) => s._id === archSpace._id && s.archived_at), r.json);
    r = await call('GET', `/v1/space?id=${archSpace._id}`, o);
    check('space get by id: returns archived', r.status === 200 && r.data[0]?._id === archSpace._id && !!r.data[0]?.archived_at, r.json);
    r = await call('PUT', '/v1/space', { ...o, body: { id: archSpace._id, member_roles: { [member.userId]: 'manager' }, space_lead: member.userId } });
    check('space PUT: member_roles + space_lead', r.status === 200 && r.data.member_roles?.[member.userId] === 'manager' && r.data.space_lead === member.userId, r.json);
    r = await call('PUT', '/v1/space/archive', { ...as(member), body: { id: archSpace._id, archived: false } });
    check('space archive: space manager can unarchive', r.status === 200 && !r.data.archived_at, r.json);

    // Public-space policy
    r = await mkSpace(as(member), { user_id: member.userId, is_private: false });
    check('policy unset/true: member creates public space', r.status === 200, r.json);
    await call('PUT', '/v1/workspace', { ...o, body: { _id: owner.ws, space_policies: { allow_member_public_create: false } } });
    r = await mkSpace(as(member), { user_id: member.userId, is_private: false });
    check('policy false: member public space 403', r.status === 403 && JSON.stringify(r.json).includes('Only admins can create public spaces'), r.json);
    r = await mkSpace(as(member), { user_id: member.userId, is_private: true });
    check('policy false: member private space ok', r.status === 200, r.json);
    r = await mkSpace(as(admin), { user_id: admin.userId, is_private: false });
    check('policy false: admin public space ok', r.status === 200, r.json);
    r = await call('GET', `/v1/workspace?id=${owner.ws}`, o);
    check('policy: merge kept other fields', r.data?.space_policies?.allow_member_public_create === false && r.data?.features?.chat === false, r.data);

    // --- 6. Workspace logo upload -------------------------------------------------------------------
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const logoForm = () => {
        const f = new FormData();
        f.append('reference_for', 'workspace');
        f.append('reference_id', owner.ws);
        f.append('media_type', 'icon');
        f.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
        return f;
    };
    r = await call('POST', '/v1/upload/media', { ...as(member), form: logoForm() });
    check('logo upload: member 403', r.status === 403, r.json);
    const before = await call('GET', '/v1/workspace/storage', o);
    r = await call('POST', '/v1/upload/media', { ...as(admin), form: logoForm() });
    check('logo upload: admin ok returns url', r.status === 200 && /^http:\/\/cdn\.test\//.test(r.data?.url || ''), r.json);
    const logoUrl = r.data?.url;
    r = await call('GET', `/v1/workspace?id=${owner.ws}`, o);
    check('logo upload: workspace.logo set', r.data?.logo === logoUrl, r.data?.logo);
    const after = await call('GET', '/v1/workspace/storage', o);
    check('logo upload: counted in storage', after.data?.used_bytes === (before.data?.used_bytes || 0) + png.length
        && after.data?.file_count === (before.data?.file_count || 0) + 1, { before: before.data, after: after.data });
    const badForm = logoForm();
    badForm.set('media_type', 'cover_photo');
    r = await call('POST', '/v1/upload/media', { ...as(admin), form: badForm });
    check('logo upload: media_type must be icon', r.status === 400, r.json);

    s3.close();
    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
