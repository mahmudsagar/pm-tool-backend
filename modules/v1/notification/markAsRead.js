/**
 * Mark notification as read
 */
import { markNotificationAsRead } from '../utils/notificationService.js';
import { formatSuccessMessage, formatErrorMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { notification_id } = request.query;

        if (!notification_id) {
            return response.status(400).json(formatErrorMessage('notification_id is required'));
        }

        const result = await markNotificationAsRead(notification_id);

        response.json(formatSuccessMessage("Notification marked as read", result));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
