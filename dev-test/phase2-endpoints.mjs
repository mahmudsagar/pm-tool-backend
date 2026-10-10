#!/usr/bin/env node
/**
 * Phase 2 endpoint checks: favorites, recent items, trash (snapshot/restore/purge), storage.
 *
 * Run against a THROWAWAY database only, e.g.:
 *   mongod --dbpath /tmp/p2db --port 27998 --bind_ip 127.0.0.1
 *   MONGODB_URI=mongodb://127.0.0.1:27998/p2test PORT=3201 node server.js
 *   API_URL=http://127.0.0.1:3201 MONGODB_URI=mongodb://127.0.0.1:27998/p2test node dev-test/phase2-endpoints.mjs
 *
 * MONGODB_URI is used directly (seed media rows, age a trash item) and must point at the same DB.
 */
import { MongoClient, ObjectId } from 'mongodb';

const API = process.env.API_URL || 'http://127.0.0.1:3201';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27998/p2test';
if (!/127\.0\.0\.1|localhost/.test(MONGO)) {
    console.error('Refusing to run against a non-local MONGODB_URI');
    process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (name, condition, detail) => {
    if (condition) {
        passed += 1;
        console.log(`PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${name}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    }
};

const call = async (method, path, { token, ws, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-ID'] = ws;
    const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json, data: json?.data };
};

const register = async (label) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const res = await call('POST', '/v1/auth/register', {
        body: { name: `P2 ${label}`, email: `p2-${label}-${stamp}@example.test`, password: 'Passw0rd!123' },
    });
    if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.json)}`);
    return {
        token: res.data.token,
        userId: res.data.user_info._id,
        email: res.data.user_info.email,
        ws: res.data.workspaces[0]._id,
    };
};

const main = async () => {
    const mongo = new MongoClient(MONGO);
    await mongo.connect();
    const db = mongo.db();

    const owner = await register('owner');
    const member = await register('member');
    const as = (u, ws = owner.ws) => ({ token: u.token, ws });
    const o = as(owner);
    const m = as(member);

    // Add `member` to owner's workspace as a regular member.
    const addMember = await call('POST', '/v1/workspace/member', { ...o, body: { email: member.email, role: 'member' } });
    check('setup: add member to workspace', addMember.status === 200, addMember.json);

    // --- Fixtures ----------------------------------------------------------------------------
    const mk = async (path, body, auth = o) => {
        const res = await call('POST', path, { ...auth, body: { user_id: owner.userId, ...body } });
        if (res.status !== 200) throw new Error(`create ${path} failed: ${JSON.stringify(res.json)}`);
        return Array.isArray(res.data) ? res.data[0] : (res.data?.pageMeta || res.data);
    };
    const mkDoc = async (body) => {
        const res = await call('POST', '/v1/page/document', {
            ...o, body: { user_id: owner.userId, page_type: 'document', content: { blocks: [{ text: 'hello' }] }, ...body },
        });
        if (res.status !== 200) throw new Error(`create doc failed: ${JSON.stringify(res.json)}`);
        const d = res.data;
        return d.pageMeta || d.page_meta || d;
    };

    const space = await mk('/v1/space', { name: 'P2 Space', is_private: false });
    const space2 = await mk('/v1/space', { name: 'P2 Space 2', is_private: false });
    const folder = await mk('/v1/folder', { name: 'Folder A', space_id: space._id });
    const subFolder = await mk('/v1/folder', { name: 'Folder A.1', parent_id: folder._id });
    const doc = await mkDoc({ title: 'Doc in A', folder_id: folder._id });
    const subDoc = await mkDoc({ title: 'Doc in A.1', folder_id: subFolder._id });
    const rootDoc = await mkDoc({ title: 'Root doc', space_id: space._id });
    const board = await mk('/v1/board', { name: 'Board B', space_id: space._id });
    const task = await mkDoc({ title: 'Task 1', board_id: board._id });
    const group = await mk('/v1/group', { name: 'Group G', space_id: space._id });
    const groupFolder = await mk('/v1/folder', { name: 'Group folder', group_id: group._id });
    const groupDoc = await mkDoc({ title: 'Group doc', folder_id: groupFolder._id });
    check('setup: fixtures created', [space, folder, subFolder, doc, subDoc, rootDoc, board, task, group, groupFolder, groupDoc].every((x) => x && x._id));

    const comment = await call('POST', '/v1/comment', { ...o, body: { user_id: owner.userId, page_id: doc._id, comment_body: 'nice', content: { text: 'nice' } } });
    check('setup: comment on doc', comment.status === 200, comment.json);
    const commentId = comment.data?._id;

    // --- Favorites ---------------------------------------------------------------------------
    let res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'folder', entity_id: folder._id } });
    check('favorite: add folder -> 200', res.status === 200 && res.data?.entity_id === folder._id, res.json);
    const favId = res.data?._id;
    res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'folder', entity_id: folder._id } });
    check('favorite: add again is idempotent (same _id)', res.status === 200 && res.data?._id === favId, res.json);
    await new Promise((r) => setTimeout(r, 20));
    res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'page', entity_id: rootDoc._id } });
    check('favorite: add page -> 200', res.status === 200, res.json);
    await new Promise((r) => setTimeout(r, 20));
    res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'board', entity_id: board._id } });
    check('favorite: add board -> 200', res.status === 200, res.json);

    res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'folder', entity_id: new ObjectId().toString() } });
    check('favorite: missing entity -> 404', res.status === 404, res.status);
    res = await call('POST', '/v1/favorite', { ...o, body: { entity_type: 'nope', entity_id: folder._id } });
    check('favorite: bad entity_type -> 400', res.status === 400, res.status);

    // Private space of owner is not accessible to member.
    const privSpace = await mk('/v1/space', { name: 'Private', is_private: true });
    res = await call('POST', '/v1/favorite', { ...m, body: { entity_type: 'space', entity_id: privSpace._id } });
    check('favorite: inaccessible entity -> 403', res.status === 403, res.status);

    res = await call('GET', '/v1/favorite', o);
    const favs = res.data || [];
    check('favorite: list returns 3, newest first', res.status === 200 && favs.length === 3
        && favs[0].entity_type === 'board' && favs[2].entity_type === 'folder', favs.map((f) => f.entity_type));
    const pageFav = favs.find((f) => f.entity_type === 'page');
    check('favorite: page entity shape (title, page_type, space_id, updatedAt)', pageFav
        && pageFav.entity.title === 'Root doc' && pageFav.entity.page_type === 'document'
        && pageFav.entity.space_id === space._id && pageFav.entity.updatedAt !== undefined, pageFav);
    const folderFav = favs.find((f) => f.entity_type === 'folder');
    check('favorite: folder entity shape (name, space_id)', folderFav?.entity?.name === 'Folder A' && folderFav.entity.space_id === space._id, folderFav);
    check('favorite: rows carry _id/created_at', favs.every((f) => f._id && f.created_at), favs);

    res = await call('GET', '/v1/favorite', m);
    check('favorite: per-user (member sees none)', res.status === 200 && res.data.length === 0, res.data);

    res = await call('DELETE', `/v1/favorite?entity_type=board&entity_id=${board._id}`, o);
    check('favorite: remove -> 200', res.status === 200, res.json);
    res = await call('DELETE', `/v1/favorite?entity_type=board&entity_id=${board._id}`, o);
    check('favorite: remove again is idempotent', res.status === 200, res.json);
    res = await call('GET', '/v1/favorite', o);
    check('favorite: list after remove has 2', res.data?.length === 2, res.data?.length);

    // --- Recent ------------------------------------------------------------------------------
    for (const [type, id] of [['space', space._id], ['folder', folder._id], ['page', doc._id], ['board', board._id]]) {
        res = await call('POST', '/v1/recent', { ...o, body: { entity_type: type, entity_id: id } });
        if (res.status !== 200) check(`recent: record ${type}`, false, res.json);
        await new Promise((r) => setTimeout(r, 15));
    }
    res = await call('POST', '/v1/recent', { ...o, body: { entity_type: 'folder', entity_id: folder._id } });
    check('recent: upsert -> 200 with viewed_at', res.status === 200 && res.data?.viewed_at, res.json);
    res = await call('GET', '/v1/recent', o);
    const recent = res.data || [];
    check('recent: 4 unique rows (upsert, no dupes)', recent.length === 4, recent.map((r) => r.entity_type));
    check('recent: newest first (re-viewed folder on top)', recent[0]?.entity_type === 'folder' && recent[1]?.entity_type === 'board', recent.map((r) => r.entity_type));
    check('recent: entity shape', recent.find((r) => r.entity_type === 'page')?.entity?.title === 'Doc in A', recent);
    res = await call('GET', '/v1/recent?limit=2', o);
    check('recent: limit=2', res.data?.length === 2, res.data?.length);
    res = await call('GET', '/v1/recent?limit=500', o);
    check('recent: limit > 50 rejected', res.status === 400, res.status);
    res = await call('POST', '/v1/recent', { ...o, body: { entity_type: 'page', entity_id: new ObjectId().toString() } });
    check('recent: missing entity -> 404', res.status === 404, res.status);

    // Cap at 50: create 52 docs and view them all.
    const bulk = [];
    for (let i = 0; i < 52; i += 1) bulk.push(await mkDoc({ title: `Bulk ${i}`, space_id: space2._id }));
    for (const d of bulk) await call('POST', '/v1/recent', { ...o, body: { entity_type: 'page', entity_id: d._id } });
    const recentCount = await db.collection('recent_item').countDocuments({ user_id: owner.userId, workspace_id: owner.ws });
    check('recent: trimmed to 50 per user/workspace', recentCount === 50, recentCount);
    res = await call('GET', '/v1/recent?limit=50', o);
    check('recent: newest is last viewed', res.data?.[0]?.entity_id === bulk[51]._id && res.data.length === 50, res.data?.[0]);

    // --- Trash: folder with docs ---------------------------------------------------------------
    res = await call('DELETE', `/v1/folder?id=${folder._id}`, o);
    check('trash: delete folder -> 200 (unchanged response)', res.status === 200 && res.data === null, res.json);
    res = await call('GET', `/v1/folder?id=${folder._id}`, o);
    check('trash: folder gone after delete', res.status === 404 || res.status === 403, res.status);
    check('trash: comment gone after delete', (await db.collection('comment_meta').countDocuments({ _id: new ObjectId(commentId) })) === 0);

    res = await call('GET', '/v1/trash', o);
    let trash = res.data || [];
    const folderTrash = trash.find((t) => t.entity_id === folder._id);
    check('trash: folder listed', res.status === 200 && !!folderTrash, trash);
    check('trash: item_count = folder + subfolder + 2 docs = 4', folderTrash?.item_count === 4, folderTrash?.item_count);
    check('trash: item shape', folderTrash && folderTrash.entity_type === 'folder' && folderTrash.name === 'Folder A'
        && folderTrash.parent?.space_id === space._id && folderTrash.deleted_at && folderTrash.expires_at
        && folderTrash.deleted_by?._id === owner.userId && folderTrash.deleted_by?.email === owner.email, folderTrash);
    check('trash: expires 30 days after deletion', folderTrash
        && Math.round((new Date(folderTrash.expires_at) - new Date(folderTrash.deleted_at)) / 86400000) === 30, folderTrash);
    check('trash: snapshot not leaked in list', folderTrash && folderTrash.snapshot === undefined);

    res = await call('GET', '/v1/favorite', o);
    check('favorite: deleted folder dropped from list', res.data?.length === 1 && res.data[0].entity_type === 'page', res.data);
    check('favorite: stale row deleted', (await db.collection('favorite').countDocuments({ entity_id: folder._id })) === 0);

    res = await call('GET', '/v1/trash', m);
    check('trash: member does not see owner deletions', res.status === 200 && res.data.length === 0, res.data);
    res = await call('POST', '/v1/trash/restore', { ...m, body: { id: folderTrash._id } });
    check('trash: member cannot restore owner item -> 403', res.status === 403, res.status);

    res = await call('POST', '/v1/trash/restore', { ...o, body: { id: folderTrash._id } });
    check('trash: restore -> {entity_type, entity_id}', res.status === 200 && res.data?.entity_type === 'folder' && res.data?.entity_id === folder._id, res.json);
    res = await call('GET', `/v1/folder?id=${folder._id}`, o);
    const restoredFolder = res.data?.[0];
    check('trash: folder readable after restore', res.status === 200 && restoredFolder?.name === 'Folder A', res.json);
    check('trash: folder children restored', restoredFolder?.childs?.some((c) => c._id === doc._id) && restoredFolder?.childs?.some((c) => c._id === subFolder._id), restoredFolder?.childs?.map((c) => c._id));
    res = await call('GET', `/v1/page/document?id=${doc._id}`, o);
    check('trash: doc readable after restore with content', res.status === 200 && res.data?.title === 'Doc in A'
        && res.data?.pageContent?.content?.blocks?.[0]?.text === 'hello', res.json);
    check('trash: comment restored', res.data?.comments?.length === 1 && res.data.comments[0].commentContent?.content?.text === 'nice', res.data?.comments);
    res = await call('GET', `/v1/page/document?id=${subDoc._id}`, o);
    check('trash: nested doc restored', res.status === 200, res.status);
    const folderRow = await db.collection('folder').findOne({ _id: new ObjectId(folder._id) });
    check('trash: original _id and createdAt type preserved', folderRow && folderRow.createdAt instanceof Date, folderRow);
    res = await call('GET', '/v1/trash', o);
    check('trash: item removed after restore', !res.data.some((t) => t._id === folderTrash._id), res.data);

    // --- Trash: page delete (handler bug fixed) + restore to space root -----------------------
    res = await call('DELETE', `/v1/page/document?id=${subDoc._id}`, o);
    check('trash: delete page -> 200', res.status === 200, res.json);
    res = await call('DELETE', `/v1/folder?id=${subFolder._id}`, o);
    check('trash: delete its parent folder -> 200', res.status === 200, res.json);
    res = await call('GET', '/v1/trash', o);
    trash = res.data || [];
    const pageTrash = trash.find((t) => t.entity_id === subDoc._id);
    const subFolderTrash = trash.find((t) => t.entity_id === subFolder._id);
    check('trash: page item has page_type + item_count 1', pageTrash?.page_type === 'document' && pageTrash?.item_count === 1, pageTrash);
    check('trash: newest first', trash[0]?.entity_id === subFolder._id, trash.map((t) => t.name));
    check('trash: empty subfolder item_count 1', subFolderTrash?.item_count === 1, subFolderTrash);
    res = await call('POST', '/v1/trash/restore', { ...o, body: { id: pageTrash._id } });
    check('trash: restore page whose folder is gone -> space root', res.status === 200 && res.data?.restored_to === 'space_root', res.json);
    res = await call('GET', `/v1/page/document?id=${subDoc._id}`, o);
    check('trash: restored page attached to space root', res.status === 200 && res.data?.space_id === space._id && res.data?.folder_id === '', res.data && { space_id: res.data.space_id, folder_id: res.data.folder_id });

    // --- Trash: board, group, space ------------------------------------------------------------
    res = await call('DELETE', `/v1/board?id=${board._id}`, o);
    check('trash: delete board -> 200', res.status === 200, res.json);
    res = await call('DELETE', `/v1/group?id=${group._id}`, o);
    check('trash: delete group -> 200', res.status === 200, res.json);
    res = await call('DELETE', `/v1/space?id=${space2._id}`, o);
    check('trash: delete space -> 200', res.status === 200, res.json);
    res = await call('GET', '/v1/trash', o);
    trash = res.data || [];
    const boardTrash = trash.find((t) => t.entity_id === board._id);
    const groupTrash = trash.find((t) => t.entity_id === group._id);
    const spaceTrash = trash.find((t) => t.entity_id === space2._id);
    check('trash: board item (board + task = 2)', boardTrash?.item_count === 2, boardTrash);
    check('trash: group item (group + folder + doc = 3)', groupTrash?.item_count === 3, groupTrash);
    check('trash: space item (space row only = 1)', spaceTrash?.item_count === 1 && spaceTrash?.parent?.space_id === '', spaceTrash);
    for (const [label, item, verify] of [
        ['board', boardTrash, async () => (await call('GET', `/v1/page/document?id=${task._id}`, o)).status === 200 && (await call('GET', `/v1/board?id=${board._id}`, o)).status === 200],
        ['group', groupTrash, async () => (await call('GET', `/v1/page/document?id=${groupDoc._id}`, o)).status === 200 && (await call('GET', `/v1/folder?id=${groupFolder._id}`, o)).status === 200],
        ['space', spaceTrash, async () => (await db.collection('space').countDocuments({ _id: new ObjectId(space2._id) })) === 1],
    ]) {
        res = await call('POST', '/v1/trash/restore', { ...o, body: { id: item?._id } });
        check(`trash: restore ${label}`, res.status === 200 && (await verify()), res.json);
    }

    // --- Trash: member visibility, permanent delete, empty, expiry -----------------------------
    const memberDoc = await mkDoc({ title: 'Member doc', space_id: space._id });
    res = await call('DELETE', `/v1/page/document?id=${memberDoc._id}`, m);
    check('trash: member deletes a doc', res.status === 200, res.json);
    res = await call('GET', '/v1/trash', m);
    check('trash: member sees own deletion only', res.data?.length === 1 && res.data[0].entity_id === memberDoc._id, res.data);
    res = await call('GET', '/v1/trash', o);
    check('trash: owner sees member deletion too', res.data?.some((t) => t.entity_id === memberDoc._id), res.data);

    res = await call('DELETE', '/v1/trash?id=' + res.data.find((t) => t.entity_id === subFolder._id)._id, o);
    check('trash: delete one permanently', res.status === 200 && res.data?.deleted === 1, res.json);
    res = await call('DELETE', `/v1/trash?id=${new ObjectId()}`, o);
    check('trash: delete unknown id -> 404', res.status === 404, res.status);
    res = await call('DELETE', '/v1/trash', o);
    check('trash: delete without id/all -> 400', res.status === 400, res.status);

    // Expiry: age the member's item, listing purges it.
    await db.collection('trash_item').updateMany({ entity_id: memberDoc._id }, { $set: { expires_at: new Date(Date.now() - 1000) } });
    res = await call('GET', '/v1/trash', o);
    check('trash: expired items purged on list', !res.data.some((t) => t.entity_id === memberDoc._id)
        && (await db.collection('trash_item').countDocuments({ entity_id: memberDoc._id })) === 0, res.data);

    await call('DELETE', `/v1/page/document?id=${rootDoc._id}`, o);
    await call('DELETE', `/v1/page/document?id=${bulk[0]._id}`, m);
    res = await call('DELETE', '/v1/trash?all=true', m);
    check('trash: member empty -> only own items', res.status === 200 && res.data?.deleted === 1, res.json);
    res = await call('GET', '/v1/trash', o);
    check('trash: owner item survives member empty', res.data?.some((t) => t.entity_id === rootDoc._id), res.data);
    res = await call('DELETE', '/v1/trash?all=true', o);
    check('trash: owner empties workspace trash', res.status === 200 && res.data?.deleted >= 1, res.json);
    res = await call('GET', '/v1/trash', o);
    check('trash: empty after empty-all', res.data?.length === 0, res.data);

    // --- Storage -------------------------------------------------------------------------------
    res = await call('GET', '/v1/workspace/storage', o);
    check('storage: shape', res.status === 200 && res.data && typeof res.data.used_bytes === 'number'
        && res.data.quota_bytes === null && typeof res.data.file_count === 'number'
        && ['images', 'documents', 'other'].every((k) => typeof res.data.by_type?.[k] === 'number')
        && typeof res.data.active_contributors === 'number', res.json);
    check('storage: active contributors >= 1', res.data?.active_contributors >= 1, res.data);
    const before = res.data;

    const now = new Date();
    await db.collection('media').insertMany([
        { reference_id: doc._id, media_type: 'cover_photo', url: 'https://x/a.png', size: 1000, mime_type: 'image/png', workspace_id: owner.ws, createdAt: now, updatedAt: now },
        { reference_id: doc._id, media_type: 'comment_attachment', url: 'https://x/b.pdf', size: 2000, mime_type: 'application/pdf', workspace_id: owner.ws, createdAt: now, updatedAt: now },
        { reference_id: doc._id, media_type: 'comment_attachment', url: 'https://x/c.zip', size: 500, mime_type: 'application/zip', workspace_id: owner.ws, createdAt: now, updatedAt: now },
        // Legacy row: no size / mimetype / workspace_id, attributed through reference_id, classified by extension.
        { reference_id: doc._id, media_type: 'icon', url: 'https://x/legacy.jpg', createdAt: now, updatedAt: now },
        // Another workspace — must not count.
        { reference_id: new ObjectId().toString(), media_type: 'icon', url: 'https://x/o.png', size: 9999, mime_type: 'image/png', workspace_id: member.ws, createdAt: now, updatedAt: now },
    ]);
    res = await call('GET', '/v1/workspace/storage', o);
    check('storage: used_bytes sums sizes (legacy = 0)', res.data?.used_bytes === before.used_bytes + 3500, res.data);
    check('storage: by_type', res.data?.by_type?.images === before.by_type.images + 1000
        && res.data?.by_type?.documents === before.by_type.documents + 2000
        && res.data?.by_type?.other === before.by_type.other + 500, res.data?.by_type);
    check('storage: file_count includes legacy row', res.data?.file_count === before.file_count + 4, res.data);
    res = await call('GET', '/v1/workspace/storage', m);
    check('storage: member workspace header honoured (owner ws via member)', res.status === 200, res.json);

    await mongo.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
};

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
