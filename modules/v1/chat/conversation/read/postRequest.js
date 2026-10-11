import { readConversationSchema } from '../config/validation.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { emitToUser } from '../../../utils/websocketService.js';
import { loadMemberConversation, markConversationRead, handleChatError } from '../../utils/messageHelper.js';

/** POST /v1/chat/conversation/read { conversation_id } — read_state[user] = now; chat:read to the user's room. */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = readConversationSchema.parse(request.body);

        const conversation = await loadMemberConversation(body.conversation_id, workspaceId, userId);
        const lastReadAt = await markConversationRead(conversation._id, userId);
        emitToUser(userId, 'chat:read', { conversation_id: conversation._id, last_read_at: lastReadAt });

        response.json(formatSuccessMessage('Conversation marked as read', {
            conversation_id: conversation._id,
            last_read_at: lastReadAt,
            unread_count: 0,
            mention_count: 0,
        }));
    } catch (err) {
        handleChatError(err, response);
    }
};
