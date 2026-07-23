import { z } from 'zod';
import { getMessageSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichMessage, isConversationMember } from '../utils/chatHelper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = getMessageSchema.parse(request.query);

        const conversation = await global.Conversation.findOne({
            _id: query.conversation_id,
            workspace_id: workspaceId,
        });

        if (!conversation || !isConversationMember(conversation, userId)) {
            return response.status(404).json(formatErrorMessage('Conversation not found'));
        }

        let criteria = { conversation_id: query.conversation_id };

        if (query.before) {
            const beforeMsg = await global.Message.findOne({ _id: query.before });
            if (beforeMsg) {
                criteria.createdAt = { '<': beforeMsg.createdAt };
            }
        }

        const messages = await global.Message.find(criteria)
            .sort('createdAt DESC')
            .limit(query.limit);

        messages.reverse();

        const enriched = await Promise.all(messages.map(enrichMessage));

        response.json(formatSuccessMessage('Messages fetched successfully', enriched));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
