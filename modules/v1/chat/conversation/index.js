import { z } from 'zod';
import { getConversationSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichConversation, resolveConversationAccess } from '../utils/chatHelper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = getConversationSchema.parse(request.query);

        if (query.id) {
            const workspace = await global.Workspace.findOne({ _id: workspaceId });
            const found = await global.Conversation.findOne({ _id: query.id, workspace_id: workspaceId });
            const conversation = await resolveConversationAccess(found, userId, { workspace });
            if (!conversation) {
                return response.status(404).json(formatErrorMessage('Conversation not found'));
            }
            const enriched = await enrichConversation(conversation, userId, { workspace });
            return response.json(formatSuccessMessage('Conversation fetched successfully', enriched));
        }

        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        let conversations = await global.Conversation.find({ workspace_id: workspaceId });

        // Channels follow live space access (members are synced here).
        conversations = (await Promise.all(
            conversations.map(c => resolveConversationAccess(c, userId, { workspace }))
        )).filter(Boolean);

        if (query.type) {
            conversations = conversations.filter(c => c.type === query.type);
        }
        if (query.space_id) {
            conversations = conversations.filter(c => c.space_id === query.space_id);
        }

        // Pinned (for the current user) first, then most recent activity.
        conversations.sort((a, b) => {
            const aPinned = (a.pinned_by || []).includes(userId) ? 1 : 0;
            const bPinned = (b.pinned_by || []).includes(userId) ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            const aTime = a.last_message_at ? new Date(a.last_message_at) : new Date(a.createdAt);
            const bTime = b.last_message_at ? new Date(b.last_message_at) : new Date(b.createdAt);
            return bTime - aTime;
        });

        const enriched = await Promise.all(
            conversations.map(c => enrichConversation(c, userId, { workspace }))
        );

        response.json(formatSuccessMessage('Conversations fetched successfully', enriched));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
