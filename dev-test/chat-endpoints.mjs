#!/usr/bin/env node
/**
 * Chat checks (phase 6): conversation room membership, message pagination, threads (reply
 * summary, thread fetch, root broadcasts, reply notifications), edit, soft delete, reactions,
 * pins, search scoping, unread / mention counts and read reset, per-user pinned / muted,
 * bookmarks, topic, member add / remove rules, member roles / titles, typing (sender excluded,
 * throttled), workspace online presence, and space channels following live space access.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   MONGODB_URI=mongodb://127.0.0.1:27999/chattest PORT=3202 node server.js
 *   API_URL=http://127.0.0.1:3202 MONGODB_URI=mongodb://127.0.0.1:27999/chattest node dev-test/chat-endpoints.mjs
 *
 * MONGODB_URI is used directly (legacy message rows, profile titles, notification rows) and must
 * point at the same DB as the server. socket.io-client is imported from the frontend checkout
 * (override with SOCKET_IO_CLIENT=/abs/path/to/socket.io-client).
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { MongoClient, ObjectId } from 'mongodb';

const API = process.env.API_URL || 'http://127.0.0.1:3202';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27999/chattest';
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
        body: { name: `Chat ${label}`, email: `chat-${label}-${stamp()}@example.test`, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    const own = res.data.workspaces.find((w) => w.owner_id === res.data.user_info._id);
    return { token: res.data.token, userId: res.data.user_info._id, email: res.data.user_info.email, name: res.data.user_info.name, ws: own._id };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connect = (auth) => new Promise((resolve) => {
    const socket = ioClient(API, { auth, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 4000 });
    const events = [];
    socket.onAny((event, payload) => events.push({ event, payload, at: Date.now() }));
    const rec = {
        socket,
        events,
        of: (event, pred = () => true) => events.filter((e) => e.event === event && pred(e.payload)).map((e) => e.payload),
        waitFor: async (event, pred = () => true, ms = 3000) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const hit = events.find((e) => e.event === event && pred(e.payload));
                if (hit) return hit.payload;
                await sleep(20);
            }
            return null;
        },
        clear: () => { events.length = 0; },
        close: () => socket.close(),
    };
    socket.on('connect', () => resolve({ ...rec, ok: true }));
    socket.on('connect_error', (err) => resolve({ ...rec, ok: false, error: err.message }));
});
const emitAck = (socket, event, payload) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), 4000);
    if (payload === undefined) socket.emit(event, (res) => { clearTimeout(timer); resolve(res); });
    else socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});

const main = async () => {
    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();

    const owner = await register('owner');
    const admin = await register('admin');
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    const dave = await register('dave');
    const guest = await register('guest');
    const outsider = await register('outsider');
    const WS = owner.ws;
    const as = (u, ws = WS) => ({ token: u.token, ws });

    for (const [u, role] of [[admin, 'admin'], [alice, 'member'], [bob, 'member'], [carol, 'member'], [dave, 'member'], [guest, 'guest']]) {
        const r = await call('POST', '/v1/workspace/member', { ...as(owner), body: { email: u.email, role } });
        check(`setup: add ${role} ${u.name}`, r.status === 200, r.json);
    }
    await db.collection('user').updateOne({ _id: new ObjectId(alice.userId) }, { $set: { title: 'Engineer' } });

    const mkGroup = async (u, name, members) => {
        const r = await call('POST', '/v1/chat/conversation', { ...as(u), body: { type: 'group', name, members } });
        if (r.status !== 200) throw new Error(`group failed: ${JSON.stringify(r.json)}`);
        return r.data;
    };
    const post = (u, conversationId, body, extra = {}) =>
        call('POST', '/v1/chat/message', { ...as(u), body: { conversation_id: conversationId, body, ...extra } });

    const G = await mkGroup(alice, 'General', [bob.userId, carol.userId]);
    check('setup: group G has alice, bob, carol', G.members.length === 3 && G.members.includes(alice.userId), G.members);
    check('conversation: new fields default', G.unread_count === 0 && G.mention_count === 0 && G.pinned === false
        && G.muted === false && Array.isArray(G.bookmarks) && G.bookmarks.length === 0 && G.topic === '' && G.pinned_count === 0
        && G.pinned_by === undefined && G.muted_by === undefined, G);

    // --- 1. Membership ---------------------------------------------------------------------------
    let r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(dave));
    check('membership: non-member GET messages 404', r.status === 404, r.status);
    r = await post(dave, G._id, 'let me in');
    check('membership: non-member POST message 404', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(outsider));
    check('membership: outsider of the workspace 403', r.status === 403, r.status);
    r = await call('GET', `/v1/chat/conversation?id=${G._id}`, as(dave));
    check('membership: non-member GET conversation 404', r.status === 404, r.status);

    const sAlice = await connect({ token: alice.token, workspaceId: WS });
    const sBob = await connect({ token: bob.token, workspaceId: WS });
    const sDave = await connect({ token: dave.token, workspaceId: WS });
    check('sockets: connected', sAlice.ok && sBob.ok && sDave.ok, [sAlice.error, sBob.error, sDave.error]);

    let ack = await emitAck(sDave.socket, 'conversation:join', G._id);
    check('socket join: non-member rejected', ack?.ok === false && ack.error === 'Access denied', ack);
    ack = await emitAck(sDave.socket, 'conversation:join', 'not-an-id');
    check('socket join: invalid id rejected', ack?.ok === false, ack);
    ack = await emitAck(sBob.socket, 'conversation:join', G._id);
    check('socket join: member allowed', ack?.ok === true, ack);
    ack = await emitAck(sAlice.socket, 'conversation:join', { conversation_id: G._id });
    check('socket join: { conversation_id } form allowed', ack?.ok === true, ack);
    sDave.socket.emit('conversation:join', G._id); // no ack: must be ignored too
    await sleep(150);

    r = await post(alice, G._id, 'hello general');
    check('message: member posts', r.status === 200 && r.data.parent_message_id === null && r.data.reply_count === 0
        && Array.isArray(r.data.reactions) && r.data.pinned === false && r.data.edited_at === null && r.data.deleted_at === null
        && r.data.senderInfo?._id === alice.userId, r.data);
    const hello = r.data;
    const bobGot = await sBob.waitFor('chat:message', (p) => p.data?._id === hello._id);
    check('socket: member receives chat:message', !!bobGot, sBob.events.map((e) => e.event));
    await sleep(300);
    check('socket: non-member receives no chat:message', sDave.of('chat:message').length === 0, sDave.of('chat:message'));

    // Legacy rows (no phase-6 fields) are normalised.
    const legacyId = new ObjectId();
    await db.collection('message').insertOne({
        _id: legacyId, conversation_id: G._id, sender_id: bob.userId, body: 'legacy row', content: '', mentions: [],
        attachments: [], entity_refs: [], entity_type: 'message', createdAt: new Date(Date.now() - 3600e3), updatedAt: new Date(),
    });
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(bob));
    const legacy = Array.isArray(r.data) ? r.data.find((m) => m._id === String(legacyId)) : null;
    check('legacy: old array shape and legacy row normalised', r.status === 200 && Array.isArray(r.data) && legacy
        && legacy.parent_message_id === null && legacy.reply_count === 0 && legacy.pinned === false
        && Array.isArray(legacy.reactions) && Array.isArray(legacy.reply_user_ids), r.data);

    // --- 2. Pagination ---------------------------------------------------------------------------
    const P = await mkGroup(alice, 'Pager', [bob.userId]);
    const pmsgs = [];
    for (let i = 1; i <= 7; i += 1) {
        pmsgs.push((await post(alice, P._id, `p${i}`)).data);
        await sleep(3);
    }
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=3&page=1`, as(bob));
    check('pagination: page=1 shape', r.status === 200 && Array.isArray(r.data?.messages) && typeof r.data.has_more === 'boolean', r.data);
    check('pagination: newest page ascending + has_more', r.data.messages.map((m) => m.body).join() === 'p5,p6,p7' && r.data.has_more === true, r.data.messages?.map((m) => m.body));
    let before = r.data.messages[0].createdAt;
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=3&page=1&before=${encodeURIComponent(before)}`, as(bob));
    check('pagination: before ISO', r.data.messages.map((m) => m.body).join() === 'p2,p3,p4' && r.data.has_more === true, r.data);
    before = r.data.messages[0].createdAt;
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=3&page=1&before=${encodeURIComponent(before)}`, as(bob));
    check('pagination: last page has_more=false', r.data.messages.map((m) => m.body).join() === 'p1' && r.data.has_more === false, r.data);
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=3&page=1`, as(bob));
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=7&page=1`, as(bob));
    check('pagination: exact fit has_more=false', r.data.messages.length === 7 && r.data.has_more === false, r.data.has_more);
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=2&before=${pmsgs[4]._id}`, as(bob));
    check('pagination: legacy before=<message id> still works (array)', Array.isArray(r.data) && r.data.map((m) => m.body).join() === 'p3,p4', r.data);
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=0`, as(bob));
    check('pagination: limit 0 -> 400', r.status === 400, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&limit=101`, as(bob));
    check('pagination: limit 101 -> 400', r.status === 400, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${P._id}&before=garbage`, as(bob));
    check('pagination: invalid before -> 400', r.status === 400, r.status);
    r = await call('GET', '/v1/chat/message', as(bob));
    check('pagination: no conversation_id / thread_id -> 400', r.status === 400, r.status);

    // --- 3. Threads ------------------------------------------------------------------------------
    r = await post(alice, G._id, 'thread root');
    const root = r.data;
    sAlice.clear();
    sBob.clear();
    const notifCount = (userId, action) => db.collection('notification').countDocuments({ recipient_id: userId, action, 'metadata.parent_message_id': root._id });

    r = await post(bob, G._id, 'reply 1 by bob', { parent_message_id: root._id });
    const reply1 = r.data;
    check('thread: reply carries parent_message_id', r.status === 200 && reply1.parent_message_id === root._id, r.json);
    let ev = await sAlice.waitFor('chat:message', (p) => p.data?._id === reply1._id);
    check('thread: reply broadcast as chat:message with parent_message_id', ev?.data?.parent_message_id === root._id, ev);
    ev = await sAlice.waitFor('chat:message_updated', (p) => p._id === root._id && p.reply_count === 1);
    check('thread: root update broadcast (reply_count 1)', !!ev && ev.reply_user_ids?.[0] === bob.userId && !!ev.last_reply_at && !!ev.senderInfo, ev);
    check('thread: root author notified (reply)', (await notifCount(alice.userId, 'reply')) === 1, await notifCount(alice.userId, 'reply'));
    check('thread: sender not notified', (await notifCount(bob.userId, 'reply')) === 0);

    r = await post(carol, G._id, 'reply 2 by carol', { parent_message_id: root._id });
    const reply2 = r.data;
    check('thread: root author + earlier participant notified', (await notifCount(alice.userId, 'reply')) === 2
        && (await notifCount(bob.userId, 'reply')) === 1 && (await notifCount(carol.userId, 'reply')) === 0);
    r = await post(bob, G._id, 'reply 3 by bob @alice', { parent_message_id: root._id, mentions: [alice.userId] });
    const reply3 = r.data;
    check('thread: mentioned root author gets mention, not reply', (await notifCount(alice.userId, 'reply')) === 2
        && (await notifCount(alice.userId, 'mention')) === 1 && (await notifCount(carol.userId, 'reply')) === 1, {
        reply: await notifCount(alice.userId, 'reply'), mention: await notifCount(alice.userId, 'mention'), carol: await notifCount(carol.userId, 'reply'),
    });

    r = await call('GET', `/v1/chat/message?thread_id=${root._id}`, as(carol));
    check('thread: fetch { root, replies } ascending', r.status === 200 && r.data.root._id === root._id
        && r.data.replies.map((m) => m.body).join('|') === 'reply 1 by bob|reply 2 by carol|reply 3 by bob @alice', r.data);
    check('thread: root summary', r.data.root.reply_count === 3 && JSON.stringify(r.data.root.reply_user_ids) === JSON.stringify([bob.userId, carol.userId]), r.data.root);
    r = await call('GET', `/v1/chat/message?thread_id=${root._id}`, as(dave));
    check('thread: non-member 404', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/message?thread_id=${reply1._id}`, as(bob));
    check('thread: thread_id of a reply -> 400', r.status === 400, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(bob));
    check('thread: replies not in the top-level list', r.data.every((m) => !m.parent_message_id) && r.data.some((m) => m._id === root._id), r.data.map((m) => m.body));
    r = await post(bob, G._id, 'nested', { parent_message_id: reply1._id });
    check('thread: reply to a reply -> 400', r.status === 400, r.json);
    r = await post(alice, P._id, 'cross', { parent_message_id: root._id });
    check('thread: parent from another conversation -> 400', r.status === 400, r.json);
    r = await call('GET', `/v1/chat/conversation?id=${G._id}`, as(alice));
    check('thread: preview prefixed', r.data.last_message_preview.startsWith('Replied in thread: '), r.data.last_message_preview);

    // Five most recent distinct repliers.
    const T = await mkGroup(alice, 'Many', [bob.userId, carol.userId, dave.userId, admin.userId, guest.userId]);
    const troot = (await post(alice, T._id, 'many root')).data;
    for (const u of [bob, carol, dave, admin, guest, alice, bob]) {
        await post(u, T._id, `r ${u.name}`, { parent_message_id: troot._id });
        await sleep(3);
    }
    r = await call('GET', `/v1/chat/message?thread_id=${troot._id}`, as(alice));
    check('thread: reply_user_ids = 5 most recent distinct, newest first', r.data.root.reply_count === 7
        && JSON.stringify(r.data.root.reply_user_ids) === JSON.stringify([bob.userId, alice.userId, guest.userId, admin.userId, dave.userId]), r.data.root.reply_user_ids);

    // --- 4. Edit ---------------------------------------------------------------------------------
    sBob.clear();
    r = await call('PUT', '/v1/chat/message', { ...as(bob), body: { id: root._id, body: 'hijack' } });
    check('edit: non-sender 403', r.status === 403, r.status);
    r = await call('PUT', '/v1/chat/message', { ...as(dave), body: { id: root._id, body: 'hijack' } });
    check('edit: non-member 404', r.status === 404, r.status);
    r = await call('PUT', '/v1/chat/message', { ...as(alice), body: { id: root._id, body: '   ' } });
    check('edit: empty body 400', r.status === 400, r.status);
    r = await call('PUT', '/v1/chat/message', { ...as(alice), body: { id: root._id } });
    check('edit: nothing to update 400', r.status === 400, r.status);
    r = await call('PUT', '/v1/chat/message', { ...as(alice), body: { id: root._id, body: 'thread root (edited)', mentions: [carol.userId] } });
    check('edit: sender edits, edited_at set, summary kept', r.status === 200 && r.data.body === 'thread root (edited)' && !!r.data.edited_at
        && r.data.reply_count === 3 && r.data.mentions.includes(carol.userId) && r.data.senderInfo?._id === alice.userId, r.data);
    ev = await sBob.waitFor('chat:message_updated', (p) => p._id === root._id && p.body === 'thread root (edited)');
    check('edit: chat:message_updated broadcast with senderInfo', !!ev?.senderInfo && !!ev.edited_at, ev);
    check('edit: newly mentioned user notified', (await db.collection('notification').countDocuments({ recipient_id: carol.userId, action: 'mention', 'metadata.message_id': root._id })) === 1);

    // --- 5. Delete -------------------------------------------------------------------------------
    sAlice.clear();
    r = await call('DELETE', `/v1/chat/message?id=${reply2._id}`, as(bob));
    check('delete: other member 403', r.status === 403, r.status);
    r = await call('DELETE', `/v1/chat/message?id=${reply2._id}`, as(dave));
    check('delete: non-member non-admin 404', r.status === 404, r.status);
    r = await call('DELETE', `/v1/chat/message?id=${reply2._id}`, as(carol));
    check('delete: sender soft-deletes, content blanked', r.status === 200 && !!r.data.deleted_at && r.data.body === ''
        && r.data.content === '' && r.data.attachments.length === 0 && r.data.entity_refs.length === 0, r.data);
    ev = await sAlice.waitFor('chat:message_deleted', (p) => p.message_id === reply2._id);
    check('delete: chat:message_deleted broadcast', ev && ev.conversation_id === G._id && ev.parent_message_id === root._id, ev);
    ev = await sAlice.waitFor('chat:message_updated', (p) => p._id === root._id && p.reply_count === 2);
    check('delete: root reply_count decremented + broadcast', !!ev && JSON.stringify(ev.reply_user_ids) === JSON.stringify([bob.userId]), ev);
    r = await call('GET', `/v1/chat/message?thread_id=${root._id}`, as(bob));
    const ghost = r.data.replies.find((m) => m._id === reply2._id);
    check('delete: deleted reply keeps its place, blanked', r.data.replies.length === 3 && ghost?.deleted_at && ghost.body === '', r.data.replies);
    const raw = await db.collection('message').findOne({ _id: new ObjectId(reply2._id) });
    check('delete: blanked in the database', raw.body === '' && raw.content === '' && raw.deleted_at instanceof Date && raw.deleted_by === carol.userId, raw);
    r = await call('DELETE', `/v1/chat/message?id=${reply2._id}`, as(carol));
    check('delete: twice -> 400', r.status === 400, r.status);
    r = await call('PUT', '/v1/chat/message', { ...as(carol), body: { id: reply2._id, body: 'back' } });
    check('edit: deleted message -> 400', r.status === 400, r.status);

    const bobTop = (await post(bob, G._id, 'bob top-level secret', { entity_refs: [] })).data;
    r = await call('DELETE', `/v1/chat/message?id=${bobTop._id}`, as(admin));
    check('delete: workspace admin (not a member) deletes others', r.status === 200 && !!r.data.deleted_at, r.json);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(alice));
    const bobGhost = r.data.find((m) => m._id === bobTop._id);
    check('delete: deleted top-level message listed blanked', bobGhost && bobGhost.deleted_at && bobGhost.body === '' && bobGhost.mediaAttachments.length === 0, bobGhost);
    r = await call('GET', `/v1/chat/conversation?id=${G._id}`, as(alice));
    check('delete: newest message deleted -> preview updated', r.data.last_message_preview === 'Message deleted', r.data.last_message_preview);

    // --- 6. Reactions ----------------------------------------------------------------------------
    sAlice.clear();
    const react = (u, id, emoji) => call('POST', '/v1/chat/message/reaction', { ...as(u), body: { message_id: id, emoji } });
    r = await react(bob, root._id, '👍');
    check('reaction: add', r.status === 200 && JSON.stringify(r.data.reactions) === JSON.stringify([{ emoji: '👍', user_ids: [bob.userId] }]), r.data);
    ev = await sAlice.waitFor('chat:reaction', (p) => p.message_id === root._id);
    check('reaction: chat:reaction broadcast', ev && ev.conversation_id === G._id && ev.parent_message_id === null && ev.reactions[0].user_ids[0] === bob.userId, ev);
    r = await react(alice, root._id, '👍');
    check('reaction: second user joins group', r.data.reactions[0].user_ids.length === 2, r.data);
    r = await react(bob, root._id, '👍');
    check('reaction: toggle off', JSON.stringify(r.data.reactions) === JSON.stringify([{ emoji: '👍', user_ids: [alice.userId] }]), r.data);
    r = await react(alice, root._id, '👍');
    check('reaction: empty group removed', r.data.reactions.length === 0, r.data);
    r = await react(bob, reply1._id, '🎉');
    ev = await sAlice.waitFor('chat:reaction', (p) => p.message_id === reply1._id);
    check('reaction: on a reply carries parent_message_id', ev?.parent_message_id === root._id, ev);
    for (let i = 0; i < 19; i += 1) await react(bob, reply1._id, `e${i}`);
    r = await react(bob, reply1._id, 'one-too-many');
    check('reaction: 21st distinct emoji -> 400', r.status === 400, r.json);
    r = await react(alice, reply1._id, '🎉');
    check('reaction: existing emoji still toggles at the limit', r.status === 200 && r.data.reactions.length === 20, r.data?.reactions?.length);
    r = await react(bob, reply1._id, 'x'.repeat(17));
    check('reaction: emoji > 16 chars -> 400', r.status === 400, r.status);
    r = await react(bob, reply1._id, '');
    check('reaction: empty emoji -> 400', r.status === 400, r.status);
    r = await react(dave, reply1._id, '👍');
    check('reaction: non-member 404', r.status === 404, r.status);
    r = await react(bob, reply2._id, '👍');
    check('reaction: deleted message -> 400', r.status === 400, r.status);
    r = await call('GET', `/v1/chat/message?thread_id=${root._id}`, as(bob));
    check('reaction: persisted', r.data.replies.find((m) => m._id === reply1._id).reactions.length === 20);

    // --- 7. Pins ---------------------------------------------------------------------------------
    sAlice.clear();
    const pin = (u, id, pinned) => call('POST', '/v1/chat/message/pin', { ...as(u), body: { message_id: id, pinned } });
    r = await pin(bob, root._id, true);
    check('pin: any member pins', r.status === 200 && r.data.pinned === true && r.data.pinned_by === bob.userId && !!r.data.pinned_at, r.data);
    ev = await sAlice.waitFor('chat:message_updated', (p) => p._id === root._id && p.pinned === true);
    check('pin: chat:message_updated broadcast', !!ev, sAlice.events.map((e) => e.event));
    await sleep(5);
    r = await pin(carol, hello._id, true);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}&pinned=true`, as(alice));
    check('pin: pinned list newest pin first', r.status === 200 && r.data.map((m) => m._id).join() === [hello._id, root._id].join(), r.data?.map((m) => m.body));
    r = await call('GET', `/v1/chat/conversation?id=${G._id}`, as(alice));
    check('pin: pinned_count', r.data.pinned_count === 2, r.data.pinned_count);
    r = await pin(alice, hello._id, false);
    check('pin: unpin clears fields', r.data.pinned === false && r.data.pinned_by === null && r.data.pinned_at === null, r.data);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}&pinned=true`, as(alice));
    check('pin: unpinned message leaves the list', r.data.length === 1 && r.data[0]._id === root._id, r.data.map((m) => m.body));
    r = await pin(bob, reply2._id, true);
    check('pin: deleted message -> 400', r.status === 400, r.status);
    r = await pin(dave, root._id, true);
    check('pin: non-member 404', r.status === 404, r.status);
    r = await call('POST', '/v1/chat/message/pin', { ...as(bob), body: { message_id: root._id } });
    check('pin: pinned required', r.status === 400, r.status);

    // --- 8. Search -------------------------------------------------------------------------------
    await post(alice, G._id, 'Banana split for everyone');
    const daveDm = (await call('POST', '/v1/chat/conversation', { ...as(dave), body: { type: 'dm', target_user_id: owner.userId } })).data;
    await post(dave, daveDm._id, 'banana bread recipe');
    const delBanana = (await post(alice, G._id, 'banana to delete')).data;
    await call('DELETE', `/v1/chat/message?id=${delBanana._id}`, as(alice));
    r = await call('GET', '/v1/chat/message/search?q=BANANA', as(alice));
    check('search: case-insensitive, only own conversations, deleted excluded', r.status === 200 && r.data.length === 1
        && r.data[0].body === 'Banana split for everyone', r.data?.map((m) => m.body));
    check('search: result fields', r.data[0].conversation_id === G._id && r.data[0].conversation_name === 'General'
        && r.data[0].senderInfo?._id === alice.userId && r.data[0].conversation_type === 'group', r.data[0]);
    r = await call('GET', '/v1/chat/message/search?q=banana', as(dave));
    check('search: other user sees only theirs + DM display name', r.data.length === 1 && r.data[0].body === 'banana bread recipe'
        && r.data[0].conversation_name === owner.name, r.data);
    r = await call('GET', `/v1/chat/message/search?q=banana&conversation_id=${G._id}`, as(dave));
    check('search: conversation filter of a non-member 404', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/message/search?q=reply&conversation_id=${G._id}`, as(bob));
    check('search: scoped to conversation, includes replies', r.status === 200 && r.data.length === 2 && r.data.every((m) => m.conversation_id === G._id), r.data?.map((m) => m.body));
    r = await call('GET', '/v1/chat/message/search?q=(.*', as(alice));
    check('search: regex characters are literal', r.status === 200 && r.data.length === 0, r.data);
    r = await call('GET', '/v1/chat/message/search?q=', as(alice));
    check('search: empty q -> 400', r.status === 400, r.status);

    // --- 9. Unread / mentions / read -------------------------------------------------------------
    const U = await mkGroup(alice, 'Unread', [bob.userId]);
    const sBob2 = await connect({ token: bob.token, workspaceId: WS });
    await post(alice, U._id, 'u1');
    await post(alice, U._id, 'u2 @bob', { mentions: [bob.userId] });
    const u3 = (await post(alice, U._id, 'u3')).data;
    await post(alice, U._id, 'u3 thread reply', { parent_message_id: u3._id });
    await post(alice, U._id, 'reply mentioning bob', { parent_message_id: u3._id, mentions: [bob.userId] });
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(bob));
    check('unread: top-level only, mentions incl. thread replies', r.data.unread_count === 3 && r.data.mention_count === 2, { u: r.data.unread_count, m: r.data.mention_count });
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(alice));
    check('unread: own messages not counted', r.data.unread_count === 0 && r.data.mention_count === 0, { u: r.data.unread_count, m: r.data.mention_count });
    r = await call('GET', '/v1/chat/conversation', as(bob));
    const listU = r.data.find((c) => c._id === U._id);
    check('unread: list carries counts', listU?.unread_count === 3 && listU.mention_count === 2, listU);
    sAlice.clear();
    r = await call('POST', '/v1/chat/conversation/read', { ...as(bob), body: { conversation_id: U._id } });
    check('read: marks read', r.status === 200 && !!r.data.last_read_at, r.json);
    ev = await sBob2.waitFor('chat:read', (p) => p.conversation_id === U._id);
    check('read: chat:read to the user\'s other tabs', !!ev, sBob2.events.map((e) => e.event));
    await sleep(200);
    check('read: chat:read not sent to others', sAlice.of('chat:read').length === 0);
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(bob));
    check('read: counts reset', r.data.unread_count === 0 && r.data.mention_count === 0 && !!r.data.read_state?.[bob.userId], r.data);
    await sleep(5);
    const u4 = (await post(alice, U._id, 'u4')).data;
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(bob));
    check('unread: new message counted after read', r.data.unread_count === 1, r.data.unread_count);
    await call('DELETE', `/v1/chat/message?id=${u4._id}`, as(alice));
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(bob));
    check('unread: deleted message not counted', r.data.unread_count === 0, r.data.unread_count);
    r = await call('POST', '/v1/chat/conversation/read', { ...as(dave), body: { conversation_id: U._id } });
    check('read: non-member 404', r.status === 404, r.status);
    await post(bob, U._id, 'bob writes');
    await post(alice, U._id, 'alice answers');
    r = await call('GET', `/v1/chat/conversation?id=${U._id}`, as(bob));
    check('unread: sending marks read for the sender', r.data.unread_count === 1, r.data.unread_count);

    // --- 10. Per-user pinned / muted -------------------------------------------------------------
    sAlice.clear();
    sBob2.clear();
    const putConv = (u, body) => call('PUT', '/v1/chat/conversation', { ...as(u), body });
    r = await putConv(bob, { id: P._id, pinned: true, muted: true });
    check('pin conv: per-user flags', r.status === 200 && r.data.pinned === true && r.data.muted === true, r.data);
    ev = await sBob2.waitFor('chat:conversation_updated', (p) => p.conversation_id === P._id);
    check('pin conv: chat:conversation_updated to own user room', !!ev && ev.changes.includes('pinned'), ev);
    await sleep(200);
    check('pin conv: others not notified', sAlice.of('chat:conversation_updated').length === 0, sAlice.of('chat:conversation_updated'));
    r = await call('GET', '/v1/chat/conversation', as(bob));
    check('pin conv: pinned first in the list', r.data[0]._id === P._id && r.data[0].pinned === true, r.data.map((c) => c.name));
    r = await call('GET', `/v1/chat/conversation?id=${P._id}`, as(alice));
    check('pin conv: not pinned / muted for others', r.data.pinned === false && r.data.muted === false, r.data);
    r = await putConv(bob, { id: P._id, pinned: false });
    check('pin conv: unpin keeps muted', r.data.pinned === false && r.data.muted === true, r.data);
    r = await putConv(bob, { id: P._id, pinned: 'yes' });
    check('pin conv: non-boolean 400', r.status === 400, r.status);

    // --- 11. Bookmarks + topic -------------------------------------------------------------------
    sAlice.clear();
    r = await putConv(bob, { id: G._id, topic: 'Q3 launch', bookmarks: [{ title: 'Spec', url: 'https://example.test/spec' }, { title: 'Board', url: '/board/1', entity_type: 'board', entity_id: 'abc' }] });
    check('bookmarks: any member sets bookmarks + topic', r.status === 200 && r.data.topic === 'Q3 launch' && r.data.bookmarks.length === 2
        && !!r.data.bookmarks[0].id && r.data.bookmarks[0].added_by === bob.userId && !!r.data.bookmarks[0].added_at
        && r.data.bookmarks[1].entity_type === 'board' && r.data.bookmarks[0].entity_type === null, r.data);
    ev = await sAlice.waitFor('chat:conversation_updated', (p) => p.conversation_id === G._id);
    check('bookmarks: chat:conversation_updated to members', !!ev && ev.changes.includes('bookmarks') && ev.changes.includes('topic'), ev);
    const keep = r.data.bookmarks[0];
    r = await putConv(alice, { id: G._id, bookmarks: [{ id: keep.id, title: 'Spec v2', url: keep.url }, { title: 'New', url: '/x' }] });
    check('bookmarks: existing id keeps added_by / added_at', r.data.bookmarks[0].title === 'Spec v2' && r.data.bookmarks[0].added_by === bob.userId
        && r.data.bookmarks[0].added_at === keep.added_at && r.data.bookmarks[1].added_by === alice.userId, r.data.bookmarks);
    r = await putConv(alice, { id: G._id, bookmarks: Array.from({ length: 21 }, (_, i) => ({ title: `b${i}`, url: `/b${i}` })) });
    check('bookmarks: more than 20 -> 400', r.status === 400, r.status);
    r = await putConv(alice, { id: G._id, bookmarks: [{ title: 'no url' }] });
    check('bookmarks: missing url -> 400', r.status === 400, r.status);
    r = await putConv(alice, { id: G._id, bookmarks: [{ id: 'a', title: 'x', url: '/x' }, { id: 'a', title: 'y', url: '/y' }] });
    check('bookmarks: duplicate ids -> 400', r.status === 400, r.status);
    r = await putConv(dave, { id: G._id, topic: 'nope' });
    check('topic: non-member 404', r.status === 404, r.status);
    r = await putConv(alice, { id: G._id, topic: 'x'.repeat(251) });
    check('topic: > 250 -> 400', r.status === 400, r.status);

    // --- 12. Members / name / roles --------------------------------------------------------------
    r = await putConv(bob, { id: G._id, name: 'Renamed' });
    check('rename: non-creator member 403', r.status === 403, r.status);
    r = await putConv(alice, { id: G._id, name: 'General 2', description: 'desc' });
    check('rename: creator renames', r.status === 200 && r.data.name === 'General 2' && r.data.description === 'desc', r.data);
    r = await putConv(bob, { id: G._id, add_members: [dave.userId] });
    check('members: non-creator member 403', r.status === 403, r.status);
    const sCarol = await connect({ token: carol.token, workspaceId: WS });
    await emitAck(sCarol.socket, 'conversation:join', G._id);
    sCarol.clear();
    r = await putConv(alice, { id: G._id, add_members: [dave.userId], remove_members: [carol.userId] });
    check('members: creator adds + removes', r.status === 200 && r.data.members.includes(dave.userId) && !r.data.members.includes(carol.userId), r.data?.members);
    ev = await sCarol.waitFor('chat:conversation_updated', (p) => p.conversation_id === G._id);
    check('members: removed member told', !!ev && ev.changes.includes('members'), ev);
    sCarol.clear();
    await post(alice, G._id, 'after carol left');
    await sleep(300);
    check('members: removed member gets no more chat:message (left the room)', sCarol.of('chat:message').length === 0, sCarol.of('chat:message'));
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(carol));
    check('members: removed member cannot read', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${G._id}`, as(dave));
    check('members: added member can read', r.status === 200, r.status);
    r = await putConv(alice, { id: G._id, add_members: [outsider.userId] });
    check('members: non-workspace user -> 400', r.status === 400, r.status);
    const DM = (await call('POST', '/v1/chat/conversation', { ...as(alice), body: { type: 'dm', target_user_id: bob.userId } })).data;
    r = await putConv(alice, { id: DM._id, add_members: [carol.userId] });
    check('members: DM -> 400', r.status === 400, r.status);
    r = await putConv(alice, { id: DM._id, name: 'x' });
    check('rename: DM -> 400', r.status === 400, r.status);
    r = await putConv(alice, { id: DM._id, topic: 'dm topic', pinned: true });
    check('DM: topic + pinned allowed', r.status === 200 && r.data.topic === 'dm topic' && r.data.pinned === true, r.data);
    const spaceRes = await call('POST', '/v1/space', { ...as(owner), body: { user_id: owner.userId, name: 'Chat Space', is_private: false } });
    const space = Array.isArray(spaceRes.data) ? spaceRes.data[0] : spaceRes.data;
    const CH = (await call('POST', '/v1/chat/conversation', { ...as(owner), body: { type: 'channel', space_id: space._id } })).data;
    r = await putConv(owner, { id: CH._id, add_members: [alice.userId] });
    check('members: channel -> 400', r.status === 400, r.json);
    r = await putConv(alice, { id: G._id, remove_members: [alice.userId, bob.userId, dave.userId] });
    check('members: cannot remove everyone', r.status === 400, r.status);

    // Workspace admin (member of the group, not creator) may manage it.
    const R = await mkGroup(owner, 'Roles', [admin.userId, alice.userId, guest.userId]);
    r = await putConv(admin, { id: R._id, name: 'Roles (admin)', remove_members: [guest.userId] });
    check('members: workspace admin manages a group they did not create', r.status === 200 && r.data.name === 'Roles (admin)' && !r.data.members.includes(guest.userId), r.json);
    r = await putConv(admin, { id: R._id, add_members: [guest.userId] });
    const roles = Object.fromEntries((r.data.memberDetails || []).map((m) => [m._id, [m.role, m.title]]));
    check('memberDetails: role + title', JSON.stringify(roles[owner.userId]) === JSON.stringify(['owner', null])
        && JSON.stringify(roles[admin.userId]) === JSON.stringify(['admin', null])
        && JSON.stringify(roles[alice.userId]) === JSON.stringify(['member', 'Engineer'])
        && JSON.stringify(roles[guest.userId]) === JSON.stringify(['guest', null]), roles);
    check('memberDetails: no password, existing fields kept', (r.data.memberDetails || []).every((m) => m.password === undefined && 'avatarUrl' in m && m.email), r.data.memberDetails?.[0]);

    // --- 13. Typing ------------------------------------------------------------------------------
    const sAlice2 = await connect({ token: alice.token, workspaceId: WS });
    await emitAck(sAlice2.socket, 'conversation:join', G._id);
    await emitAck(sDave.socket, 'conversation:join', G._id); // dave is a member now
    sBob.clear(); sAlice2.clear(); sDave.clear();
    ack = await emitAck(sAlice.socket, 'chat:typing', { conversation_id: G._id, typing: true });
    check('typing: ack ok', ack?.ok === true, ack);
    ev = await sBob.waitFor('chat:typing', (p) => p.user_id === alice.userId);
    check('typing: broadcast to the room', ev && ev.typing === true && ev.thread_id === null && ev.conversation_id === G._id && ev.name === alice.name, ev);
    ack = await emitAck(sAlice.socket, 'chat:typing', { conversation_id: G._id, typing: true });
    check('typing: second typing:true within 1.5s throttled', ack?.throttled === true, ack);
    await sleep(250);
    check('typing: sender (all tabs) excluded', sAlice2.of('chat:typing').length === 0 && sAlice.of('chat:typing').length === 0, sAlice2.of('chat:typing'));
    check('typing: only one typing:true delivered', sBob.of('chat:typing', (p) => p.typing).length === 1, sBob.of('chat:typing'));
    await emitAck(sAlice.socket, 'chat:typing', { conversation_id: G._id, typing: false });
    ev = await sBob.waitFor('chat:typing', (p) => p.typing === false);
    check('typing: typing:false always forwarded', !!ev, sBob.of('chat:typing'));
    await sleep(1550);
    await emitAck(sAlice.socket, 'chat:typing', { conversation_id: G._id, thread_id: root._id, typing: true });
    ev = await sBob.waitFor('chat:typing', (p) => p.typing && p.thread_id === root._id);
    check('typing: after 1.5s forwarded again, thread_id passed', !!ev && sBob.of('chat:typing', (p) => p.typing).length === 2, sBob.of('chat:typing'));
    sBob.clear();
    ack = await emitAck(sCarol.socket, 'chat:typing', { conversation_id: G._id, typing: true });
    await sleep(250);
    check('typing: non-member rejected, nothing broadcast', ack?.ok === false && sBob.of('chat:typing').length === 0, ack);
    ack = await emitAck(sAlice.socket, 'chat:typing', { conversation_id: 'nope', typing: true });
    check('typing: invalid conversation_id', ack?.ok === false, ack);

    // --- 14. Presence ----------------------------------------------------------------------------
    let list = await emitAck(sAlice.socket, 'chat:presence:list');
    check('presence: list includes connected users', Array.isArray(list?.online) && [alice, bob, dave, carol].every((u) => list.online.includes(u.userId))
        && !list.online.includes(guest.userId), list);
    sAlice.clear();
    const g1 = await connect({ token: guest.token, workspaceId: WS });
    ev = await sAlice.waitFor('chat:presence', (p) => p.user_id === guest.userId);
    check('presence: online broadcast to the workspace', ev?.online === true, ev);
    const g2 = await connect({ token: guest.token, workspaceId: WS });
    await sleep(250);
    check('presence: second socket does not re-announce', sAlice.of('chat:presence', (p) => p.user_id === guest.userId).length === 1);
    list = await emitAck(sBob.socket, 'chat:presence:list');
    check('presence: list has the new user', list.online.includes(guest.userId), list);
    g1.close();
    await sleep(300);
    check('presence: still online with one socket left', sAlice.of('chat:presence', (p) => p.user_id === guest.userId && !p.online).length === 0);
    list = await emitAck(sBob.socket, 'chat:presence:list');
    check('presence: still listed', list.online.includes(guest.userId), list);
    g2.close();
    ev = await sAlice.waitFor('chat:presence', (p) => p.user_id === guest.userId && p.online === false);
    check('presence: offline after the last socket', !!ev, sAlice.of('chat:presence'));
    list = await emitAck(sBob.socket, 'chat:presence:list');
    check('presence: removed from list', !list.online.includes(guest.userId), list);
    const sOut = await connect({ token: outsider.token, workspaceId: WS });
    list = await emitAck(sOut.socket, 'chat:presence:list');
    check('presence: socket outside the workspace gets an empty list and is not listed', list.online.length === 0
        && !(await emitAck(sBob.socket, 'chat:presence:list')).online.includes(outsider.userId), list);
    const sOther = await connect({ token: outsider.token, workspaceId: outsider.ws });
    list = await emitAck(sOther.socket, 'chat:presence:list');
    check('presence: lists are per workspace', list.online.length === 1 && list.online[0] === outsider.userId, list);

    // --- 15. Space channels follow live space access ---------------------------------------
    const mkSpace = async (u, name, isPrivate) => {
        const res = await call('POST', '/v1/space', { ...as(u), body: { user_id: u.userId, name, is_private: isPrivate } });
        const sp = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!sp?._id) throw new Error(`space failed: ${JSON.stringify(res.json)}`);
        return sp;
    };
    const pubSpace = await mkSpace(alice, 'Open Chat Space', false);
    r = await call('POST', '/v1/chat/conversation', { ...as(alice), body: { type: 'channel', space_id: pubSpace._id } });
    const PC = r.data;
    check('channel: public space channel has every active workspace member', r.status === 200
        && [owner, admin, alice, bob, carol, dave, guest].every((u) => PC.members.includes(u.userId)) && !PC.members.includes(outsider.userId), PC?.members);
    const late = await register('late');
    r = await call('POST', '/v1/workspace/member', { ...as(owner), body: { email: late.email, role: 'member' } });
    check('channel: setup late member joins the workspace', r.status === 200, r.json);
    r = await call('GET', '/v1/chat/conversation', as(late));
    check('channel: late member sees the public channel in the list', r.status === 200 && r.data.some((c) => c._id === PC._id), r.data?.map((c) => c.name));
    r = await call('GET', `/v1/chat/message?conversation_id=${PC._id}`, as(late));
    check('channel: late member can read', r.status === 200, r.status);
    const sLate = await connect({ token: late.token, workspaceId: WS });
    ack = await emitAck(sLate.socket, 'conversation:join', PC._id);
    check('channel: late member can join the room', ack?.ok === true, ack);
    r = await post(late, PC._id, 'hi from late');
    check('channel: late member can post', r.status === 200, r.json);
    r = await react(late, r.data._id, '👋');
    check('channel: late member can react', r.status === 200, r.json);
    sLate.clear();
    const pcMsg = (await post(alice, PC._id, 'welcome late')).data;
    ev = await sLate.waitFor('chat:message', (p) => p.data?._id === pcMsg._id);
    check('channel: late member receives chat:message', !!ev);
    r = await call('GET', `/v1/chat/conversation?id=${PC._id}`, as(alice));
    check('channel: memberDetails include the late member', r.data.memberDetails.some((m) => m._id === late.userId) && r.data.members.includes(late.userId), r.data?.members);

    const privSpace = await mkSpace(owner, 'Private Chat Space', true);
    const setShared = (ids) => call('PUT', `/v1/space/access?id=${privSpace._id}`, { ...as(owner), body: { shared_members: ids.map((id) => ({ user_id: id, role: 'contributor' })) } });
    r = await setShared([alice.userId]);
    check('channel: setup private space shared with alice', r.status === 200, r.json);
    r = await call('POST', '/v1/chat/conversation', { ...as(carol), body: { type: 'channel', space_id: privSpace._id } });
    check('channel: non-shared member cannot create the private channel', r.status === 404, r.status);
    r = await call('POST', '/v1/chat/conversation', { ...as(owner), body: { type: 'channel', space_id: privSpace._id } });
    const PRC = r.data;
    check('channel: private channel members = owner + shared', r.status === 200 && PRC.members.length === 2
        && PRC.members.includes(owner.userId) && PRC.members.includes(alice.userId), PRC?.members);
    r = await call('POST', '/v1/chat/conversation', { ...as(carol), body: { type: 'channel', space_id: privSpace._id } });
    check('channel: existing private channel not returned to a non-shared member', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/conversation?id=${PRC._id}`, as(carol));
    check('channel: non-shared member GET ?id 404', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/message?conversation_id=${PRC._id}`, as(carol));
    check('channel: non-shared member GET messages 404', r.status === 404, r.status);
    r = await post(carol, PRC._id, 'sneak');
    check('channel: non-shared member POST 404', r.status === 404, r.status);
    r = await call('GET', '/v1/chat/conversation', as(carol));
    check('channel: private channel not in the non-shared member list', !r.data.some((c) => c._id === PRC._id));
    const sCarol2 = await connect({ token: carol.token, workspaceId: WS });
    ack = await emitAck(sCarol2.socket, 'conversation:join', PRC._id);
    check('channel: non-shared member cannot join the room', ack?.ok === false, ack);
    ack = await emitAck(sCarol2.socket, 'chat:typing', { conversation_id: PRC._id, typing: true });
    check('channel: non-shared member cannot type', ack?.ok === false, ack);
    sCarol2.clear();
    await post(alice, PRC._id, 'private 1');
    await sleep(300);
    check('channel: non-shared member gets no chat:message', sCarol2.of('chat:message').length === 0, sCarol2.of('chat:message'));

    r = await setShared([alice.userId, carol.userId]);
    r = await call('GET', `/v1/chat/conversation?id=${PRC._id}`, as(carol));
    check('channel: sharing the space grants access', r.status === 200 && r.data.members.includes(carol.userId), r.status);
    ack = await emitAck(sCarol2.socket, 'conversation:join', PRC._id);
    check('channel: newly shared member joins the room', ack?.ok === true, ack);
    sCarol2.clear();
    const priv2 = (await post(alice, PRC._id, 'private 2')).data;
    ev = await sCarol2.waitFor('chat:message', (p) => p.data?._id === priv2._id);
    check('channel: newly shared member receives chat:message', !!ev);
    r = await call('GET', `/v1/chat/conversation?id=${PRC._id}`, as(carol));
    check('channel: newly shared member has an unread count', r.data.unread_count >= 1, r.data.unread_count);

    r = await setShared([alice.userId]);
    sCarol2.clear();
    await post(alice, PRC._id, 'private 3');
    await sleep(300);
    check('channel: revoked member gets no more chat:message', sCarol2.of('chat:message').length === 0, sCarol2.of('chat:message'));
    r = await call('GET', `/v1/chat/message?conversation_id=${PRC._id}`, as(carol));
    check('channel: revoked member GET messages 404', r.status === 404, r.status);
    r = await call('GET', `/v1/chat/conversation?id=${PRC._id}`, as(alice));
    check('channel: revoked member dropped from members / memberDetails', !r.data.members.includes(carol.userId)
        && !r.data.memberDetails.some((m) => m._id === carol.userId), r.data.members);
    r = await call('GET', '/v1/chat/message/search?q=private', as(carol));
    check('channel: revoked member cannot search it', r.status === 200 && r.data.length === 0, r.data?.length);

    for (const s of [sAlice, sAlice2, sBob, sBob2, sCarol, sCarol2, sDave, sOut, sOther, sLate]) s.close();
    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
