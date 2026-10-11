import { postMessageSchema } from './config/validation.js';
import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichMessage } from '../utils/chatHelper.js';
import { sendChatMessageToConversation } from '../../utils/websocketService.js';
import {
    loadMemberConversation, resolveMentions, buildPreview, refreshThreadRoot, broadcastMessageUpdated,
    notifyMentions, notifyThreadReply, markConversationRead, handleChatError,
} from '../utils/messageHelper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = postMessageSchema.parse(request.body);

        if (!body.body?.trim() && (!body.attachments || body.attachments.length === 0) && (!body.entity_refs || body.entity_refs.length === 0)) {
            return response.status(400).json(formatErrorMessage('Message body, attachments, or links required'));
        }

        const conversation = await loadMemberConversation(body.conversation_id, workspaceId, userId);

        let root = null;
        if (body.parent_message_id) {
            root = await global.Message.findOne({ _id: body.parent_message_id });
            if (!root || root.conversation_id !== conversation._id) {
                return response.status(400).json(formatErrorMessage('parent_message_id must be a message of this conversation'));
            }
            if (root.parent_message_id) {
                return response.status(400).json(formatErrorMessage('parent_message_id must be a top-level message'));
            }
            if (root.deleted_at) {
                return response.status(400).json(formatErrorMessage('Cannot reply to a deleted message'));
            }
        }

        const mentions = resolveMentions(conversation, userId, body.mentions, body.content);

        const message = await global.Message.create({
            conversation_id: body.conversation_id,
            sender_id: userId,
            body: body.body?.trim() || '',
            content: body.content || '',
            mentions,
            attachments: body.attachments || [],
            entity_refs: body.entity_refs || [],
            parent_message_id: root ? root._id : null,
        }).fetch();

        const preview = buildPreview(message);
        const now = new Date();
        await global.Conversation.updateOne({ _id: body.conversation_id }).set({
            last_message_at: now,
            last_message_preview: preview.substring(0, 100),
        });
        // Sending a top-level message means the sender has seen the conversation.
        if (!root) await markConversationRead(conversation._id, userId, now);

        const enriched = await enrichMessage(message);

        sendChatMessageToConversation(conversation.members, workspaceId, enriched);

        if (root) {
            const updatedRoot = await refreshThreadRoot(root._id);
            if (updatedRoot) await broadcastMessageUpdated(conversation, updatedRoot);
        }

        const text = buildPreview({ ...message, parent_message_id: null });
        await notifyMentions({ conversation, workspaceId, actorId: userId, recipientIds: mentions, message, preview: text });
        if (root) {
            await notifyThreadReply({ conversation, workspaceId, actorId: userId, root, reply: message, mentioned: mentions, preview: text });
        }

        response.json(formatSuccessMessage('Message sent successfully', enriched));
    } catch (err) {
        handleChatError(err, response);
    }
};
