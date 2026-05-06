import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Check if a user can access an entity based on ownership, sharing, and workspace membership.
 *
 * Access rules:
 *  - Owner always has access
 *  - If entity has explicit shared_members or shared_teams → only those have access
 *  - If entity is public (is_private !== true) with NO sharing restrictions → all workspace members have access
 */
export const canUserAccessEntity = async (entity, userId, workspaceId = null) => {
    if (!entity) return false;
    const uid = String(userId || '');
    const normalizeId = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') {
            return String(value.user_id || value.team_id || value._id || value.id || '');
        }
        return String(value);
    };
    const includesUser = (arr = [], targetUserId) =>
        Array.isArray(arr) && arr.some((entry) => normalizeId(entry) === String(targetUserId));

    // Entity must belong to the current workspace context
    if (workspaceId && entity.workspace_id && entity.workspace_id !== workspaceId) return false;

    // Owner always has access
    if (String(entity.user_id || '') === uid) return true;

    const hasSharedMembers = entity.shared_members && entity.shared_members.length > 0;
    const hasSharedTeams = entity.shared_teams && entity.shared_teams.length > 0;
    const isPrivate = entity.is_private === true;

    // Public spaces with no restrictions → all workspace members have access
    if (!isPrivate && (!hasSharedMembers && !hasSharedTeams) && entity.workspace_id) {
        const workspace = await global.Workspace.findOne({ _id: entity.workspace_id });
        if (workspace && (String(workspace.owner_id || '') === uid || includesUser(workspace.members, uid))) {
            return true;
        }
    }

    // Explicitly shared to specific members/teams — user must also be in this workspace
    if (hasSharedMembers || hasSharedTeams) {
        // Confirm user is a member of the entity's workspace
        const workspace = await global.Workspace.findOne({ _id: entity.workspace_id });
        if (!workspace || (String(workspace.owner_id || '') !== uid && !includesUser(workspace.members, uid))) {
            return false;
        }

        if (hasSharedMembers) {
            // Handle both legacy (object with user_id/role) and new (string array) formats
            const isMemberShared = entity.shared_members.some(member =>
                normalizeId(member) === uid
            );
            if (isMemberShared) return true;
        }

        if (hasSharedTeams) {
            const userTeams = await global.Team.find({ workspace_id: entity.workspace_id });
            for (const team of userTeams) {
                // Handle both legacy (object with team_id/role) and new (string array) formats
                const isTeamShared = entity.shared_teams.some(t =>
                    normalizeId(t) === String(team._id || '')
                );
                if (isTeamShared &&
                    (String(team.user_id || '') === uid || includesUser(team.shared_members, uid))) {
                    return true;
                }
            }
        }
        return false;
    }

    // Public with no sharing restrictions → all workspace members have access
    if (!isPrivate && entity.workspace_id) {
        const workspace = await global.Workspace.findOne({ _id: entity.workspace_id });
        if (workspace && (String(workspace.owner_id || '') === uid || includesUser(workspace.members, uid))) {
            return true;
        }
    }

    return false;
};

/**
 * Get the effective allowed members/teams set from a parent entity.
 * Returns null if there are no restrictions (open to all workspace members).
 * Returns { members: [...], teams: [...] } if restricted.
 */
export const getParentSharingRestrictions = async (parentType, parentId) => {
    if (!parentId) return null;

    let parent;
    if (parentType === 'space') parent = await global.Space.findOne({ _id: parentId });
    else if (parentType === 'group') parent = await global.Group.findOne({ _id: parentId });
    else if (parentType === 'folder') parent = await global.Folder.findOne({ _id: parentId });
    else if (parentType === 'board') parent = await global.Board.findOne({ _id: parentId });

    if (!parent) return null;

    const hasRestrictions =
        (parent.shared_members && parent.shared_members.length > 0) ||
        (parent.shared_teams && parent.shared_teams.length > 0) ||
        parent.is_private === true;

    if (!hasRestrictions) return null;

    return {
        owner: parent.user_id,
        members: parent.shared_members || [],
        teams: parent.shared_teams || [],
        is_private: parent.is_private,
    };
};

/**
 * Validate that a child entity's sharing does not exceed the parent's restrictions.
 * Throws an error string if validation fails.
 */
export const validateChildSharing = async (parentType, parentId, childSharedMembers = [], childSharedTeams = []) => {
    const restrictions = await getParentSharingRestrictions(parentType, parentId);
    if (!restrictions) return; // No parent restrictions — anything is allowed

    const allowedMembers = new Set([restrictions.owner, ...restrictions.members]);
    for (const memberId of childSharedMembers) {
        if (!allowedMembers.has(memberId)) {
            throw new Error(`Cannot share with member ${memberId}: they are not in the parent ${parentType}'s allowed members`);
        }
    }

    const allowedTeams = new Set(restrictions.teams);
    for (const teamId of childSharedTeams) {
        if (!allowedTeams.has(teamId)) {
            throw new Error(`Cannot share with team ${teamId}: it is not in the parent ${parentType}'s allowed teams`);
        }
    }
};

/**
 * Get a user's role in an entity (separate from access control)
 * @param {Object} entity - The entity (space, board, etc.)
 * @param {string} userId - The user ID
 * @returns {string|null} Role ('manager', 'contributor', 'viewer') or null if not assigned
 */
export const getUserRoleInEntity = (entity, userId) => {
    // Check owner always has implicit manager role
    if (entity.user_id === userId) return 'manager';
    
    // Check member_roles field (new format)
    if (entity.member_roles && entity.member_roles[userId]) {
        return entity.member_roles[userId];
    }
    
    // Fallback: check legacy shared_members format [{ user_id, role }]
    if (entity.shared_members && Array.isArray(entity.shared_members)) {
        const member = entity.shared_members.find(m => typeof m === 'object' && m.user_id === userId);
        if (member) return member.role;
    }
    
    return null;
};

/**
 * Normalize sharing data: separate access (user/team IDs) from roles
 * Converts old format [{ user_id, role }] to new format where:
 * - shared_members: [user_id, ...] (just IDs)
 * - member_roles: { user_id: role, ... }
 */
export const normalizeEntitySharing = (entity) => {
    const normalized = { ...entity };
    
    // Normalize shared_members
    if (entity.shared_members && Array.isArray(entity.shared_members)) {
        const memberIds = [];
        const memberRoles = entity.member_roles ? { ...entity.member_roles } : {};
        
        for (const member of entity.shared_members) {
            if (typeof member === 'string') {
                // Already in new format (just ID)
                memberIds.push(member);
            } else if (typeof member === 'object' && member.user_id) {
                // Old format: { user_id, role }
                memberIds.push(member.user_id);
                if (member.role) {
                    memberRoles[member.user_id] = member.role;
                }
            }
        }
        
        normalized.shared_members = memberIds;
        normalized.member_roles = memberRoles;
    }
    
    // Normalize shared_teams
    if (entity.shared_teams && Array.isArray(entity.shared_teams)) {
        const teamIds = [];
        const teamRoles = entity.team_roles ? { ...entity.team_roles } : {};
        
        for (const team of entity.shared_teams) {
            if (typeof team === 'string') {
                // Already in new format (just ID)
                teamIds.push(team);
            } else if (typeof team === 'object' && team.team_id) {
                // Old format: { team_id, role }
                teamIds.push(team.team_id);
                if (team.role) {
                    teamRoles[team.team_id] = team.role;
                }
            }
        }
        
        normalized.shared_teams = teamIds;
        normalized.team_roles = teamRoles;
    }
    
    return normalized;
};

// Configure S3 client for R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

export const buildCommentWithUserInfo = async (commentMeta) => {
    const user = await global.User.findOne({ _id: commentMeta.user_id });
    const userMediaAttachments = user && Array.isArray(user.attachments)
        ? await Promise.all(user.attachments.map(id => global.Media.findOne({ _id: id })))
        : [];
    const commentContent = await global.CommentContent.findOne({ _id: commentMeta.associate_id });
    const mediaAttachments = commentMeta.attachments && commentMeta.attachments.length > 0
        ? await Promise.all(commentMeta.attachments.map(id => global.Media.findOne({ _id: id })))
        : [];
    return {
        ...commentMeta,
        userInfo: {
            _id: user?._id,
            name: user?.name,
            email: user?.email,
            url: userMediaAttachments?.length > 0 ? userMediaAttachments[0]?.url : ''
        },
        commentContent,
        mediaAttachments
    };
};

export const deleteAttachments = async (attachments) => {
    for (const attachmentId of attachments) {
        // Find the media by _id
        const media = await global.Media.findOne({ _id: attachmentId });
        if (!media) {
            continue; // Skip if media not found
        }

        // Delete the image from R2
        const urlParts = media.url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const deleteParams = {
            Bucket: process.env.R2_BUCKET,
            Key: fileName,
        };

        await s3Client.send(new DeleteObjectCommand(deleteParams));

        // Delete the data by _id from MongoDB
        await global.Media.destroyOne({ _id: attachmentId });
    }
};

export const deleteCommentAndChildren = async (commentId) => {
    const commentMeta = await global.CommentMeta.findOne({ _id: commentId });
    if (!commentMeta) {
        throw new Error('Comment not found');
    }

    if (commentMeta.attachments && commentMeta.attachments.length > 0) {
        await deleteAttachments(commentMeta.attachments);
    }

    await global.CommentMeta.destroy({ _id: commentId });
    await global.CommentContent.destroyOne({ _id: commentMeta.associate_id });

    const childCommentMetas = await global.CommentMeta.find({ parent_id: commentId });
    for (const childCommentMeta of childCommentMetas) {
        await deleteCommentAndChildren(childCommentMeta._id);
    }
};

export const deleteFolderAndChildren = async (folderId) => {
    const childFolders = await global.Folder.find({ parent_id: folderId });
    for (const childFolder of childFolders) {
        await deleteFolderAndChildren(childFolder._id);
    }

    const pageMetas = await global.PageMeta.find({ folder_id: folderId });
    for (const pageMeta of pageMetas) {
        await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });

        if (pageMeta.attachments && pageMeta.attachments.length > 0) {
            await deleteAttachments(pageMeta.attachments);
        }

        const commentMetas = await global.CommentMeta.find({ page_id: pageMeta._id });
        for (const commentMeta of commentMetas) {
            await deleteCommentAndChildren(commentMeta._id);
        }

        await global.PageMeta.destroyOne({ _id: pageMeta._id });
    }

    await global.Folder.destroyOne({ _id: folderId });
};

export const deleteGroupFolderAndChildren = async (groupId) => {
    const childFolders = await global.Folder.find({ group_id: groupId });
    for (const childFolder of childFolders) {
        await deleteFolderAndChildren(childFolder._id);
    }

    const pageMetas = await global.PageMeta.find({ group_id: groupId });
    for (const pageMeta of pageMetas) {
        await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });

        if (pageMeta.attachments && pageMeta.attachments.length > 0) {
            await deleteAttachments(pageMeta.attachments);
        }

        const commentMetas = await global.CommentMeta.find({ page_id: pageMeta._id });
        for (const commentMeta of commentMetas) {
            await deleteCommentAndChildren(commentMeta._id);
        }

        await global.PageMeta.destroyOne({ _id: pageMeta._id });
    }

    await global.Folder.destroyOne({ group_id: groupId });
};

export const deleteBoardAndChildren = async (boardId) => {
    const pageMetas = await global.PageMeta.find({ board_id: boardId });
    for (const pageMeta of pageMetas) {
        await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });

        if (pageMeta.attachments && pageMeta.attachments.length > 0) {
            await deleteAttachments(pageMeta.attachments);
        }

        const commentMetas = await global.CommentMeta.find({ page_id: pageMeta._id });
        for (const commentMeta of commentMetas) {
            await deleteCommentAndChildren(commentMeta._id);
        }

        await global.PageMeta.destroyOne({ _id: pageMeta._id });
    }

    await global.Board.destroyOne({ _id: boardId });
};