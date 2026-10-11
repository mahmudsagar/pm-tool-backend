import { deleteMessageSchema } from './config/validation.js';
import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichMessage, isConversationMember } from '../utils/chatHelper.js';
import { isWorkspaceAdmin } from '../../utils/workspaceAccess.js';
import { emitToConversation } from '../../utils/websocketService.js';
import {
    loadMessageForUser, refreshThreadRoot, broadcastMessageUpdated, refreshPreviewIfLatest, handleChatError,
} from '../utils/messageHelper.js';

/**
 * DELETE /v1/chat/message?id= — the sender, or a workspace owner / admin. Soft delete: deleted_at
 * is set and the content blanked so threads keep their place.
 */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = deleteMessageSchema.parse(request.query);

        const { message, conversation } = await loadMessageForUser(query.id, workspaceId, userId, { allowNonMember: true });
        const isSender = message.sender_id === userId && isConversationMember(conversation, userId);
        if (!isSender) {
            const workspace = await global.Workspace.findOne({ _id: workspaceId });
            if (!isWorkspaceAdmin(workspace, userId)) {
                // Non-members do not learn that the message exists.
                if (!isConversationMember(conversation, userId)) return response.status(404).json(formatErrorMessage('Message not found'));
                return response.status(403).json(formatErrorMessage('Only the sender or a workspace admin can delete this message'));
            }
        }
        if (message.deleted_at) {
            return response.status(400).json(formatErrorMessage('Message already deleted'));
        }

        const deleted = await global.Message.updateOne({ _id: message._id }).set({
            deleted_at: new Date(),
            deleted_by: userId,
            body: '',
            content: '',
            mentions: [],
            attachments: [],
            entity_refs: [],
            reactions: [],
            pinned: false,
            pinned_by: null,
            pinned_at: null,
        });

        emitToConversation(conversation._id, conversation.members, 'chat:message_deleted', {
            conversation_id: conversation._id,
            message_id: message._id,
            parent_message_id: message.parent_message_id || null,
        });

        if (message.parent_message_id) {
            const root = await refreshThreadRoot(message.parent_message_id);
            if (root) await broadcastMessageUpdated(conversation, root);
        }
        await refreshPreviewIfLatest(conversation, deleted);

        response.json(formatSuccessMessage('Message deleted successfully', await enrichMessage(deleted)));
    } catch (err) {
        handleChatError(err, response);
    }
};
