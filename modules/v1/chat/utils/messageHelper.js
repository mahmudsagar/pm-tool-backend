/**
 * Message helpers shared by the chat message endpoints: access, previews, thread roots,
 * mention / thread notifications and realtime broadcasts.
 */
import { enrichMessage, isConversationMember } from './chatHelper.js';
import { z } from 'zod';
import { collection, toObjectId } from '../../utils/boardTasks.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { emitToConversation } from '../../utils/websocketService.js';
import { createDirectNotifications } from '../../utils/notificationService.js';

export const REPLY_USER_LIMIT = 5;
export const THREAD_PREFIX = 'Replied in thread: ';

/** Thrown by the loaders; handlers answer `status` with `message`. */
export class ChatError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** Conversation of the workspace that the user is a member of (404 otherwise). */
export async function loadMemberConversation(conversationId, workspaceId, userId) {
    const conversation = await global.Conversation.findOne({ _id: conversationId, workspace_id: workspaceId });
    if (!conversation || !isConversationMember(conversation, userId)) {
        throw new ChatError(404, 'Conversation not found');
    }
    return conversation;
}

/**
 * Message + its conversation for a member (404 for unknown messages, other workspaces and
 * non-members). With `allowNonMember` the membership check is skipped (admin moderation).
 */
export async function loadMessageForUser(messageId, workspaceId, userId, { allowNonMember = false } = {}) {
    const message = await global.Message.findOne({ _id: messageId });
    if (!message) throw new ChatError(404, 'Message not found');
    const conversation = await global.Conversation.findOne({ _id: message.conversation_id, workspace_id: workspaceId });
    if (!conversation) throw new ChatError(404, 'Message not found');
    if (!allowNonMember && !isConversationMember(conversation, userId)) throw new ChatError(404, 'Message not found');
    return { message, conversation };
}

export function extractMentionIdsFromContent(content) {
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

/** Mentioned members (payload ids + mention nodes in content), never the sender. */
export function resolveMentions(conversation, senderId, payloadMentions, content) {
    const memberSet = new Set(conversation.members || []);
    const fromPayload = Array.isArray(payloadMentions) ? payloadMentions : [];
    const fromContent = extractMentionIdsFromContent(content);
    return [...new Set([...fromPayload, ...fromContent])]
        .filter((id) => id !== senderId && memberSet.has(id));
}

/** Conversation preview text for a message (thread replies are prefixed). */
export function buildPreview(message) {
    const text = message.body?.trim()
        || (message.entity_refs?.length > 0 ? `🔗 ${message.entity_refs[0].title}` : '')
        || (message.attachments?.length > 0 ? '📎 Attachment' : '');
    return message.parent_message_id ? `${THREAD_PREFIX}${text}` : text;
}

export const conversationLabel = (conversation) => (conversation.type === 'dm'
    ? 'a direct message'
    : (conversation.name || conversation.displayName || 'a chat'));

/**
 * Recompute a thread root's summary from its live (not deleted) replies:
 * reply_count, last_reply_at and up to 5 most recent distinct repliers (newest first).
 * Returns the updated root.
 */
export async function refreshThreadRoot(rootId) {
    const replies = await collection('message')
        .find({ parent_message_id: String(rootId), deleted_at: null }, { projection: { sender_id: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
    const replyUserIds = [];
    for (const reply of replies) {
        if (!replyUserIds.includes(reply.sender_id)) replyUserIds.push(reply.sender_id);
        if (replyUserIds.length >= REPLY_USER_LIMIT) break;
    }
    return global.Message.updateOne({ _id: String(rootId) }).set({
        reply_count: replies.length,
        last_reply_at: replies[0]?.createdAt || null,
        reply_user_ids: replyUserIds,
    });
}

/** Broadcast an updated message (enriched) as chat:message_updated. Returns the enriched message. */
export async function broadcastMessageUpdated(conversation, message) {
    const enriched = await enrichMessage(message);
    emitToConversation(conversation._id, conversation.members, 'chat:message_updated', enriched);
    return enriched;
}

/** Mention notifications (unchanged wording from POST /v1/chat/message). */
export async function notifyMentions({ conversation, workspaceId, actorId, recipientIds, message, preview }) {
    if (!recipientIds?.length) return;
    const actor = await global.User.findOne({ _id: actorId });
    const actorName = actor?.name || 'Someone';
    await createDirectNotifications({
        workspaceId,
        recipientIds,
        actorId,
        action: 'mention',
        entityType: 'conversation',
        entityId: conversation._id,
        entityName: conversation.name || 'Chat',
        message: `${actorName} mentioned you in ${conversationLabel(conversation)}`,
        metadata: {
            actor_name: actorName,
            conversation_id: conversation._id,
            conversation_type: conversation.type,
            message_id: message._id,
            ...(message.parent_message_id ? { parent_message_id: message.parent_message_id } : {}),
            preview: (preview || '').substring(0, 120),
        },
    });
}

/**
 * Thread reply notifications (action 'reply') to the root author and earlier repliers that are
 * still members, except the sender and users already notified for a mention.
 */
export async function notifyThreadReply({ conversation, workspaceId, actorId, root, reply, mentioned = [], preview }) {
    const earlier = await collection('message')
        .distinct('sender_id', { parent_message_id: String(root._id), _id: { $ne: toObjectId(reply._id) } });
    const memberSet = new Set(conversation.members || []);
    const skip = new Set([actorId, ...mentioned]);
    const recipients = [...new Set([root.sender_id, ...earlier])].filter((id) => memberSet.has(id) && !skip.has(id));
    if (recipients.length === 0) return;
    const actor = await global.User.findOne({ _id: actorId });
    const actorName = actor?.name || 'Someone';
    await createDirectNotifications({
        workspaceId,
        recipientIds: recipients,
        actorId,
        action: 'reply',
        entityType: 'conversation',
        entityId: conversation._id,
        entityName: conversation.name || 'Chat',
        message: `${actorName} replied to a thread in ${conversationLabel(conversation)}`,
        metadata: {
            actor_name: actorName,
            conversation_id: conversation._id,
            conversation_type: conversation.type,
            message_id: reply._id,
            parent_message_id: root._id,
            preview: (preview || '').substring(0, 120),
        },
    });
}

/**
 * After an edit or delete: if the message is the conversation's newest message, refresh the
 * preview (deleted → "Message deleted"). last_message_at is left alone.
 */
export async function refreshPreviewIfLatest(conversation, message) {
    const latest = await collection('message')
        .find({ conversation_id: String(conversation._id) }, { projection: { _id: 1 } })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
    if (!latest[0] || String(latest[0]._id) !== String(message._id)) return;
    const preview = message.deleted_at
        ? `${message.parent_message_id ? THREAD_PREFIX : ''}Message deleted`
        : buildPreview(message);
    await global.Conversation.updateOne({ _id: conversation._id }).set({ last_message_preview: preview.substring(0, 100) });
}

/** Mark the conversation read for a user (atomic per-user key). Returns the ISO timestamp. */
export async function markConversationRead(conversationId, userId, at = new Date()) {
    const iso = at.toISOString();
    await collection('conversation').updateOne(
        { _id: toObjectId(conversationId) },
        { $set: { [`read_state.${userId}`]: iso } },
    );
    return iso;
}

/** Respond with a ChatError / zod error / generic 400 like the other chat handlers. */
export function handleChatError(err, response) {
    if (err instanceof ChatError) return response.status(err.status).json(formatErrorMessage(err.message));
    if (err instanceof z.ZodError) return response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
    return response.status(400).json(formatErrorMessage(err.message));
}
