/**
 * WebSocket Service for Real-time Notifications
 * Handles Socket.io connections and notification broadcasting
 */

import { Server as SocketIOServer } from 'socket.io';
import { socketCorsOrigin } from './corsOrigins.js';
import jwt from 'jsonwebtoken';
import { touchLastSeen, isWorkspaceMember, isMemberSuspended } from './workspaceAccess.js';
import { loadEntity, isEntityAccessible } from './entities.js';
import { canUserJoinConversation } from '../chat/utils/chatHelper.js';

let io = null;
const userConnections = new Map(); // Map of userId -> Set of socketIds

/**
 * Initialize Socket.io server
 * @param {http.Server} httpServer - The HTTP server instance
 * @param {Object} options - Socket.io options
 * @returns {SocketIOServer} Socket.io server instance
 */
export function initializeWebSocket(httpServer, options = {}) {
    io = new SocketIOServer(httpServer, {
        cors: {
            origin: socketCorsOrigin,
            credentials: true
        },
        ...options
    });

    // Authenticate every connection: valid JWT + a live Auth row (same as GET /v1/auth).
    // The user id comes from the token, never from handshake.auth.userId.
    io.use(async (socket, next) => {
        try {
            const user = await authenticateSocketToken(socket.handshake.auth?.token);
            if (!user) return next(new Error('unauthorized'));

            socket.userId = String(user._id);
            socket.user = { _id: String(user._id), name: user.name || '', avatar: user.avatar || '' };
            socket.token = socket.handshake.auth.token;

            // Only join the workspace room when the user is an active member of it.
            const requestedWorkspaceId = socket.handshake.auth?.workspaceId;
            socket.workspaceId = null;
            if (requestedWorkspaceId && OBJECT_ID_RE.test(String(requestedWorkspaceId))) {
                const workspace = await global.Workspace.findOne({ _id: String(requestedWorkspaceId) });
                if (workspace && isWorkspaceMember(workspace, socket.userId) && !isMemberSuspended(workspace, socket.userId)) {
                    socket.workspaceId = String(requestedWorkspaceId);
                }
            }
            next();
        } catch (err) {
            console.error('Socket authentication failed:', err.message);
            next(new Error('unauthorized'));
        }
    });

    // Handle connections
    io.on('connection', (socket) => {
        const userId = socket.userId;
        const workspaceId = socket.workspaceId;

        console.log(`User ${userId} connected with socket ${socket.id}`);
        touchLastSeen(userId);

        // Track user connection
        if (!userConnections.has(userId)) {
            userConnections.set(userId, new Set());
        }
        userConnections.get(userId).add(socket.id);

        // Join user-specific room for targeted notifications
        socket.join(`user:${userId}`);
        // Join workspace room for workspace-wide broadcasts (verified members only)
        if (workspaceId) {
            socket.join(`workspace:${workspaceId}`);
            markOnline(workspaceId, userId);
        }

        // Emit connection success
        socket.emit('connected', {
            socketId: socket.id,
            userId: userId,
            workspaceId: workspaceId
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`User ${userId} disconnected with socket ${socket.id}`);

            const userSockets = userConnections.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    userConnections.delete(userId);
                }
            }

            leaveAllPresence(socket);
            if (workspaceId) markOffline(workspaceId, userId);
        });

        // Handle ping/pong for keep-alive
        socket.on('ping', () => {
            socket.emit('pong');
        });

        // Join conversation room for real-time chat
        // Only members of the conversation (and active members of its workspace) may join its room.
        socket.on('conversation:join', (conversationId, ack) => handleConversationJoin(socket, conversationId, ack));

        socket.on('chat:typing', (payload, ack) => handleChatTyping(socket, payload, ack));
        socket.on('chat:presence:list', (payload, ack) => {
            const callback = typeof payload === 'function' ? payload : ack;
            reply(callback, { online: socket.workspaceId ? getOnlineUserIds(socket.workspaceId) : [] });
        });

        socket.on('conversation:leave', (conversationId) => {
            if (conversationId) {
                socket.leave(`conversation:${conversationId}`);
            }
        });

        // --- Presence -----------------------------------------------------------------------
        socket.on('presence:join', (payload, ack) => handlePresenceJoin(socket, payload, ack));
        socket.on('presence:leave', (payload, ack) => handlePresenceLeave(socket, payload, ack));
        socket.on('presence:editing', (payload, ack) => handlePresenceEditing(socket, payload, ack));
    });

    return io;
}

// --- Authentication ---------------------------------------------------------------------------

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** Returns the user for a valid, unexpired token that has an Auth row; otherwise null. */
async function authenticateSocketToken(token) {
    if (!token || typeof token !== 'string') return null;
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
    if (!decoded?.id) return null;
    const authRows = await global.Auth.find({ token, user_id: decoded.id }).limit(1);
    const authRow = authRows?.[0];
    if (!authRow || new Date(authRow.expires_at) <= new Date()) return null;
    if (!OBJECT_ID_RE.test(String(decoded.id))) return null;
    return (await global.User.findOne({ _id: String(decoded.id) })) || null;
}

// --- Conversation rooms -----------------------------------------------------------------------

/** conversation:join (conversationId | { conversation_id }, ack?) → ack({ ok } | { ok:false, error }). */
async function handleConversationJoin(socket, payload, ack) {
    try {
        const conversationId = String((payload && typeof payload === 'object' ? payload.conversation_id : payload) || '');
        if (!OBJECT_ID_RE.test(conversationId)) return reply(ack, { ok: false, error: 'Invalid conversation_id' });
        const conversation = await canUserJoinConversation(conversationId, socket.userId);
        if (!conversation) return reply(ack, { ok: false, error: 'Access denied' });
        if (!socket.connected) return reply(ack, { ok: false, error: 'Disconnected' });
        socket.join(`conversation:${conversationId}`);
        reply(ack, { ok: true });
    } catch (err) {
        console.error('conversation:join failed:', err.message);
        reply(ack, { ok: false, error: 'Join failed' });
    }
}

// --- Chat typing ------------------------------------------------------------------------------
//
// Client → server  chat:typing { conversation_id, thread_id?: string|null, typing: boolean }  ack?({ ok } | { ok:false, error })
// Server → room `conversation:<id>` (all sockets of the sender excluded)
//   chat:typing { conversation_id, thread_id, user_id, name, typing }
// typing:true is forwarded at most once per TYPING_THROTTLE_MS per user + conversation; typing:false always.

const TYPING_THROTTLE_MS = 1500;
const typingLast = new Map(); // `${userId}:${conversationId}` -> ms of the last forwarded typing:true

async function handleChatTyping(socket, payload, ack) {
    try {
        const conversationId = String(payload?.conversation_id || '');
        if (!OBJECT_ID_RE.test(conversationId)) return reply(ack, { ok: false, error: 'Invalid conversation_id' });
        const threadId = payload?.thread_id ? String(payload.thread_id) : null;
        if (threadId && !OBJECT_ID_RE.test(threadId)) return reply(ack, { ok: false, error: 'Invalid thread_id' });
        const typing = payload?.typing === true;
        const key = `${socket.userId}:${conversationId}`;
        const now = Date.now();
        if (typing && now - (typingLast.get(key) || 0) < TYPING_THROTTLE_MS) return reply(ack, { ok: true, throttled: true });

        // A socket that joined the room was checked then (removed members are taken out of it).
        const room = `conversation:${conversationId}`;
        if (!socket.rooms.has(room) && !(await canUserJoinConversation(conversationId, socket.userId))) {
            return reply(ack, { ok: false, error: 'Access denied' });
        }
        if (typing) {
            typingLast.set(key, now);
            if (typingLast.size > 50000) typingLast.clear();
        }
        io.to(room).except(`user:${socket.userId}`).emit('chat:typing', {
            conversation_id: conversationId,
            thread_id: threadId,
            user_id: socket.userId,
            name: socket.user?.name || '',
            typing,
        });
        reply(ack, { ok: true });
    } catch (err) {
        console.error('chat:typing failed:', err.message);
        reply(ack, { ok: false, error: 'Typing failed' });
    }
}

// --- Chat online presence -----------------------------------------------------------------------
//
// A user is online in a workspace while at least one of their sockets connected with that workspace.
// Server → room `workspace:<id>`  chat:presence { user_id, online, workspace_id }
// Client → server  chat:presence:list (ack) → { online: [userIds] } for the socket's workspace.

const workspaceOnline = new Map(); // workspaceId -> Map<userId, socket count>

function markOnline(workspaceId, userId) {
    if (!workspaceOnline.has(workspaceId)) workspaceOnline.set(workspaceId, new Map());
    const users = workspaceOnline.get(workspaceId);
    const count = (users.get(userId) || 0) + 1;
    users.set(userId, count);
    if (count === 1) io?.to(`workspace:${workspaceId}`).emit('chat:presence', { user_id: userId, online: true, workspace_id: workspaceId });
}

function markOffline(workspaceId, userId) {
    const users = workspaceOnline.get(workspaceId);
    if (!users || !users.has(userId)) return;
    const count = users.get(userId) - 1;
    if (count > 0) {
        users.set(userId, count);
        return;
    }
    users.delete(userId);
    if (users.size === 0) workspaceOnline.delete(workspaceId);
    io?.to(`workspace:${workspaceId}`).emit('chat:presence', { user_id: userId, online: false, workspace_id: workspaceId });
}

/** User ids with at least one socket connected to the workspace. */
export function getOnlineUserIds(workspaceId) {
    return [...(workspaceOnline.get(String(workspaceId))?.keys() || [])];
}

// --- Presence ---------------------------------------------------------------------------------
//
// Client → server
//   presence:join    { entity_type: 'page'|'board'|'folder'|'space', entity_id }  ack({ ok, users } | { ok:false, error })
//   presence:leave   { entity_type, entity_id }                                    ack({ ok })
//   presence:editing { entity_type, entity_id, editing: boolean }                  ack({ ok } | { ok:false, error })
// Server → room `presence:<type>:<id>`
//   presence:update  { entity_type, entity_id, users: [{ user_id, name, avatar, editing, since }] }
//   (one entry per user, editing = any of their sockets editing, sorted by since)

const PRESENCE_TYPES = ['page', 'board', 'folder', 'space'];
const EDITING_THROTTLE_MS = 500;
const presenceRooms = new Map();   // room -> Map<socketId, { user_id, name, avatar, editing, since }>
const socketPresence = new Map();  // socketId -> Set<room>
const roomThrottle = new Map();    // room -> { last: ms, timer }

const presenceRoom = (type, id) => `presence:${type}:${id}`;

const parsePresenceTarget = (payload) => {
    const entityType = payload?.entity_type;
    const entityId = payload?.entity_id ? String(payload.entity_id) : '';
    if (!PRESENCE_TYPES.includes(entityType)) return { error: 'Invalid entity_type' };
    if (!OBJECT_ID_RE.test(entityId)) return { error: 'Invalid entity_id' };
    return { entityType, entityId, room: presenceRoom(entityType, entityId) };
};

const reply = (ack, body) => {
    if (typeof ack === 'function') {
        try { ack(body); } catch { /* client gone */ }
    }
};

/** De-duplicated presence list for a room. */
export function getPresenceUsers(room) {
    const entries = presenceRooms.get(room);
    if (!entries) return [];
    const byUser = new Map();
    for (const entry of entries.values()) {
        const existing = byUser.get(entry.user_id);
        if (!existing) {
            byUser.set(entry.user_id, { ...entry });
        } else {
            existing.editing = existing.editing || entry.editing;
            if (entry.since < existing.since) existing.since = entry.since;
        }
    }
    return [...byUser.values()].sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}

const emitPresence = (room) => {
    if (!io) return;
    const [, entityType, entityId] = room.split(':');
    io.to(room).emit('presence:update', { entity_type: entityType, entity_id: entityId, users: getPresenceUsers(room) });
};

/** Broadcast now (join/leave) or throttled to one per EDITING_THROTTLE_MS per room (editing). */
const broadcastPresence = (room, { throttle = false } = {}) => {
    const state = roomThrottle.get(room) || { last: 0, timer: null };
    roomThrottle.set(room, state);
    const now = Date.now();
    if (throttle && now - state.last < EDITING_THROTTLE_MS) {
        if (!state.timer) {
            state.timer = setTimeout(() => {
                state.timer = null;
                state.last = Date.now();
                emitPresence(room);
                if (!presenceRooms.has(room)) roomThrottle.delete(room);
            }, EDITING_THROTTLE_MS - (now - state.last));
        }
        return;
    }
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    state.last = now;
    emitPresence(room);
    if (!presenceRooms.has(room)) roomThrottle.delete(room);
};

const removeFromRoom = (socket, room) => {
    const entries = presenceRooms.get(room);
    if (!entries || !entries.delete(socket.id)) return false;
    if (entries.size === 0) presenceRooms.delete(room);
    socketPresence.get(socket.id)?.delete(room);
    socket.leave(room);
    return true;
};

async function handlePresenceJoin(socket, payload, ack) {
    try {
        const target = parsePresenceTarget(payload);
        if (target.error) return reply(ack, { ok: false, error: target.error });
        const { entityType, entityId, room } = target;

        const entity = await loadEntity(entityType, entityId);
        const allowed = !!socket.workspaceId && !!entity
            && await isEntityAccessible(entityType, entity, socket.userId, socket.workspaceId);
        if (!allowed) return reply(ack, { ok: false, error: 'Access denied' });
        if (!socket.connected) return reply(ack, { ok: false, error: 'Disconnected' });

        if (!presenceRooms.has(room)) presenceRooms.set(room, new Map());
        const entries = presenceRooms.get(room);
        if (!entries.has(socket.id)) {
            entries.set(socket.id, {
                user_id: socket.userId,
                name: socket.user?.name || '',
                avatar: socket.user?.avatar || '',
                editing: false,
                since: new Date().toISOString(),
            });
        }
        if (!socketPresence.has(socket.id)) socketPresence.set(socket.id, new Set());
        socketPresence.get(socket.id).add(room);
        socket.join(room);

        broadcastPresence(room);
        reply(ack, { ok: true, users: getPresenceUsers(room) });
    } catch (err) {
        console.error('presence:join failed:', err.message);
        reply(ack, { ok: false, error: 'Presence join failed' });
    }
}

function handlePresenceLeave(socket, payload, ack) {
    const target = parsePresenceTarget(payload);
    if (target.error) return reply(ack, { ok: false, error: target.error });
    if (removeFromRoom(socket, target.room)) broadcastPresence(target.room);
    reply(ack, { ok: true });
}

function handlePresenceEditing(socket, payload, ack) {
    const target = parsePresenceTarget(payload);
    if (target.error) return reply(ack, { ok: false, error: target.error });
    const entry = presenceRooms.get(target.room)?.get(socket.id);
    if (!entry) return reply(ack, { ok: false, error: 'Not joined' });
    const editing = payload?.editing === true;
    if (entry.editing !== editing) {
        entry.editing = editing;
        broadcastPresence(target.room, { throttle: true });
    }
    reply(ack, { ok: true });
}

function leaveAllPresence(socket) {
    const rooms = socketPresence.get(socket.id);
    socketPresence.delete(socket.id);
    if (!rooms) return;
    for (const room of rooms) {
        const entries = presenceRooms.get(room);
        if (entries?.delete(socket.id)) {
            if (entries.size === 0) presenceRooms.delete(room);
            broadcastPresence(room);
        }
    }
}

/**
 * Get Socket.io server instance
 * @returns {SocketIOServer} Socket.io server instance
 */
export function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized. Call initializeWebSocket first.');
    }
    return io;
}

/**
 * Send a notification to a specific user in real-time
 * @param {string} userId - User ID to notify
 * @param {string} workspaceId - Workspace ID
 * @param {Object} notification - Notification object
 */
export function sendNotificationToUser(userId, workspaceId, notification) {
    if (!io) return;

    io.to(`user:${userId}`).emit('notification', {
        type: 'notification',
        data: notification,
        timestamp: new Date().toISOString()
    });

    console.log(`Notification sent to user ${userId} in workspace ${workspaceId}`);
}

/**
 * Broadcast notification to all users in a workspace
 * @param {string} workspaceId - Workspace ID
 * @param {Object} notification - Notification object
 */
export function broadcastNotification(workspaceId, notification) {
    if (!io) return;

    io.to(`workspace:${workspaceId}`).emit('notification', {
        type: 'notification',
        data: notification,
        timestamp: new Date().toISOString()
    });

    console.log(`Notification broadcast to workspace ${workspaceId}`);
}

/**
 * Send multiple notifications to multiple users
 * @param {Array<string>} userIds - Array of user IDs
 * @param {string} workspaceId - Workspace ID
 * @param {Object} notification - Notification object
 */
export function sendNotificationsToUsers(userIds, workspaceId, notification) {
    if (!io) return;

    userIds.forEach(userId => {
        sendNotificationToUser(userId, workspaceId, notification);
    });
}

/**
 * Send a real-time update event (for things like typing indicators, status updates)
 * @param {string} workspaceId - Workspace ID
 * @param {string} eventType - Type of event
 * @param {Object} data - Event data
 */
export function broadcastEvent(workspaceId, eventType, data) {
    if (!io) return;

    io.to(`workspace:${workspaceId}`).emit(eventType, {
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
    });
}

/**
 * Check if a user is currently connected
 * @param {string} userId - User ID
 * @returns {boolean} True if user has active connections
 */
export function isUserOnline(userId) {
    return userConnections.has(userId) && userConnections.get(userId).size > 0;
}

/**
 * Get all connected users in a workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Array<string>} Array of connected user IDs
 */
export function getConnectedUsersInWorkspace(workspaceId) {
    return getOnlineUserIds(workspaceId);
}

/**
 * Send a chat message to all members of a conversation
 * @param {Array<string>} memberIds - Conversation member user IDs
 * @param {string} workspaceId - Workspace ID
 * @param {Object} message - Enriched message object
 */
export function sendChatMessageToConversation(memberIds, workspaceId, message) {
    if (!io) return;

    const payload = {
        type: 'chat:message',
        data: message,
        timestamp: new Date().toISOString(),
    };

    memberIds.forEach(userId => {
        io.to(`user:${userId}`).emit('chat:message', payload);
    });

    io.to(`conversation:${message.conversation_id}`).emit('chat:message', payload);
}

/**
 * Emit `event` once per socket to the conversation room and the members' user rooms
 * (socket.io de-duplicates sockets that are in several of the target rooms).
 */
export function emitToConversation(conversationId, memberIds, event, payload, { extraUserIds = [] } = {}) {
    if (!io) return;
    const rooms = [
        `conversation:${conversationId}`,
        ...[...new Set([...(memberIds || []), ...extraUserIds])].map((id) => `user:${id}`),
    ];
    io.to(rooms).emit(event, payload);
}

/** Emit `event` to every socket of one user. */
export function emitToUser(userId, event, payload) {
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
}

/** Make every socket of these users leave the conversation room (after they are removed). */
export function removeUsersFromConversationRoom(conversationId, userIds) {
    if (!io) return;
    for (const userId of userIds || []) {
        io.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`);
    }
}
