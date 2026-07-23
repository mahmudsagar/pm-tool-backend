import { z } from 'zod';
import { postMessageSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichMessage, isConversationMember } from '../utils/chatHelper.js';
import { sendChatMessageToConversation } from '../../utils/websocketService.js';
import { createDirectNotifications } from '../../utils/notificationService.js';

function extractMentionIdsFromContent(content) {
    if (!content || typeof content !== 'string') return [];
    try {
        const parsed = JSON.parse(content);
        const ids = [];
        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'mention' && node.userId) {
                ids.push(node.userId);
            }
            const children = node.children || [];
            children.forEach(walk);
        };
        walk(parsed.root);
        return [...new Set(ids)];
    } catch {
        return [];
    }
}

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = postMessageSchema.parse(request.body);

        if (!body.body?.trim() && (!body.attachments || body.attachments.length === 0) && (!body.entity_refs || body.entity_refs.length === 0)) {
            return response.status(400).json(formatErrorMessage('Message body, attachments, or links required'));
        }

        const conversation = await global.Conversation.findOne({
            _id: body.conversation_id,
            workspace_id: workspaceId,
        });

        if (!conversation || !isConversationMember(conversation, userId)) {
            return response.status(404).json(formatErrorMessage('Conversation not found'));
        }

        const memberSet = new Set(conversation.members || []);
        const fromPayload = Array.isArray(body.mentions) ? body.mentions : [];
        const fromContent = extractMentionIdsFromContent(body.content);
        const mentions = [...new Set([...fromPayload, ...fromContent])]
            .filter((id) => id !== userId && memberSet.has(id));

        const message = await global.Message.create({
            conversation_id: body.conversation_id,
            sender_id: userId,
            body: body.body?.trim() || '',
            content: body.content || '',
            mentions,
            attachments: body.attachments || [],
            entity_refs: body.entity_refs || [],
        }).fetch();

        const preview = body.body?.trim()
            || (body.entity_refs?.length > 0 ? `🔗 ${body.entity_refs[0].title}` : '')
            || (body.attachments?.length > 0 ? '📎 Attachment' : '');
        await global.Conversation.updateOne({ _id: body.conversation_id }).set({
            last_message_at: new Date(),
            last_message_preview: preview.substring(0, 100),
        });

        const enriched = await enrichMessage(message);

        sendChatMessageToConversation(conversation.members, workspaceId, enriched);

        if (mentions.length > 0) {
            const actor = await global.User.findOne({ _id: userId });
            const actorName = actor?.name || 'Someone';
            const conversationLabel =
                conversation.type === 'dm'
                    ? 'a direct message'
                    : (conversation.name || conversation.displayName || 'a chat');

            await createDirectNotifications({
                workspaceId,
                recipientIds: mentions,
                actorId: userId,
                action: 'mention',
                entityType: 'conversation',
                entityId: conversation._id,
                entityName: conversation.name || 'Chat',
                message: `${actorName} mentioned you in ${conversationLabel}`,
                metadata: {
                    actor_name: actorName,
                    conversation_id: conversation._id,
                    conversation_type: conversation.type,
                    message_id: message._id,
                    preview: preview.substring(0, 120),
                },
            });
        }

        response.json(formatSuccessMessage('Message sent successfully', enriched));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
