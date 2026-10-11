import crypto from 'crypto';
import { putConversationSchema } from './config/validation.js';
import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { enrichConversation } from '../utils/chatHelper.js';
import { isWorkspaceAdmin, isWorkspaceMember, isMemberSuspended } from '../../utils/workspaceAccess.js';
import { collection, toObjectId } from '../../utils/boardTasks.js';
import { emitToConversation, emitToUser, removeUsersFromConversationRoom } from '../../utils/websocketService.js';
import { loadMemberConversation, handleChatError } from '../utils/messageHelper.js';

/**
 * PUT /v1/chat/conversation
 *   { id, name?, description?, topic?, pinned?, muted?, bookmarks?, add_members?, remove_members? }
 * pinned / muted: per-user, any member, for themselves. topic / bookmarks: any member.
 * name / description: creator or workspace owner / admin (not for DMs).
 * add_members / remove_members: creator or workspace owner / admin, group conversations only.
 */
export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = putConversationSchema.parse(request.body);

        const conversation = await loadMemberConversation(body.id, workspaceId, userId);
        const workspace = await global.Workspace.findOne({ _id: workspaceId });
        const isManager = conversation.created_by === userId || isWorkspaceAdmin(workspace, userId);

        const shared = {};
        const changes = [];
        let removed = [];
        let added = [];

        if (body.name !== undefined || body.description !== undefined) {
            if (conversation.type === 'dm') {
                return response.status(400).json(formatErrorMessage('A direct message has no name or description'));
            }
            if (!isManager) {
                return response.status(403).json(formatErrorMessage('Only the creator or a workspace admin can rename this conversation'));
            }
            if (body.name !== undefined) { shared.name = body.name; changes.push('name'); }
            if (body.description !== undefined) { shared.description = body.description; changes.push('description'); }
        }

        if (body.add_members !== undefined || body.remove_members !== undefined) {
            if (conversation.type !== 'group') {
                return response.status(400).json(formatErrorMessage(conversation.type === 'channel'
                    ? 'Channel members follow the space members'
                    : 'Members of a direct message cannot be changed'));
            }
            if (!isManager) {
                return response.status(403).json(formatErrorMessage('Only the creator or a workspace admin can change members'));
            }
            const current = conversation.members || [];
            added = [...new Set(body.add_members || [])].filter((id) => !current.includes(id));
            const invalid = added.filter((id) => !isWorkspaceMember(workspace, id) || isMemberSuspended(workspace, id));
            if (invalid.length > 0) {
                return response.status(400).json(formatErrorMessage('Members must be active members of this workspace'));
            }
            const removeSet = new Set(body.remove_members || []);
            removed = current.filter((id) => removeSet.has(id));
            const next = [...current.filter((id) => !removeSet.has(id)), ...added];
            if (next.length === 0) {
                return response.status(400).json(formatErrorMessage('A conversation needs at least one member'));
            }
            if (added.length || removed.length) {
                shared.members = next;
                changes.push('members');
            }
        }

        if (body.topic !== undefined) { shared.topic = body.topic; changes.push('topic'); }

        if (body.bookmarks !== undefined) {
            const ids = body.bookmarks.map((b) => b.id).filter(Boolean);
            if (new Set(ids).size !== ids.length) {
                return response.status(400).json(formatErrorMessage('Duplicate bookmark id'));
            }
            const existing = new Map((conversation.bookmarks || []).map((b) => [b.id, b]));
            const now = new Date().toISOString();
            shared.bookmarks = body.bookmarks.map((b) => {
                const prev = b.id ? existing.get(b.id) : null;
                return {
                    id: b.id || crypto.randomUUID(),
                    title: b.title,
                    url: b.url,
                    entity_type: b.entity_type || null,
                    entity_id: b.entity_id || null,
                    added_by: prev?.added_by || userId,
                    added_at: prev?.added_at || now,
                };
            });
            changes.push('bookmarks');
        }

        // Per-user flags are atomic array updates so concurrent toggles by others are kept.
        const personal = [];
        const ops = {};
        for (const [flag, field] of [['pinned', 'pinned_by'], ['muted', 'muted_by']]) {
            if (body[flag] === undefined) continue;
            personal.push(flag);
            if (body[flag]) (ops.$addToSet ||= {})[field] = userId;
            else (ops.$pull ||= {})[field] = userId;
        }
        if (personal.length) {
            await collection('conversation').updateOne({ _id: toObjectId(conversation._id) }, ops);
        }

        if (changes.length) {
            await global.Conversation.updateOne({ _id: conversation._id }).set(shared);
            emitToConversation(
                conversation._id,
                shared.members || conversation.members,
                'chat:conversation_updated',
                { conversation_id: conversation._id, changes },
                { extraUserIds: removed },
            );
            if (removed.length) removeUsersFromConversationRoom(conversation._id, removed);
        }
        if (personal.length) {
            emitToUser(userId, 'chat:conversation_updated', { conversation_id: conversation._id, changes: personal });
        }

        const fresh = await global.Conversation.findOne({ _id: conversation._id });
        const enriched = await enrichConversation(fresh, userId, { workspace });
        response.json(formatSuccessMessage('Conversation updated successfully', enriched));
    } catch (err) {
        handleChatError(err, response);
    }
};
