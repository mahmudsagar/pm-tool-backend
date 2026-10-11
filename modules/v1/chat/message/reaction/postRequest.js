import { reactionSchema } from '../config/validation.js';
import { formatErrorMessage } from '../../../utils/error.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { emitToConversation } from '../../../utils/websocketService.js';
import { loadMessageForUser, handleChatError } from '../../utils/messageHelper.js';

const MAX_DISTINCT_EMOJIS = 20;

/**
 * POST /v1/chat/message/reaction { message_id, emoji } — toggles the current user in that emoji's
 * group (empty groups are dropped; at most 20 distinct emojis per message).
 */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = reactionSchema.parse(request.body);

        const { message, conversation } = await loadMessageForUser(body.message_id, workspaceId, userId);
        if (message.deleted_at) {
            return response.status(400).json(formatErrorMessage('Cannot react to a deleted message'));
        }

        const reactions = (Array.isArray(message.reactions) ? message.reactions : [])
            .map((r) => ({ emoji: r.emoji, user_ids: [...(r.user_ids || [])] }));
        const group = reactions.find((r) => r.emoji === body.emoji);
        if (group) {
            group.user_ids = group.user_ids.includes(userId)
                ? group.user_ids.filter((id) => id !== userId)
                : [...group.user_ids, userId];
        } else {
            if (reactions.length >= MAX_DISTINCT_EMOJIS) {
                return response.status(400).json(formatErrorMessage(`A message can have at most ${MAX_DISTINCT_EMOJIS} different reactions`));
            }
            reactions.push({ emoji: body.emoji, user_ids: [userId] });
        }
        const next = reactions.filter((r) => r.user_ids.length > 0);

        await global.Message.updateOne({ _id: message._id }).set({ reactions: next });

        const payload = {
            conversation_id: conversation._id,
            message_id: message._id,
            parent_message_id: message.parent_message_id || null,
            reactions: next,
        };
        emitToConversation(conversation._id, conversation.members, 'chat:reaction', payload);

        response.json(formatSuccessMessage('Reaction updated successfully', payload));
    } catch (err) {
        handleChatError(err, response);
    }
};
