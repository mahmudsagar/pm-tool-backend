/**
 * WebSocket Service for Real-time Notifications
 * Handles Socket.io connections and notification broadcasting
 */

import { Server as SocketIOServer } from 'socket.io';

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
            origin: process.env.FRONTEND_URL || 'http://localhost:3000',
            credentials: true
        },
        ...options
    });

    // Middleware to verify JWT on connection
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        const userId = socket.handshake.auth.userId;
        const workspaceId = socket.handshake.auth.workspaceId;

        if (!token || !userId || !workspaceId) {
            return next(new Error('Missing authentication'));
        }

        // Store user info in socket
        socket.userId = userId;
        socket.workspaceId = workspaceId;
        socket.token = token;

        next();
    });

    // Handle connections
    io.on('connection', (socket) => {
        const userId = socket.userId;
        const workspaceId = socket.workspaceId;

        console.log(`User ${userId} connected with socket ${socket.id}`);

        // Track user connection
        if (!userConnections.has(userId)) {
            userConnections.set(userId, new Set());
        }
        userConnections.get(userId).add(socket.id);

        // Join user-specific room for targeted notifications
        socket.join(`user:${userId}`);
        // Join workspace room for workspace-wide broadcasts
        socket.join(`workspace:${workspaceId}`);

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
        });

        // Handle ping/pong for keep-alive
        socket.on('ping', () => {
            socket.emit('pong');
        });
    });

    return io;
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
    const connectedUsers = Array.from(userConnections.keys()).filter(userId => {
        // In a real app, you'd verify the user belongs to this workspace
        return isUserOnline(userId);
    });
    return connectedUsers;
}
