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

    // Entity must belong to the current workspace context
    if (workspaceId && entity.workspace_id && entity.workspace_id !== workspaceId) return false;

    // Owner always has access
    if (entity.user_id === userId) return true;

    const hasSharedMembers = entity.shared_members && entity.shared_members.length > 0;
    const hasSharedTeams = entity.shared_teams && entity.shared_teams.length > 0;
    const isPrivate = entity.is_private === true;

    // Explicitly shared to specific members/teams — user must also be in this workspace
    if (hasSharedMembers || hasSharedTeams) {
        // Confirm user is a member of the entity's workspace
        const workspace = await global.Workspace.findOne({ _id: entity.workspace_id });
        if (!workspace || (workspace.owner_id !== userId && !(workspace.members && workspace.members.includes(userId)))) {
            return false;
        }

        if (hasSharedMembers && entity.shared_members.includes(userId)) return true;

        if (hasSharedTeams) {
            const userTeams = await global.Team.find({ workspace_id: entity.workspace_id });
            for (const team of userTeams) {
                if (entity.shared_teams.includes(team._id) &&
                    (team.user_id === userId || (team.shared_members && team.shared_members.includes(userId)))) {
                    return true;
                }
            }
        }
        return false;
    }

    // Public with no sharing restrictions → all workspace members have access
    if (!isPrivate && entity.workspace_id) {
        const workspace = await global.Workspace.findOne({ _id: entity.workspace_id });
        if (workspace && (workspace.owner_id === userId || (workspace.members && workspace.members.includes(userId)))) {
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

// Configure S3 client for R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

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