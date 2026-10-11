#!/usr/bin/env node
/**
 * Studio checks: page studio fields, page locking, page stats, socket auth, presence, and the
 * space-access guest ceiling.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   mongod --dbpath /tmp/studiodb --port 27998 --bind_ip 127.0.0.1
 *   MONGODB_URI=mongodb://127.0.0.1:27998/studiotest PORT=3201 node server.js
 *   API_URL=http://127.0.0.1:3201 MONGODB_URI=mongodb://127.0.0.1:27998/studiotest node dev-test/studio-endpoints.mjs
 *
 * socket.io-client is not a dependency of this repo; it is imported from the frontend checkout
 * (override with SOCKET_IO_CLIENT=/abs/path/to/socket.io-client).
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { MongoClient } from 'mongodb';

const API = process.env.API_URL || 'http://127.0.0.1:3201';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27998/studiotest';
if (!/127\.0\.0\.1|localhost/.test(MONGO)) {
    console.error('Refusing to run against a non-local MONGODB_URI');
    process.exit(2);
}
const SOCKET_IO_CLIENT = process.env.SOCKET_IO_CLIENT
    || '/home/ocean/client/frontend/node_modules/socket.io-client';
const { io: ioClient } = await import(pathToFileURL(path.join(SOCKET_IO_CLIENT, 'build/esm/index.js')).href)
    .catch(() => import(pathToFileURL(path.join(SOCKET_IO_CLIENT, 'build/cjs/index.js')).href));

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

const call = async (method, p, { token, ws, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-ID'] = ws;
    const res = await fetch(`${API}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json, data: json?.data };
};

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const register = async (label) => {
    const res = await call('POST', '/v1/auth/register', {
        body: { name: `Studio ${label}`, email: `studio-${label}-${stamp()}@example.test`, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    const own = res.data.workspaces.find((w) => w.owner_id === res.data.user_info._id);
    return { token: res.data.token, userId: res.data.user_info._id, email: res.data.user_info.email, name: res.data.user_info.name, ws: own._id };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connect = (auth) => new Promise((resolve) => {
    const socket = ioClient(API, { auth, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 4000 });
    socket.on('connect', () => resolve({ socket, ok: true }));
    socket.on('connect_error', (err) => resolve({ socket, ok: false, error: err.message }));
});

/** Collects presence:update events for a socket. */
const recorder = (socket) => {
    const events = [];
    socket.on('presence:update', (e) => events.push(e));
    return {
        events,
        last: () => events[events.length - 1],
        waitFor: async (pred, ms = 3000) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const hit = [...events].reverse().find(pred);
                if (hit) return hit;
                await sleep(25);
            }
            return null;
        },
    };
};
const emitAck = (socket, event, payload) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), 4000);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});

const main = async () => {
    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();

    const owner = await register('owner');
    const admin = await register('admin');
    const member = await register('member');
    const member2 = await register('member2');
    const guest = await register('guest');
    const outsider = await register('outsider');
    const as = (u, ws = owner.ws) => ({ token: u.token, ws });
    const o = as(owner);

    for (const [u, role] of [[admin, 'admin'], [member, 'member'], [member2, 'member'], [guest, 'guest']]) {
        const r = await call('POST', '/v1/workspace/member', { ...o, body: { email: u.email, role } });
        check(`setup: add ${role} ${u.name}`, r.status === 200, r.json);
    }

    const spaceRes = await call('POST', '/v1/space', { ...o, body: { user_id: owner.userId, name: 'Studio Space', is_private: false } });
    const space = Array.isArray(spaceRes.data) ? spaceRes.data[0] : spaceRes.data;
    // Page created by `member` so that owner = workspace owner (admin) and member = creator.
    const mkDoc = async (u, body) => {
        const res = await call('POST', '/v1/page/document', {
            ...as(u), body: { user_id: u.userId, page_type: 'document', content: { blocks: [{ text: 'hello' }] }, space_id: space._id, ...body },
        });
        if (res.status !== 200) throw new Error(`create doc failed: ${JSON.stringify(res.json)}`);
        const d = res.data;
        return d.pageMeta || d.page_meta || d;
    };
    const page = await mkDoc(member, { title: 'Studio doc' });
    check('setup: page created', !!page?._id, page);

    // --- 1. Studio fields --------------------------------------------------------------------
    let r = await call('GET', `/v1/page/document?id=${page._id}`, as(member));
    check('fields: defaults on GET', r.status === 200 && r.data.icon === '' && r.data.subtitle === '' && r.data.doc_status === 'draft'
        && r.data.cover_position === null && r.data.locked === false && r.data.locked_by === null && r.data.locked_at === null, r.data);

    r = await call('PUT', '/v1/page/document', {
        ...as(member), body: { id: page._id, icon: '📘', subtitle: 'A short subtitle', doc_status: 'in_review', cover_position: 35 },
    });
    check('fields: PUT round-trip response', r.status === 200 && r.data.icon === '📘' && r.data.subtitle === 'A short subtitle'
        && r.data.doc_status === 'in_review' && r.data.cover_position === 35 && r.data.title === 'Studio doc', r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, doc_status: 'approved' } });
    r = await call('GET', `/v1/page/document?id=${page._id}`, as(member));
    check('fields: partial update keeps others, top-level on GET', r.status === 200 && r.data.icon === '📘' && r.data.subtitle === 'A short subtitle'
        && r.data.doc_status === 'approved' && r.data.cover_position === 35 && r.data.pageContent, r.data);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, doc_status: 'bogus' } });
    check('fields: invalid doc_status 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, cover_position: 101 } });
    check('fields: cover_position > 100 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, cover_position: 12.5 } });
    check('fields: non-integer cover_position 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, icon: 'x'.repeat(65) } });
    check('fields: icon > 64 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, subtitle: 'x'.repeat(301) } });
    check('fields: subtitle > 300 400', r.status === 400, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, locked_by: outsider.userId, title: 'Studio doc' } });
    check('fields: locked_by is not client-settable', r.status === 200 && r.data.locked_by === null, r.data?.locked_by);

    // --- Locking -----------------------------------------------------------------------------
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, locked: true } });
    check('lock: non-creator non-admin cannot lock (403)', r.status === 403, r.json);

    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, locked: true } });
    check('lock: creator locks', r.status === 200 && r.data.locked === true && r.data.locked_by === member.userId && !!r.data.locked_at, r.data);

    r = await call('GET', `/v1/page/document?id=${page._id}`, as(member2));
    check('lock: others can still read', r.status === 200 && r.data.locked === true, r.status);

    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, title: 'Hacked' } });
    check('lock: member title edit -> 423', r.status === 423 && /locked/i.test(JSON.stringify(r.json)), r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, content: JSON.stringify({ blocks: [{ text: 'changed' }] }) } });
    check('lock: member content edit -> 423', r.status === 423, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, icon: '🔥' } });
    check('lock: member icon edit -> 423', r.status === 423, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, title: 'Studio doc', pinned: true } });
    check('lock: unchanged protected field + unprotected change allowed', r.status === 200, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, locked: false } });
    check('lock: member cannot unlock (403)', r.status === 403, r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, locked: false, title: 'Sneaky' } });
    check('lock: member unlock+edit -> 403', r.status === 403, r.json);
    const pageContent = await db.collection('page_meta').findOne({ title: 'Studio doc' });
    check('lock: title unchanged in db', !!pageContent, pageContent?.title);

    r = await call('PUT', '/v1/page/document', { ...as(admin), body: { id: page._id, title: 'Admin edit', subtitle: 'by admin' } });
    check('lock: workspace admin can still edit', r.status === 200 && r.data.title === 'Admin edit' && r.data.locked === true, r.json);
    r = await call('PUT', '/v1/page/document', { ...o, body: { id: page._id, content: JSON.stringify({ blocks: [{ text: 'owner' }] }) } });
    check('lock: workspace owner can edit content', r.status === 200 && JSON.stringify(r.data.pageContent?.content).includes('owner'), r.json);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, title: 'Creator edit' } });
    check('lock: creator can edit while locked', r.status === 200 && r.data.title === 'Creator edit', r.json);

    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, locked: false, title: 'Unlocked title' } });
    check('lock: unlock + edit in one request', r.status === 200 && r.data.locked === false && r.data.locked_by === null
        && r.data.locked_at === null && r.data.title === 'Unlocked title', r.data);
    r = await call('PUT', '/v1/page/document', { ...as(member2), body: { id: page._id, title: 'Member edit' } });
    check('lock: member edits after unlock', r.status === 200 && r.data.title === 'Member edit', r.json);

    // Lock holder (admin locked it) can unlock; creator also can.
    r = await call('PUT', '/v1/page/document', { ...as(admin), body: { id: page._id, locked: true } });
    check('lock: admin locks', r.status === 200 && r.data.locked_by === admin.userId, r.data);
    r = await call('PUT', '/v1/page/document', { ...as(member), body: { id: page._id, locked: false } });
    check('lock: creator unlocks admin lock', r.status === 200 && r.data.locked === false, r.json);

    r = await call('PUT', '/v1/page/document', { ...as(outsider, outsider.ws), body: { id: page._id, title: 'outsider' } });
    check('access: outsider PUT rejected', r.status === 403, r.status);

    // --- 2. Stats ----------------------------------------------------------------------------
    await call('POST', '/v1/comment', { ...o, body: { user_id: owner.userId, page_id: page._id, comment_body: 'c1', content: { text: 'c1' } } });
    const c2 = await call('POST', '/v1/comment', { ...as(member), body: { user_id: member.userId, page_id: page._id, comment_body: 'c2', content: { text: 'c2' } } });
    // Replies carry only parent_id. POST /v1/comment with body.parent_id is caught by the
    // authorization middleware's folder check, so the reply row is inserted directly.
    check('setup: comments on page', c2.status === 200 && !!c2.data?._id, c2.json);
    await db.collection('comment_meta').insertOne({ user_id: owner.userId, page_id: '', parent_id: c2.data?._id, associate_id: '', comment_body: 'reply', attachments: [], has_childs: false, createdAt: new Date(), updatedAt: new Date() });

    r = await call('GET', `/v1/page/stats?id=${page._id}`, as(member));
    check('stats: zero views before recent', r.status === 200 && r.data.views === 0 && Array.isArray(r.data.viewers) && r.data.viewers.length === 0, r.json);
    await call('POST', '/v1/recent', { ...as(member), body: { entity_type: 'page', entity_id: page._id } });
    await sleep(20);
    await call('POST', '/v1/recent', { ...as(member2), body: { entity_type: 'page', entity_id: page._id } });
    await sleep(20);
    await call('POST', '/v1/recent', { ...as(member2), body: { entity_type: 'page', entity_id: page._id } });
    r = await call('GET', `/v1/page/stats?id=${page._id}`, as(member));
    const s = r.data || {};
    check('stats: views = 2 distinct users', r.status === 200 && s.views === 2, s);
    check('stats: viewers newest first with shape', s.viewers?.length === 2 && s.viewers[0]._id === member2.userId
        && s.viewers[1]._id === member.userId && s.viewers[0].email === member2.email && s.viewers[0].name
        && 'avatar' in s.viewers[0] && s.viewers[0].viewed_at, s.viewers);
    check('stats: comment_count = 2 threads + 1 reply', s.comment_count === 3, s.comment_count);
    check('stats: last_updated_by + updatedAt', s.last_updated_by?._id === member.userId && 'avatar' in s.last_updated_by
        && s.updatedAt !== undefined, s);
    r = await call('GET', `/v1/page/stats?id=${page._id}`, as(outsider, outsider.ws));
    check('stats: outsider denied', r.status === 403, r.status);
    r = await call('GET', `/v1/page/stats?id=${page._id}`, as(outsider));
    check('stats: outsider with foreign workspace header denied', r.status === 403, r.status);

    // --- 3. Socket auth ----------------------------------------------------------------------
    let conn = await connect({ token: member.token, userId: member.userId, workspaceId: owner.ws });
    check('socket: valid token connects', conn.ok, conn.error);
    const mSock = conn.socket;
    conn = await connect({ token: 'bogus.token.value', userId: member.userId, workspaceId: owner.ws });
    check('socket: bogus token rejected (unauthorized)', !conn.ok && conn.error === 'unauthorized', conn.error);
    conn.socket.close();
    conn = await connect({ userId: member.userId, workspaceId: owner.ws });
    check('socket: missing token rejected', !conn.ok && conn.error === 'unauthorized', conn.error);
    conn.socket.close();
    // Spoofed userId is ignored (user id comes from the token).
    const spoof = await new Promise((resolve) => {
        const sock = ioClient(API, { auth: { token: member2.token, userId: owner.userId, workspaceId: owner.ws }, transports: ['websocket'], reconnection: false, forceNew: true });
        sock.on('connected', (info) => resolve({ sock, info }));
        sock.on('connect_error', (e) => resolve({ sock, info: { error: e.message } }));
    });
    check('socket: userId taken from token, not handshake', spoof.info.userId === member2.userId && spoof.info.workspaceId === owner.ws, spoof.info);
    const m2Sock = spoof.sock;
    const outsiderConn = await new Promise((resolve) => {
        const sock = ioClient(API, { auth: { token: outsider.token, workspaceId: owner.ws }, transports: ['websocket'], reconnection: false, forceNew: true });
        sock.on('connected', (info) => resolve({ sock, info }));
        sock.on('connect_error', (e) => resolve({ sock, info: { error: e.message } }));
    });
    check('socket: non-member connects but not into the workspace room', !outsiderConn.info.error && outsiderConn.info.workspaceId === null, outsiderConn.info);

    // --- Presence ----------------------------------------------------------------------------
    const target = { entity_type: 'page', entity_id: page._id };
    const recM = recorder(mSock);
    const recM2 = recorder(m2Sock);
    let ack = await emitAck(mSock, 'presence:join', target);
    check('presence: join ack ok', ack?.ok === true && ack.users?.length === 1 && ack.users[0].user_id === member.userId, ack);
    ack = await emitAck(m2Sock, 'presence:join', target);
    check('presence: second join ack has 2 users', ack?.ok === true && ack.users?.length === 2, ack);
    const two = (e) => e.entity_id === page._id && e.entity_type === 'page' && e.users.length === 2;
    const evM = await recM.waitFor(two);
    const evM2 = await recM2.waitFor(two);
    check('presence: both clients receive update with 2 users', !!evM && !!evM2, { m: recM.events, m2: recM2.events });
    check('presence: users sorted by since with shape', evM && evM.users[0].user_id === member.userId && evM.users[1].user_id === member2.userId
        && evM.users.every((u) => 'name' in u && 'avatar' in u && u.editing === false && u.since), evM);

    // Second tab for member2: still 2 users.
    const tab2 = (await connect({ token: member2.token, workspaceId: owner.ws })).socket;
    ack = await emitAck(tab2, 'presence:join', target);
    check('presence: second tab de-duplicated', ack?.ok === true && ack.users.length === 2, ack);

    ack = await emitAck(tab2, 'presence:editing', { ...target, editing: true });
    const editingEv = await recM.waitFor((e) => e.users.some((u) => u.user_id === member2.userId && u.editing === true));
    check('presence: editing flag broadcast (any tab editing)', ack?.ok === true && !!editingEv, recM.events.slice(-3));

    // Throttle: rapid toggles yield at most a couple of broadcasts, final state correct.
    const before = recM.events.length;
    for (let i = 0; i < 6; i += 1) {
        tab2.emit('presence:editing', { ...target, editing: i % 2 === 1 });
    }
    await sleep(1200);
    const burst = recM.events.length - before;
    const finalState = recM.last()?.users.find((u) => u.user_id === member2.userId);
    check('presence: editing broadcasts throttled', burst >= 1 && burst <= 3, burst);
    check('presence: final editing state after burst', finalState?.editing === true, recM.last());

    tab2.close();
    const afterTab = await recM.waitFor((e) => e.users.length === 2 && e.users.find((u) => u.user_id === member2.userId)?.editing === false);
    check('presence: closing editing tab clears editing, user remains', !!afterTab, recM.last());

    m2Sock.close();
    const oneLeft = await recM.waitFor((e) => e.users.length === 1 && e.users[0].user_id === member.userId);
    check('presence: disconnect removes the user', !!oneLeft, recM.last());

    ack = await emitAck(outsiderConn.sock, 'presence:join', target);
    check('presence: no-access user gets { ok:false }', ack?.ok === false && typeof ack.error === 'string', ack);
    const sOutsider = (await connect({ token: outsider.token, workspaceId: outsider.ws })).socket;
    ack = await emitAck(sOutsider, 'presence:join', target);
    check('presence: outsider in own workspace gets { ok:false }', ack?.ok === false, ack);
    ack = await emitAck(mSock, 'presence:join', { entity_type: 'nope', entity_id: page._id });
    check('presence: invalid entity_type rejected', ack?.ok === false, ack);
    ack = await emitAck(mSock, 'presence:leave', target);
    check('presence: leave ack', ack?.ok === true, ack);
    ack = await emitAck(mSock, 'presence:editing', { ...target, editing: true });
    check('presence: editing after leave rejected', ack?.ok === false, ack);
    const spaceAck = await emitAck(mSock, 'presence:join', { entity_type: 'space', entity_id: space._id });
    check('presence: join a space', spaceAck?.ok === true && spaceAck.users.length === 1, spaceAck);

    for (const sock of [mSock, outsiderConn.sock, sOutsider]) sock.close();

    // --- 4. Guest cannot be a space manager --------------------------------------------------
    r = await call('PUT', `/v1/space/access?id=${space._id}`, { ...o, body: { shared_members: [{ user_id: guest.userId, role: 'manager' }] } });
    check('space access: guest cannot be manager (400)', r.status === 400 && /Guest/.test(JSON.stringify(r.json)), r.json);
    r = await call('PUT', `/v1/space/access?id=${space._id}`, { ...o, body: { shared_members: [{ user_id: guest.userId, role: 'viewer' }, { user_id: member.userId, role: 'manager' }] } });
    check('space access: guest viewer + member manager ok', r.status === 200, r.json);
    const team = await call('POST', '/v1/team', { ...o, body: { user_id: owner.userId, name: `Guest-led ${stamp()}`, team_lead: guest.userId, shared_members: [guest.userId] } });
    const teamId = (Array.isArray(team.data) ? team.data[0] : team.data)?._id;
    check('setup: guest-led team', team.status === 200 && !!teamId, team.json);
    r = await call('PUT', `/v1/space/access?id=${space._id}`, { ...o, body: { shared_teams: [{ team_id: teamId, role: 'manager' }] } });
    check('space access: guest-led team cannot be manager (400)', r.status === 400, r.json);

    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
