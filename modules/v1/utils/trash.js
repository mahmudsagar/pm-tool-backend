import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Trash = snapshot-on-delete.
 *
 * Before a delete handler removes anything, it calls one of the `snapshot*` collectors below,
 * which walk exactly the same rows the handler (or the helper.js cascade it uses) is about to
 * destroy, and then `createTrashItem` stores them as
 *   snapshot: { [collectionIdentity]: [row, ...] }
 * Restore re-inserts every row with its original _id. Read queries elsewhere are unchanged.
 *
 * Keep the collectors in sync with the delete code in helper.js and the *deleteRequest.js files.
 */

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Collection identity -> global model name. Restore order: parents before children.
const COLLECTIONS = [
    ['space', 'Space'],
    ['group', 'Group'],
    ['folder', 'Folder'],
    ['board', 'Board'],
    ['page_content', 'PageContent'],
    ['page_meta', 'PageMeta'],
    ['comment_content', 'CommentContent'],
    ['comment_meta', 'CommentMeta'],
    ['media', 'Media'],
];
const modelByIdentity = (identity) => {
    const entry = COLLECTIONS.find(([id]) => id === identity);
    return entry ? global[entry[1]] : null;
};

// Root entity type -> collection identity of its row.
const ROOT_IDENTITY = { space: 'space', group: 'group', folder: 'folder', board: 'board', page: 'page_meta' };

// Identities that count as user-visible items for `item_count`.
const ITEM_IDENTITIES = ['space', 'group', 'folder', 'board', 'page_meta'];

/** Accumulates rows per collection, de-duplicated by _id. */
export class Snapshot {
    constructor() {
        this.rows = {};
        this.seen = new Set();
    }

    add(identity, row) {
        if (!row || !row._id) return;
        const key = `${identity}:${row._id}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        (this.rows[identity] = this.rows[identity] || []).push(row);
    }

    toJSON() {
        return this.rows;
    }
}

// ---------------------------------------------------------------------------------------------
// Collectors (mirror the delete cascades)
// ---------------------------------------------------------------------------------------------

const collectMedia = async (snap, attachmentIds) => {
    for (const id of attachmentIds || []) {
        const media = await global.Media.findOne({ _id: id });
        if (media) snap.add('media', media);
    }
};

const collectCommentRow = async (snap, commentMeta) => {
    snap.add('comment_meta', commentMeta);
    await collectMedia(snap, commentMeta.attachments);
    if (commentMeta.associate_id) {
        const content = await global.CommentContent.findOne({ _id: commentMeta.associate_id });
        if (content) snap.add('comment_content', content);
    }
};

// Mirrors helper.deleteCommentAndChildren (recursive by parent_id).
const collectCommentTree = async (snap, commentMeta, depth = 0) => {
    await collectCommentRow(snap, commentMeta);
    if (depth > 50) return;
    const children = await global.CommentMeta.find({ parent_id: commentMeta._id });
    for (const child of children) {
        await collectCommentTree(snap, child, depth + 1);
    }
};

// Mirrors the per-page part of helper.deleteFolderAndChildren / deleteGroupFolderAndChildren /
// deleteBoardAndChildren: page content, attachments, comments (recursive), page meta.
const collectPageForHelper = async (snap, pageMeta) => {
    snap.add('page_meta', pageMeta);
    const content = await global.PageContent.findOne({ _id: pageMeta.page_content_id });
    if (content) snap.add('page_content', content);
    await collectMedia(snap, pageMeta.attachments);
    const comments = await global.CommentMeta.find({ page_id: pageMeta._id });
    for (const comment of comments) {
        await collectCommentTree(snap, comment);
    }
};

// Mirrors helper.deleteFolderAndChildren.
const collectFolderTree = async (snap, folderId, depth = 0) => {
    if (depth > 50) return;
    const childFolders = await global.Folder.find({ parent_id: folderId });
    for (const child of childFolders) {
        await collectFolderTree(snap, child._id, depth + 1);
    }
    const pages = await global.PageMeta.find({ folder_id: folderId });
    for (const page of pages) {
        await collectPageForHelper(snap, page);
    }
    const folder = await global.Folder.findOne({ _id: folderId });
    if (folder) snap.add('folder', folder);
};

/** Snapshot for folder/deleteRequest.js (helper.deleteFolderAndChildren). */
export const snapshotFolder = async (folderId) => {
    const snap = new Snapshot();
    await collectFolderTree(snap, folderId);
    return snap;
};

/** Snapshot for group/deleteRequest.js (helper.deleteGroupFolderAndChildren + Group.destroyOne). */
export const snapshotGroup = async (groupId) => {
    const snap = new Snapshot();
    const group = await global.Group.findOne({ _id: groupId });
    if (group) snap.add('group', group);
    const folders = await global.Folder.find({ group_id: groupId });
    for (const folder of folders) {
        await collectFolderTree(snap, folder._id);
    }
    const pages = await global.PageMeta.find({ group_id: groupId });
    for (const page of pages) {
        await collectPageForHelper(snap, page);
    }
    return snap;
};

/** Snapshot for board/deleteRequest.js (helper.deleteBoardAndChildren). */
export const snapshotBoard = async (boardId) => {
    const snap = new Snapshot();
    const board = await global.Board.findOne({ _id: boardId });
    if (board) snap.add('board', board);
    const pages = await global.PageMeta.find({ board_id: boardId });
    for (const page of pages) {
        await collectPageForHelper(snap, page);
    }
    return snap;
};

/**
 * Snapshot for page/document/deleteRequest.js: page meta, page content, page attachments,
 * comments with page_id = page and their direct children (one level, as that handler does).
 */
export const snapshotPage = async (pageId) => {
    const snap = new Snapshot();
    const pageMeta = await global.PageMeta.findOne({ _id: pageId });
    if (!pageMeta) return snap;
    snap.add('page_meta', pageMeta);
    await collectMedia(snap, pageMeta.attachments);
    const content = await global.PageContent.findOne({ _id: pageMeta.page_content_id });
    if (content) snap.add('page_content', content);
    const comments = await global.CommentMeta.find({ page_id: pageId });
    for (const comment of comments) {
        await collectCommentRow(snap, comment);
        if (comment.has_childs) {
            const children = await global.CommentMeta.find({ parent_id: comment._id });
            for (const child of children) {
                await collectCommentRow(snap, child);
            }
        }
    }
    return snap;
};

/**
 * Snapshot for board/tasks/deleteRequest.js: a board task and all its subtasks (recursively),
 * each collected like snapshotPage.
 */
export const snapshotTaskTree = async (taskId) => {
    const snap = new Snapshot();
    const pages = [];
    const visit = async (id, depth = 0) => {
        if (depth > 50) return;
        const page = await global.PageMeta.findOne({ _id: id });
        if (!page) return;
        pages.push(page);
        const part = await snapshotPage(id);
        for (const [identity, rows] of Object.entries(part.toJSON())) {
            for (const row of rows) snap.add(identity, row);
        }
        const children = await global.PageMeta.find({ parent_id: String(id), board_id: page.board_id || '' });
        for (const child of children) await visit(child._id, depth + 1);
    };
    await visit(taskId);
    return { snapshot: snap, pages };
};

/** Snapshot for space/deleteRequest.js — that handler only destroys the space row itself. */
export const snapshotSpace = async (spaceOrId) => {
    const snap = new Snapshot();
    const space = typeof spaceOrId === 'object' ? spaceOrId : await global.Space.findOne({ _id: spaceOrId });
    if (space) snap.add('space', space);
    return snap;
};

// ---------------------------------------------------------------------------------------------
// Trash item lifecycle
// ---------------------------------------------------------------------------------------------

const PARENT_FIELDS = ['space_id', 'folder_id', 'group_id', 'parent_id', 'board_id'];

/** Walk up the parent chain to find the space an entity ultimately lives in. */
export const resolveSpaceId = async (entityType, row, depth = 0) => {
    if (!row || depth > 50) return '';
    if (entityType === 'space') return row._id;
    if (row.space_id) return row.space_id;
    if (row.group_id) {
        const group = await global.Group.findOne({ _id: row.group_id });
        if (group?.space_id) return group.space_id;
    }
    if (entityType === 'folder' && row.parent_id) {
        return resolveSpaceId('folder', await global.Folder.findOne({ _id: row.parent_id }), depth + 1);
    }
    if (row.folder_id) {
        return resolveSpaceId('folder', await global.Folder.findOne({ _id: row.folder_id }), depth + 1);
    }
    if (row.board_id) {
        return resolveSpaceId('board', await global.Board.findOne({ _id: row.board_id }), depth + 1);
    }
    if (entityType === 'page' && row.parent_id) {
        return resolveSpaceId('page', await global.PageMeta.findOne({ _id: row.parent_id }), depth + 1);
    }
    return '';
};

export const countSnapshotItems = (snapshot) =>
    ITEM_IDENTITIES.reduce((total, identity) => total + ((snapshot?.[identity] || []).length), 0);

/**
 * Create the trash item for a root entity. Call BEFORE the delete runs.
 * Never throws: a trash failure must not block the user's delete (it is logged instead).
 */
export const createTrashItem = async ({ entityType, entityId, snapshot, userId, workspaceId }) => {
    try {
        const rows = snapshot instanceof Snapshot ? snapshot.toJSON() : snapshot;
        const root = (rows[ROOT_IDENTITY[entityType]] || []).find((r) => String(r._id) === String(entityId));
        if (!root) return null;

        const parent = {};
        for (const field of PARENT_FIELDS) parent[field] = root[field] || '';
        // Folders store their parent folder in parent_id.
        if (entityType === 'folder') parent.folder_id = '';
        if (entityType === 'space') parent.space_id = '';
        // The space the entity ultimately lives in (used to restore to the space root).
        parent.root_space_id = entityType === 'space' ? '' : await resolveSpaceId(entityType, root);

        const deletedAt = new Date();
        return await global.TrashItem.create({
            workspace_id: workspaceId || root.workspace_id || '',
            deleted_by: userId,
            deleted_at: deletedAt,
            expires_at: new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS),
            entity_type: entityType,
            entity_id: String(entityId),
            name: (entityType === 'page' ? root.title : root.name) || '',
            page_type: entityType === 'page' ? (root.page_type || null) : null,
            parent,
            snapshot: rows,
        }).fetch();
    } catch (err) {
        console.error(`Failed to create trash item for ${entityType} ${entityId}:`, err.message);
        return null;
    }
};

const DATE_FIELDS = ['createdAt', 'updatedAt'];

/** Insert a snapshot row, skipping it if a row with the same _id already exists. */
const reinsertRow = async (Model, row) => {
    const existing = await Model.findOne({ _id: row._id });
    if (existing) return false;
    const known = Object.keys(Model.attributes);
    const values = {};
    for (const key of known) {
        if (row[key] === undefined) continue;
        values[key] = row[key];
    }
    // Dates may come back from the json snapshot as strings; store them as Dates like the originals.
    for (const field of DATE_FIELDS) {
        if (typeof values[field] === 'string' && !Number.isNaN(Date.parse(values[field]))) {
            values[field] = new Date(values[field]);
        }
    }
    await Model.create(values);
    return true;
};

const parentExists = async (entityType, parent) => {
    const checks = [];
    if (parent.space_id) checks.push(['space', parent.space_id]);
    if (parent.group_id) checks.push(['group', parent.group_id]);
    if (parent.board_id) checks.push(['board', parent.board_id]);
    if (parent.folder_id) checks.push(['folder', parent.folder_id]);
    if (parent.parent_id) checks.push([entityType === 'folder' ? 'folder' : 'page', parent.parent_id]);
    for (const [identity, id] of checks) {
        const Model = identity === 'page' ? global.PageMeta : modelByIdentity(identity);
        if (!(await Model.findOne({ _id: id }))) return false;
    }
    return true;
};

// Fields to clear when moving a root row to the root of its space.
const DETACH_FIELDS = {
    folder: ['parent_id', 'group_id'],
    board: ['folder_id', 'group_id'],
    page: ['folder_id', 'group_id', 'board_id', 'parent_id'],
};

export class RestoreError extends Error {
    constructor(message, status = 409) {
        super(message);
        this.status = status;
    }
}

/**
 * Re-insert every snapshot row (original _ids; existing ids are skipped) and delete the trash item.
 * If the original parent is gone, the root entity is re-attached to the root of its space.
 */
export const restoreTrashItem = async (trashItem) => {
    const { entity_type: entityType, entity_id: entityId } = trashItem;
    const snapshot = trashItem.snapshot || {};
    const parent = trashItem.parent || {};
    const rootIdentity = ROOT_IDENTITY[entityType];

    let restoredTo = 'original';
    let rootOverrides = null;
    if (entityType !== 'space' && !(await parentExists(entityType, parent))) {
        const spaceId = parent.root_space_id || parent.space_id;
        const space = spaceId ? await global.Space.findOne({ _id: spaceId }) : null;
        if (!space || entityType === 'group') {
            throw new RestoreError(space
                ? 'The original parent no longer exists'
                : 'The space this item belonged to no longer exists. Restore the space first.');
        }
        rootOverrides = { space_id: spaceId };
        for (const field of DETACH_FIELDS[entityType] || []) rootOverrides[field] = '';
        restoredTo = 'space_root';
    }

    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    for (const [identity] of COLLECTIONS) {
        const Model = modelByIdentity(identity);
        for (const row of snapshot[identity] || []) {
            const isRoot = identity === rootIdentity && String(row._id) === String(entityId);
            const values = isRoot && rootOverrides ? { ...row, ...rootOverrides } : row;
            try {
                if (await reinsertRow(Model, values)) inserted += 1;
                else skipped += 1;
            } catch (err) {
                failed += 1;
                console.error(`Trash restore: failed to reinsert ${identity} ${row._id}:`, err.message);
            }
        }
    }

    if (failed > 0) {
        // Keep the trash item so the restore can be retried (already restored rows are skipped).
        throw new RestoreError(`Restore incomplete: ${failed} row(s) could not be restored`, 500);
    }

    await global.TrashItem.destroyOne({ _id: trashItem._id });
    return { entity_type: entityType, entity_id: entityId, restored_to: restoredTo, inserted, skipped, failed };
};

// R2 objects of trashed media are kept until the trash item is purged, so restores keep working.
let s3Client = null;
const getS3Client = () => {
    if (!s3Client) {
        s3Client = new S3Client({
            region: 'auto',
            endpoint: process.env.R2_ENDPOINT,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
    }
    return s3Client;
};

const deleteMediaFiles = async (mediaRows) => {
    for (const media of mediaRows || []) {
        if (!media?.url) continue;
        // Skip files whose media row was re-created (e.g. restored by another trash item).
        if (await global.Media.findOne({ _id: media._id })) continue;
        try {
            const urlParts = media.url.split('/');
            await getS3Client().send(new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: urlParts[urlParts.length - 1],
            }));
        } catch (err) {
            console.error(`Trash purge: failed to delete file for media ${media._id}:`, err.message);
        }
    }
};

/** Permanently delete trash items (and the stored files of their media). */
export const purgeTrashItems = async (items) => {
    for (const item of items) {
        await deleteMediaFiles(item.snapshot?.media);
        await global.TrashItem.destroyOne({ _id: item._id });
    }
    return items.length;
};

/** Purge everything in a workspace's trash that is past expires_at. */
export const purgeExpiredTrash = async (workspaceId) => {
    const expired = await global.TrashItem.find({ workspace_id: workspaceId, expires_at: { '<': new Date() } });
    return purgeTrashItems(expired);
};

/** Workspace owner or admin (member_roles entry with role 'admin'). */
export const isWorkspaceAdmin = async (workspaceId, userId) => {
    const workspace = await global.Workspace.findOne({ _id: workspaceId });
    if (!workspace) return false;
    if (String(workspace.owner_id) === String(userId)) return true;
    const roles = Array.isArray(workspace.member_roles) ? workspace.member_roles : [];
    return roles.some((r) => String(r.user_id) === String(userId) && r.role === 'admin');
};
