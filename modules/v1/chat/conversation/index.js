import { z } from 'zod';
import { getConversationSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichConversation, isConversationMember } from '../utils/chatHelper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = getConversationSchema.parse(request.query);

        if (query.id) {
            const conversation = await global.Conversation.findOne({ _id: query.id, workspace_id: workspaceId });
            if (!conversation || !isConversationMember(conversation, userId)) {
                return response.status(404).json(formatErrorMessage('Conversation not found'));
            }
            const enriched = await enrichConversation(conversation, userId);
            return response.json(formatSuccessMessage('Conversation fetched successfully', enriched));
        }

        let conversations = await global.Conversation.find({ workspace_id: workspaceId });

        conversations = conversations.filter(c => isConversationMember(c, userId));

        if (query.type) {
            conversations = conversations.filter(c => c.type === query.type);
        }
        if (query.space_id) {
            conversations = conversations.filter(c => c.space_id === query.space_id);
        }

        conversations.sort((a, b) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at) : new Date(a.createdAt);
            const bTime = b.last_message_at ? new Date(b.last_message_at) : new Date(b.createdAt);
            return bTime - aTime;
        });

        const enriched = await Promise.all(
            conversations.map(c => enrichConversation(c, userId))
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
