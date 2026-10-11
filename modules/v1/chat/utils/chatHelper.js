/**
 * Chat helper utilities — access control, member resolution, DM lookup
 */
import {
    isWorkspaceMember, isWorkspaceOwner, isMemberSuspended, getMemberEntry,
} from '../../utils/workspaceAccess.js';
import { collection } from '../../utils/boardTasks.js';

export async function getSpaceMemberIds(spaceId) {
    const space = await global.Space.findOne({ _id: spaceId });
    if (!space) return [];

    const memberIds = new Set();
    if (space.user_id) memberIds.add(space.user_id);

    for (const memberAccess of (space.shared_members || [])) {
        const memberId = typeof memberAccess === 'string' ? memberAccess : memberAccess.user_id;
        if (memberId) memberIds.add(memberId);
    }

    for (const teamAccess of (space.shared_teams || [])) {
        const teamId = typeof teamAccess === 'string' ? teamAccess : teamAccess.team_id;
        const team = await global.Team.findOne({ _id: teamId });
        if (!team) continue;
        if (team.user_id) memberIds.add(team.user_id);
        for (const m of (team.shared_members || [])) {
            memberIds.add(m);
        }
    }

    return Array.from(memberIds);
}

export function isConversationMember(conversation, userId) {
    return (conversation.members || []).includes(userId);
}

/**
 * Same rule as GET /v1/chat/conversation?id= (member of the conversation) plus an active,
 * non-suspended membership of the conversation's workspace (what the HTTP middleware enforces).
 * Returns the conversation or null.
 */
export async function canUserJoinConversation(conversationId, userId) {
    const conversation = await global.Conversation.findOne({ _id: String(conversationId) });
    if (!conversation || !isConversationMember(conversation, String(userId))) return null;
    const workspace = await global.Workspace.findOne({ _id: conversation.workspace_id });
    if (!workspace || !isWorkspaceMember(workspace, userId) || isMemberSuspended(workspace, userId)) return null;
    return conversation;
}

/** Workspace role of a user: 'owner' | 'admin' | 'member' | 'guest', or null when not a member. */
export function getWorkspaceRole(workspace, userId) {
    if (!workspace) return null;
    if (isWorkspaceOwner(workspace, userId)) return 'owner';
    if (!isWorkspaceMember(workspace, userId)) return null;
    const role = getMemberEntry(workspace, userId)?.role;
    return ['admin', 'member', 'guest'].includes(role) ? role : 'member';
}

/** Native filter for top-level messages (legacy rows have no parent_message_id). */
export const TOP_LEVEL = { $in: [null, ''] };

/** Per-user chat state of a conversation: unread / mention / pinned message counts and flags. */
export async function conversationUserState(conversation, userId) {
    const readState = conversation.read_state && typeof conversation.read_state === 'object' ? conversation.read_state : {};
    const lastRead = readState[userId] ? new Date(readState[userId]) : null;
    const unreadFilter = {
        conversation_id: String(conversation._id),
        sender_id: { $ne: String(userId) },
        deleted_at: null,
        ...(lastRead && !Number.isNaN(lastRead.getTime()) ? { createdAt: { $gt: lastRead } } : {}),
    };
    const messages = collection('message');
    const [unreadCount, mentionCount, pinnedCount] = await Promise.all([
        messages.countDocuments({ ...unreadFilter, parent_message_id: TOP_LEVEL }),
        messages.countDocuments({ ...unreadFilter, mentions: String(userId) }),
        messages.countDocuments({ conversation_id: String(conversation._id), pinned: true, deleted_at: null }),
    ]);
    return {
        unread_count: unreadCount,
        mention_count: mentionCount,
        pinned_count: pinnedCount,
        pinned: (conversation.pinned_by || []).includes(userId),
        muted: (conversation.muted_by || []).includes(userId),
    };
}

/**
 * Adds displayName, memberDetails (with workspace role and profile title), spaceInfo and the
 * current user's state. `ctx.workspace` avoids reloading the workspace for every conversation.
 */
export async function enrichConversation(conversation, currentUserId, ctx = {}) {
    const workspace = ctx.workspace !== undefined
        ? ctx.workspace
        : await global.Workspace.findOne({ _id: conversation.workspace_id });

    const members = await Promise.all(
        (conversation.members || []).map(async (memberId) => {
            const user = await global.User.findOne({ _id: memberId });
            if (!user) return null;
            const { password: _, ...userInfo } = user;
            let avatarUrl = user.avatar || '';
            if (!avatarUrl && user.attachments?.length > 0) {
                const media = await global.Media.findOne({ _id: user.attachments[0] });
                avatarUrl = media?.url || '';
            }
            return { ...userInfo, avatarUrl, role: getWorkspaceRole(workspace, memberId), title: user.title || null };
        })
    );

    let spaceInfo = null;
    if (conversation.space_id) {
        const space = await global.Space.findOne({ _id: conversation.space_id });
        if (space) {
            spaceInfo = { _id: space._id, name: space.name, icon: space.icon, color: space.color };
        }
    }

    let displayName = conversation.name;
    if (conversation.type === 'dm') {
        const other = members.filter(Boolean).find(m => m._id !== currentUserId);
        displayName = other?.name || 'Direct Message';
    }

    const { pinned_by: _p, muted_by: _m, ...rest } = conversation;
    const state = await conversationUserState(conversation, currentUserId);

    return {
        ...rest,
        read_state: conversation.read_state || {},
        bookmarks: Array.isArray(conversation.bookmarks) ? conversation.bookmarks : [],
        topic: conversation.topic || '',
        displayName,
        memberDetails: members.filter(Boolean),
        spaceInfo,
        ...state,
    };
}

/** Display name without loading every member (DM → the other member's name). */
export async function conversationDisplayName(conversation, currentUserId) {
    if (conversation.type !== 'dm') return conversation.name || '';
    const otherId = (conversation.members || []).find((m) => m !== currentUserId);
    const other = otherId ? await global.User.findOne({ _id: otherId }) : null;
    return other?.name || 'Direct Message';
}

/** Fills the phase-6 message fields for legacy rows and blanks deleted messages. */
export function normalizeMessage(message) {
    const deleted = !!message.deleted_at;
    return {
        ...message,
        parent_message_id: message.parent_message_id || null,
        reply_count: message.reply_count || 0,
        last_reply_at: message.last_reply_at || null,
        reply_user_ids: Array.isArray(message.reply_user_ids) ? message.reply_user_ids : [],
        reactions: deleted ? [] : (Array.isArray(message.reactions) ? message.reactions : []),
        edited_at: message.edited_at || null,
        deleted_at: message.deleted_at || null,
        deleted_by: message.deleted_by || null,
        pinned: !deleted && message.pinned === true,
        pinned_by: message.pinned_by || null,
        pinned_at: message.pinned_at || null,
        ...(deleted ? { body: '', content: '', mentions: [], attachments: [], entity_refs: [] } : {}),
    };
}

export async function enrichMessage(rawMessage) {
    const message = normalizeMessage(rawMessage);
    const user = await global.User.findOne({ _id: message.sender_id });
    let avatarUrl = user?.avatar || '';
    if (!avatarUrl && user?.attachments?.length > 0) {
        const media = await global.Media.findOne({ _id: user.attachments[0] });
        avatarUrl = media?.url || '';
    }

    const mediaAttachments = await Promise.all(
        (message.attachments || []).map(async (mediaId) => {
            return await global.Media.findOne({ _id: mediaId });
        })
    );

    const entityRefs = await Promise.all(
        (message.entity_refs || []).map(async (ref) => {
            if (ref.title && ref.url) return ref;
            const page = await global.PageMeta.findOne({ _id: ref.id });
            if (!page) return ref;
            const board = page.board_id ? await global.Board.findOne({ _id: page.board_id }) : null;
            const isScrum = board?.custom_meta?.board_kind === 'scrum';
            return {
                ...ref,
                title: ref.title || page.title,
                url: ref.url || `/document/${page._id}`,
                board_id: ref.board_id || page.board_id,
                board_name: ref.board_name || board?.name || '',
                status: ref.status || page.custom_meta?.values?.status || '',
                board_kind: isScrum ? 'scrum' : 'board',
                board_url: board ? (isScrum ? `/scrum/${board._id}` : `/board/${board._id}`) : '',
            };
        })
    );

    return {
        ...message,
        senderInfo: user ? { _id: user._id, name: user.name, avatarUrl } : null,
        mediaAttachments: mediaAttachments.filter(Boolean),
        entity_refs: entityRefs.filter(Boolean),
    };
}

export async function findExistingDM(workspaceId, userId1, userId2) {
    const conversations = await global.Conversation.find({
        workspace_id: workspaceId,
        type: 'dm',
    });

    return conversations.find(c => {
        const members = c.members || [];
        return members.includes(userId1) && members.includes(userId2) && members.length === 2;
    }) || null;
}
