import { pinSchema } from '../config/validation.js';
import { formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { loadMessageForUser, broadcastMessageUpdated, handleChatError } from '../../utils/messageHelper.js';

/** POST /v1/chat/message/pin { message_id, pinned } — any member of the conversation. */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = pinSchema.parse(request.body);

        const { message, conversation } = await loadMessageForUser(body.message_id, workspaceId, userId);
        if (message.deleted_at) {
            return response.status(400).json(formatErrorMessage('Cannot pin a deleted message'));
        }

        const updated = await global.Message.updateOne({ _id: message._id }).set(body.pinned
            ? { pinned: true, pinned_by: userId, pinned_at: new Date() }
            : { pinned: false, pinned_by: null, pinned_at: null });

        const enriched = await broadcastMessageUpdated(conversation, updated);
        response.json(formatSuccessMessage(body.pinned ? 'Message pinned' : 'Message unpinned', enriched));
    } catch (err) {
        handleChatError(err, response);
    }
};
