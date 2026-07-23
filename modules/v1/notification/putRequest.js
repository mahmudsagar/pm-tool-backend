/**
 * Mark notification(s) as read
 * - ?notification_id=<id>  → mark one
 * - ?mark_all=true         → mark all unread for current user/workspace
 */
import {
    markNotificationAsRead,
    markAllNotificationsAsRead,
} from '../utils/notificationService.js';
import { formatSuccessMessage } from '../utils/success.js';
import { formatErrorMessage } from '../utils/error.js';

export default async (request, response) => {
    try {
        const workspaceId = request.workspaceId;
        const userId = request.user.id;
        const { notification_id, mark_all } = request.query;

        if (mark_all === 'true' || mark_all === true) {
            const result = await markAllNotificationsAsRead(workspaceId, userId);
            return response.json(
                formatSuccessMessage('All notifications marked as read', result)
            );
        }

        if (!notification_id) {
            return response.status(400).json(
                formatErrorMessage('notification_id is required (or use mark_all=true)')
            );
        }

        const result = await markNotificationAsRead(notification_id);
        response.json(formatSuccessMessage('Notification marked as read', result));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
