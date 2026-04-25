/**
 * Get notifications for the current user
 */
import { getNotifications, getNotificationCount } from '../utils/notificationService.js';
import { formatSuccessMessage, formatErrorMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const workspaceId = request.workspaceId;
        const userId = request.user.id;
        const { limit = 50, skip = 0 } = request.query;

        const notifications = await getNotifications(
            workspaceId,
            userId,
            parseInt(limit),
            parseInt(skip)
        );

        const { total, unread } = await getNotificationCount(workspaceId, userId);

        response.json(formatSuccessMessage("Notifications fetched successfully", {
            notifications,
            count: {
                total,
                unread
            }
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
