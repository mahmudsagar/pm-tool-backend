import { getMessageSchema } from './config/validation.js';
import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichMessage } from '../utils/chatHelper.js';
import { loadMemberConversation, handleChatError } from '../utils/messageHelper.js';

const THREAD_REPLY_CAP = 1000;

/**
 * GET /v1/chat/message
 *   ?conversation_id=&before=<ISO | message id>&limit=1..100 (default 50)
 *       top-level messages, newest page before `before`, ascending. Array, or with page=1
 *       { messages, has_more }.
 *   ?conversation_id=&pinned=true   pinned messages (top-level and replies), newest pin first
 *   ?thread_id=<rootId>             { root, replies } (replies ascending)
 * Deleted messages are returned blanked with deleted_at set.
 */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = getMessageSchema.parse(request.query);

        if (query.thread_id) {
            const root = await global.Message.findOne({ _id: query.thread_id });
            if (!root) return response.status(404).json(formatErrorMessage('Thread not found'));
            const conversation = await loadMemberConversation(root.conversation_id, workspaceId, userId);
            if (query.conversation_id && query.conversation_id !== conversation._id) {
                return response.status(404).json(formatErrorMessage('Thread not found'));
            }
            if (root.parent_message_id) {
                return response.status(400).json(formatErrorMessage('thread_id must be a top-level message'));
            }
            const replies = await global.Message.find({ parent_message_id: root._id })
                .sort('createdAt ASC')
                .limit(THREAD_REPLY_CAP);
            const [enrichedRoot, enrichedReplies] = await Promise.all([
                enrichMessage(root),
                Promise.all(replies.map(enrichMessage)),
            ]);
            return response.json(formatSuccessMessage('Thread fetched successfully', { root: enrichedRoot, replies: enrichedReplies }));
        }

        const conversation = await loadMemberConversation(query.conversation_id, workspaceId, userId);

        if (query.pinned) {
            const pinned = await global.Message.find({ conversation_id: conversation._id, pinned: true, deleted_at: null })
                .sort('pinned_at DESC')
                .limit(query.limit);
            const enriched = await Promise.all(pinned.map(enrichMessage));
            return response.json(formatSuccessMessage('Pinned messages fetched successfully', enriched));
        }

        const criteria = { conversation_id: conversation._id, parent_message_id: null };

        if (query.before) {
            if (/^[0-9a-fA-F]{24}$/.test(query.before)) {
                const beforeMsg = await global.Message.findOne({ _id: query.before });
                if (beforeMsg && beforeMsg.conversation_id === conversation._id) {
                    criteria.createdAt = { '<': beforeMsg.createdAt };
                }
            } else {
                criteria.createdAt = { '<': new Date(query.before) };
            }
        }

        const messages = await global.Message.find(criteria)
            .sort('createdAt DESC')
            .limit(query.limit + 1);
        const hasMore = messages.length > query.limit;
        if (hasMore) messages.length = query.limit;

        messages.reverse();

        const enriched = await Promise.all(messages.map(enrichMessage));

        if (query.page) {
            return response.json(formatSuccessMessage('Messages fetched successfully', { messages: enriched, has_more: hasMore }));
        }
        response.json(formatSuccessMessage('Messages fetched successfully', enriched));
    } catch (err) {
        handleChatError(err, response);
    }
};
