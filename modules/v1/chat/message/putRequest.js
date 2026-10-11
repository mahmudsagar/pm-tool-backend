import { putMessageSchema } from './config/validation.js';
import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import {
    loadMessageForUser, resolveMentions, buildPreview, broadcastMessageUpdated, notifyMentions,
    refreshPreviewIfLatest, handleChatError,
} from '../utils/messageHelper.js';

/** PUT /v1/chat/message { id, body?, content?, mentions? } — sender only; sets edited_at. */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = putMessageSchema.parse(request.body);

        const { message, conversation } = await loadMessageForUser(body.id, workspaceId, userId);
        if (message.sender_id !== userId) {
            return response.status(403).json(formatErrorMessage('Only the sender can edit this message'));
        }
        if (message.deleted_at) {
            return response.status(400).json(formatErrorMessage('Cannot edit a deleted message'));
        }

        const nextBody = body.body !== undefined ? body.body.trim() : message.body;
        if (!nextBody && !(message.attachments || []).length && !(message.entity_refs || []).length) {
            return response.status(400).json(formatErrorMessage('Message body, attachments, or links required'));
        }
        const nextContent = body.content !== undefined ? body.content : message.content;

        const updates = { body: nextBody, content: nextContent || '', edited_at: new Date() };
        let newlyMentioned = [];
        if (body.content !== undefined || body.mentions !== undefined) {
            const mentions = resolveMentions(conversation, userId, body.mentions ?? message.mentions, nextContent);
            newlyMentioned = mentions.filter((id) => !(message.mentions || []).includes(id));
            updates.mentions = mentions;
        }

        const updated = await global.Message.updateOne({ _id: message._id }).set(updates);
        await refreshPreviewIfLatest(conversation, updated);
        const enriched = await broadcastMessageUpdated(conversation, updated);

        await notifyMentions({
            conversation, workspaceId, actorId: userId, recipientIds: newlyMentioned, message: updated,
            preview: buildPreview({ ...updated, parent_message_id: null }),
        });

        response.json(formatSuccessMessage('Message updated successfully', enriched));
    } catch (err) {
        handleChatError(err, response);
    }
};
