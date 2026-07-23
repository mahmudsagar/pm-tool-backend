/**
 * Notification Service
 * Handles creating and distributing notifications based on entity sharing settings
 */

import { sendNotificationsToUsers, broadcastNotification } from './websocketService.js';

/**
 * Determine who should receive a notification based on entity sharing
 * @param {Object} entity - The entity (page, board, folder, etc.)
 * @param {string} workspaceId - The workspace ID
 * @param {string} currentUserId - The user performing the action (excluded from recipients)
 * @returns {Promise<Array<string>>} Array of user IDs who should receive notification
 */
export async function getNotificationRecipients(entity, workspaceId, currentUserId) {
    const recipients = new Set();

    // Case 1: Private entity - only notify owner if action done by someone else
    if (entity.is_private) {
        if (entity.user_id && entity.user_id !== currentUserId) {
            recipients.add(entity.user_id);
        }
        // Also add shared_members
        if (entity.shared_members && Array.isArray(entity.shared_members)) {
            entity.shared_members.forEach(memberId => {
                if (memberId !== currentUserId) recipients.add(memberId);
            });
        }
    }
    // Case 2: Public entity
    else {
        // If shared with specific members/teams, notify only them
        if (entity.shared_members?.length > 0 || entity.shared_teams?.length > 0) {
            // Add specific members
            if (entity.shared_members && Array.isArray(entity.shared_members)) {
                entity.shared_members.forEach(memberId => {
                    if (memberId !== currentUserId) recipients.add(memberId);
                });
            }
            // Add team members
            if (entity.shared_teams && Array.isArray(entity.shared_teams)) {
                for (const teamId of entity.shared_teams) {
                    const teamMembers = await getTeamMembers(teamId);
                    teamMembers.forEach(memberId => {
                        if (memberId !== currentUserId) recipients.add(memberId);
                    });
                }
            }
        }
        // If completely public (no specific sharing), notify all workspace members
        else {
            const workspaceMembers = await getWorkspaceMembers(workspaceId);
            workspaceMembers.forEach(memberId => {
                if (memberId !== currentUserId) recipients.add(memberId);
            });
        }
    }

    return Array.from(recipients);
}

/**
 * Get all members of a team
 * @param {string} teamId - Team ID
 * @returns {Promise<Array<string>>} Array of user IDs in the team
 */
async function getTeamMembers(teamId) {
    try {
        const team = await global.Team.findOne({ _id: teamId });
        if (!team || !team.members) return [];
        return Array.isArray(team.members) ? team.members : [];
    } catch (err) {
        console.error(`Error fetching team members for ${teamId}:`, err.message);
        return [];
    }
}

/**
 * Get all members of a workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<Array<string>>} Array of user IDs in the workspace
 */
async function getWorkspaceMembers(workspaceId) {
    try {
        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        if (!workspace || !workspace.members) return [];
        return Array.isArray(workspace.members) ? workspace.members : [];
    } catch (err) {
        console.error(`Error fetching workspace members for ${workspaceId}:`, err.message);
        return [];
    }
}

/**
 * Create notification for an action
 * @param {Object} params - Notification parameters
 * @returns {Promise<void>}
 */
export async function createNotification(params) {
    const {
        workspaceId,
        entity,           // The entity being acted upon
        entityType,       // 'page', 'board', 'folder', etc.
        action,           // 'create', 'update', 'delete', 'share', 'comment'
        currentUserId,    // User performing the action
        message = null,   // Custom message (optional)
        metadata = {}     // Additional context (optional)
    } = params;

    try {
        // Determine recipients
        const recipients = await getNotificationRecipients(entity, workspaceId, currentUserId);

        if (recipients.length === 0) return; // No one to notify

        // Create notifications for each recipient
        const notifications = recipients.map(recipientId => ({
            workspace_id: workspaceId,
            recipient_id: recipientId,
            actor_id: currentUserId,
            action,
            entity_type: entityType,
            entity_id: entity._id,
            entity_name: entity.name || entity.title || 'Unnamed',
            message: message || generateDefaultMessage(action, entityType, entity),
            metadata: {
                ...metadata,
                actor_name: metadata.actor_name || 'User'
            }
        }));

        // Batch create notifications
        const createdNotifications = await global.Notification.createEach(notifications);

        // Send real-time notifications via WebSocket
        try {
            if (createdNotifications && createdNotifications.length > 0) {
                // Send to each recipient in real-time
                createdNotifications.forEach(notification => {
                    sendNotificationsToUsers([notification.recipient_id], workspaceId, notification);
                });
            }
        } catch (wsErr) {
            console.error(`Error sending WebSocket notifications:`, wsErr.message);
            // Don't throw - WebSocket errors shouldn't block notification creation
        }
    } catch (err) {
        console.error(`Error creating notifications:`, err.message);
        // Don't throw - notification failures shouldn't break the main operation
    }
}

/**
 * Create notifications for an explicit list of recipients (e.g. chat mentions)
 */
export async function createDirectNotifications({
    workspaceId,
    recipientIds = [],
    actorId,
    action,
    entityType,
    entityId,
    entityName,
    message,
    metadata = {},
}) {
    try {
        const uniqueRecipients = [...new Set(recipientIds)].filter(
            (id) => id && id !== actorId
        );
        if (uniqueRecipients.length === 0) return;

        const notifications = uniqueRecipients.map((recipientId) => ({
            workspace_id: workspaceId,
            recipient_id: recipientId,
            actor_id: actorId,
            action,
            entity_type: entityType,
            entity_id: entityId,
            entity_name: entityName || 'Chat',
            message: message || `${action} in chat`,
            metadata,
        }));

        const createdNotifications = await global.Notification.createEach(notifications);

        try {
            if (createdNotifications?.length) {
                createdNotifications.forEach((notification) => {
                    sendNotificationsToUsers([notification.recipient_id], workspaceId, notification);
                });
            }
        } catch (wsErr) {
            console.error(`Error sending WebSocket notifications:`, wsErr.message);
        }
    } catch (err) {
        console.error(`Error creating direct notifications:`, err.message);
    }
}

/**
 * Generate default notification message based on action
 * @param {string} action - Action type
 * @param {string} entityType - Entity type
 * @param {Object} entity - The entity
 * @returns {string} Notification message
 */
function generateDefaultMessage(action, entityType, entity) {
    const entityName = entity.name || entity.title || 'an item';
    
    switch (action) {
        case 'create':
            return `Created a new ${entityType}: ${entityName}`;
        case 'update':
            return `Updated ${entityType}: ${entityName}`;
        case 'delete':
            return `Deleted ${entityType}: ${entityName}`;
        case 'share':
            return `Shared ${entityType}: ${entityName}`;
        case 'comment':
            return `Commented on ${entityType}: ${entityName}`;
        default:
            return `${action} on ${entityType}: ${entityName}`;
    }
}

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Updated notification
 */
export async function markNotificationAsRead(notificationId) {
    try {
        const notification = await global.Notification.updateOne({ _id: notificationId })
            .set({ is_read: true, read_at: new Date() });
        return notification;
    } catch (err) {
        console.error(`Error marking notification as read:`, err.message);
        throw err;
    }
}

/**
 * Mark all unread notifications as read for a user in a workspace
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID
 * @returns {Promise<{ updated: number }>}
 */
export async function markAllNotificationsAsRead(workspaceId, userId) {
    try {
        const result = await global.Notification.update({
            workspace_id: workspaceId,
            recipient_id: userId,
            is_read: false,
        }).set({ is_read: true, read_at: new Date() }).fetch();

        return { updated: Array.isArray(result) ? result.length : 0 };
    } catch (err) {
        console.error(`Error marking all notifications as read:`, err.message);
        throw err;
    }
}

/**
 * Get unread notifications for a user
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID
 * @param {number} limit - Number of notifications to fetch (default 20)
 * @returns {Promise<Array>} Array of notifications
 */
export async function getUnreadNotifications(workspaceId, userId, limit = 20) {
    try {
        const notifications = await global.Notification.find({
            workspace_id: workspaceId,
            recipient_id: userId,
            is_read: false
        })
            .sort('createdAt DESC')
            .limit(limit);
        return notifications;
    } catch (err) {
        console.error(`Error fetching unread notifications:`, err.message);
        return [];
    }
}

/**
 * Get all notifications for a user
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID
 * @param {number} limit - Number of notifications to fetch (default 50)
 * @param {number} skip - Skip count for pagination (default 0)
 * @returns {Promise<Array>} Array of notifications
 */
export async function getNotifications(workspaceId, userId, limit = 50, skip = 0) {
    try {
        const notifications = await global.Notification.find({
            workspace_id: workspaceId,
            recipient_id: userId
        })
            .sort('createdAt DESC')
            .limit(limit)
            .skip(skip);
        return notifications;
    } catch (err) {
        console.error(`Error fetching notifications:`, err.message);
        return [];
    }
}

/**
 * Get notification count for a user
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} { total, unread }
 */
export async function getNotificationCount(workspaceId, userId) {
    try {
        const total = await global.Notification.count({
            workspace_id: workspaceId,
            recipient_id: userId
        });
        const unread = await global.Notification.count({
            workspace_id: workspaceId,
            recipient_id: userId,
            is_read: false
        });
        return { total, unread };
    } catch (err) {
        console.error(`Error counting notifications:`, err.message);
        return { total: 0, unread: 0 };
    }
}
