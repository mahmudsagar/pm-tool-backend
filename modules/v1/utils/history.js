import { v4 as uuidv4 } from 'uuid';

/**
 * Get the next version number for a page's history.
 */
export const getNextVersion = async (pageId) => {
    const all = await global.PageHistory.find({ page_id: pageId });
    if (all.length === 0) return 1;
    return Math.max(...all.map(e => e.version)) + 1;
};

/**
 * Detect which fields changed between old and new meta objects.
 * Returns a map of { field: { from, to } }.
 */
export const detectMetaChanges = (oldMeta, newMeta, fieldsToTrack) => {
    const changes = {};
    for (const field of fieldsToTrack) {
        if (newMeta[field] === undefined) continue;
        const oldVal = oldMeta[field];
        const newVal = newMeta[field];
        const oldStr = JSON.stringify(oldVal);
        const newStr = JSON.stringify(newVal);
        if (oldStr !== newStr) {
            changes[field] = { from: oldVal, to: newVal };
        }
    }
    return changes;
};

/**
 * Determine the action type from detected changes.
 */
export const resolveAction = (changes, hasContentChange) => {
    if (hasContentChange && Object.keys(changes).length > 0) {
        return 'meta_updated'; // meta takes precedence when both change
    }
    if (hasContentChange) return 'content_updated';
    if (changes.title) return 'title_updated';
    if (changes.custom_meta) return 'custom_meta_updated';
    if (changes.shared_members || changes.shared_teams) return 'sharing_updated';
    return 'meta_updated';
};

/**
 * Create a history entry for a page.
 */
export const createHistoryEntry = async ({
    pageId,
    pageContentId,
    userId,
    action,
    contentSnapshot = null,
    metaSnapshot = null,
    changes = {},
}) => {
    const version = await getNextVersion(pageId);
    const entry = await global.PageHistory.create({
        _id: uuidv4().replace(/-/g, '').slice(0, 24),
        page_id: pageId,
        page_content_id: pageContentId,
        user_id: userId,
        version,
        action,
        content_snapshot: contentSnapshot,
        meta_snapshot: metaSnapshot,
        changes,
    }).fetch();
    return entry;
};
