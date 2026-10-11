import { dbConfig } from '../../../db/connection.js';

/**
 * Board task helpers: board keys, persistent task numbers, sort order and per-task counts.
 *
 * A task is a page_meta row with board_id (subtasks also have parent_id).
 *   board.key        e.g. "ENG" (uppercase, 2-6 letters/digits, starts with a letter)
 *   board.task_seq   last task number handed out (incremented atomically with $inc)
 *   page.task_number permanent number inside the board; the displayed key is `${board.key}-${n}`
 *   page.sort_order  position among siblings (same board, same parent); nulls sort last
 */

export const BOARD_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;
export const SORT_STEP = 1000;
const FALLBACK_KEY = 'TASK';

/** Derive a board key from its name: initials for multi-word names, else the first 4 characters. */
export const deriveBoardKey = (name) => {
    const words = String(name || '')
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9\s_-]/g, '')
        .split(/[\s_-]+/)
        .filter(Boolean);
    const candidates = [
        words.length >= 2 ? words.slice(0, 6).map((w) => w[0]).join('') : (words[0] || '').slice(0, 4),
        (words.find((w) => /^[A-Za-z]/.test(w)) || '').slice(0, 4),
    ];
    for (const raw of candidates) {
        const key = raw.toUpperCase().replace(/^[0-9]+/, '');
        if (BOARD_KEY_RE.test(key)) return key;
    }
    return FALLBACK_KEY;
};

// --- native driver access ---------------------------------------------------------------------

const nativeDb = () => {
    const db = dbConfig.adapters.mongo.datastores?.default?.manager;
    if (!db || typeof db.collection !== 'function') throw new Error('Database is not ready');
    return db;
};
export const collection = (name) => nativeDb().collection(name);

/** sails-mongo stores 24-hex primary keys as ObjectIds. */
export const toObjectId = (id) => {
    const { ObjectId } = dbConfig.adapters.mongo.mongodb;
    return /^[0-9a-fA-F]{24}$/.test(String(id)) ? new ObjectId(String(id)) : id;
};

/** Atomically reserve `count` task numbers for a board. Returns the first number of the block. */
export const reserveTaskNumbers = async (boardId, count = 1) => {
    if (count <= 0) return null;
    const doc = await collection('board').findOneAndUpdate(
        { _id: toObjectId(boardId) },
        { $inc: { task_seq: count } },
        { returnDocument: 'after', projection: { task_seq: 1 } },
    );
    // mongodb >= 6 returns the document; older drivers wrap it in { value }.
    const updated = doc && doc.value !== undefined && doc.task_seq === undefined ? doc.value : doc;
    if (!updated || typeof updated.task_seq !== 'number') throw new Error('Board not found');
    return updated.task_seq - count + 1;
};

/** Make sure the board has a key (derived from its name and persisted once). Mutates `board`. */
export const ensureBoardKey = async (board) => {
    if (board.key && BOARD_KEY_RE.test(board.key)) return board.key;
    const key = deriveBoardKey(board.name);
    await collection('board').updateOne({ _id: toObjectId(board._id) }, { $set: { key } });
    board.key = key;
    return key;
};

const isMissing = (v) => v === null || v === undefined || v === '';

/**
 * Give every task of the board that has no task_number one, in createdAt order, from an atomically
 * reserved block. Returns true when rows were written (callers should re-read them).
 */
export const backfillTaskNumbers = async (boardId, tasks) => {
    const missing = tasks
        .filter((t) => isMissing(t.task_number))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
    if (missing.length === 0) return false;
    const first = await reserveTaskNumbers(boardId, missing.length);
    await collection('page_meta').bulkWrite(missing.map((t, i) => ({
        updateOne: {
            // Only rows still unnumbered: a concurrent backfill may have won the race.
            filter: { _id: toObjectId(t._id), $or: [{ task_number: null }, { task_number: { $exists: false } }] },
            update: { $set: { task_number: first + i } },
        },
    })), { ordered: false });
    return true;
};

const parentKey = (row) => (row.parent_id ? String(row.parent_id) : '');

/**
 * Fill null sort_order values in a board (per sibling group, after the group's max, in createdAt
 * order) and return a Map parentKey -> max sort_order. Used before appending a task.
 */
export const ensureSortOrders = async (boardId) => {
    const rows = await collection('page_meta')
        .find({ board_id: String(boardId) }, { projection: { _id: 1, parent_id: 1, sort_order: 1, createdAt: 1 } })
        .toArray();
    const groups = new Map();
    for (const row of rows) {
        const key = parentKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const ops = [];
    const maxByGroup = new Map();
    for (const [key, list] of groups) {
        let max = list.reduce((m, r) => (typeof r.sort_order === 'number' && r.sort_order > m ? r.sort_order : m), 0);
        const unsorted = list
            .filter((r) => typeof r.sort_order !== 'number')
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
        for (const r of unsorted) {
            max += SORT_STEP;
            ops.push({
                updateOne: {
                    filter: { _id: r._id, $or: [{ sort_order: null }, { sort_order: { $exists: false } }] },
                    update: { $set: { sort_order: max } },
                },
            });
        }
        maxByGroup.set(key, max);
    }
    if (ops.length) await collection('page_meta').bulkWrite(ops, { ordered: false });
    return maxByGroup;
};

/** Next sort_order for a new task in (board, parent): max among siblings + SORT_STEP. */
export const nextSortOrder = async (boardId, parentId) => {
    const maxByGroup = await ensureSortOrders(boardId);
    return (maxByGroup.get(parentId ? String(parentId) : '') || 0) + SORT_STEP;
};

/** sort_order asc (nulls last), then createdAt asc. */
export const compareTasks = (a, b) => {
    const as = typeof a.sort_order === 'number' ? a.sort_order : null;
    const bs = typeof b.sort_order === 'number' ? b.sort_order : null;
    if (as !== bs) {
        if (as === null) return 1;
        if (bs === null) return -1;
        return as - bs;
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
};

/**
 * comment_count per page id, computed like GET /v1/page/stats: comment_meta rows with
 * page_id = page, plus replies (parent_id = one of those) that carry a different page_id.
 * Two queries for the whole board.
 */
export const commentCounts = async (pageIds) => {
    const counts = new Map(pageIds.map((id) => [String(id), 0]));
    if (pageIds.length === 0) return counts;
    const ids = pageIds.map(String);
    const threads = await collection('comment_meta')
        .find({ page_id: { $in: ids } }, { projection: { _id: 1, page_id: 1 } })
        .toArray();
    const pageByThread = new Map();
    for (const t of threads) {
        counts.set(String(t.page_id), (counts.get(String(t.page_id)) || 0) + 1);
        pageByThread.set(String(t._id), String(t.page_id));
    }
    if (pageByThread.size) {
        const replies = await collection('comment_meta')
            .find({ parent_id: { $in: [...pageByThread.keys()] } }, { projection: { parent_id: 1, page_id: 1 } })
            .toArray();
        for (const r of replies) {
            const pageId = pageByThread.get(String(r.parent_id));
            if (pageId && String(r.page_id || '') !== pageId) counts.set(pageId, (counts.get(pageId) || 0) + 1);
        }
    }
    return counts;
};

/** Add task_key / task_number / comment_count / attachment_count to a task row (mutates). */
export const decorateTask = (task, boardKey, counts) => {
    task.task_number = isMissing(task.task_number) ? null : task.task_number;
    task.task_key = task.task_number ? `${boardKey}-${task.task_number}` : null;
    task.comment_count = counts.get(String(task._id)) || 0;
    task.attachment_count = Array.isArray(task.attachments) ? task.attachments.length : 0;
    task.sort_order = typeof task.sort_order === 'number' ? task.sort_order : null;
    return task;
};

/** Shallow-merge `patch` into `values`; a null value deletes the key. */
export const mergeValues = (values, patch) => {
    const next = { ...(values && typeof values === 'object' && !Array.isArray(values) ? values : {}) };
    for (const [k, v] of Object.entries(patch || {})) {
        if (v === null) delete next[k];
        else next[k] = v;
    }
    return next;
};
