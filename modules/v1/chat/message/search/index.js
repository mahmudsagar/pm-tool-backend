import { searchMessageSchema } from '../config/validation.js';
import { formatSuccessMessage } from '../../../utils/success.js';
import { enrichMessage, resolveConversationAccess, conversationDisplayName } from '../../utils/chatHelper.js';
import { collection } from '../../../utils/boardTasks.js';
import { loadMemberConversation, handleChatError } from '../../utils/messageHelper.js';

const SEARCH_LIMIT = 50;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /v1/chat/message/search?q=&conversation_id= — case-insensitive match on the body of
 * non-deleted messages (top-level and replies) in conversations of this workspace the user is a
 * member of, newest first, max 50.
 */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const query = searchMessageSchema.parse(request.query);

        let conversations;
        if (query.conversation_id) {
            conversations = [await loadMemberConversation(query.conversation_id, workspaceId, userId)];
        } else {
            const workspace = await global.Workspace.findOne({ _id: workspaceId });
            conversations = (await Promise.all((await global.Conversation.find({ workspace_id: workspaceId }))
                .map((c) => resolveConversationAccess(c, userId, { workspace })))).filter(Boolean);
        }
        if (conversations.length === 0) {
            return response.json(formatSuccessMessage('Messages fetched successfully', []));
        }
        const byId = new Map(conversations.map((c) => [String(c._id), c]));

        const docs = await collection('message')
            .find({
                conversation_id: { $in: [...byId.keys()] },
                deleted_at: null,
                body: { $regex: escapeRegex(query.q), $options: 'i' },
            }, { projection: { _id: 1 } })
            .sort({ createdAt: -1 })
            .limit(SEARCH_LIMIT)
            .toArray();
        const ids = docs.map((d) => String(d._id));
        const messages = ids.length ? await global.Message.find({ _id: { in: ids } }) : [];
        const order = new Map(ids.map((id, i) => [id, i]));
        messages.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

        const names = new Map();
        const results = await Promise.all(messages.map(async (m) => {
            const conversation = byId.get(m.conversation_id);
            if (!names.has(conversation._id)) names.set(conversation._id, conversationDisplayName(conversation, userId));
            const enriched = await enrichMessage(m);
            return {
                ...enriched,
                conversation_id: conversation._id,
                conversation_type: conversation.type,
                conversation_name: await names.get(conversation._id),
            };
        }));

        response.json(formatSuccessMessage('Messages fetched successfully', results));
    } catch (err) {
        handleChatError(err, response);
    }
};
