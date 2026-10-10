import { checkEntityAccess } from '../middlewares/authorization.js';

// Entity types that can be starred / tracked as recent / trashed.
export const ENTITY_TYPES = ['space', 'folder', 'group', 'board', 'page'];

const modelFor = (entityType) => ({
    space: global.Space,
    folder: global.Folder,
    group: global.Group,
    board: global.Board,
    page: global.PageMeta,
}[entityType]);

export const loadEntity = async (entityType, entityId) => {
    const Model = modelFor(entityType);
    if (!Model || !entityId) return null;
    return (await Model.findOne({ _id: entityId })) || null;
};

/**
 * Whether `userId` may see `entity` inside `workspaceId`
 * (same rules as the authorization middleware, including the parent chain).
 */
export const isEntityAccessible = async (entityType, entity, userId, workspaceId) => {
    if (!entity) return false;
    if (workspaceId && entity.workspace_id && String(entity.workspace_id) !== String(workspaceId)) return false;
    return checkEntityAccess(entityType, entity._id, userId, workspaceId);
};

/** Compact entity shape used by favorites / recent items. */
export const summarizeEntity = (entityType, entity) => {
    const summary = { _id: entity._id };
    if (entityType === 'page') {
        summary.title = entity.title;
        summary.page_type = entity.page_type;
        summary.board_id = entity.board_id || '';
        summary.parent_id = entity.parent_id || '';
    } else {
        summary.name = entity.name;
    }
    if (entityType !== 'space') {
        summary.space_id = entity.space_id || '';
        summary.folder_id = entityType === 'folder' ? (entity.parent_id || '') : (entity.folder_id || '');
        summary.group_id = entity.group_id || '';
    }
    if (entity.is_private !== undefined) summary.is_private = entity.is_private;
    summary.updatedAt = entity.updatedAt;
    return summary;
};

/**
 * Resolve each row's entity; drop (and report) rows whose entity is gone or no longer accessible.
 * Returns { live: [{ row, entity }], stale: [row] }.
 */
export const resolveEntityRows = async (rows, userId, workspaceId) => {
    const results = await Promise.all(rows.map(async (row) => {
        const entity = await loadEntity(row.entity_type, row.entity_id);
        const ok = entity && await isEntityAccessible(row.entity_type, entity, userId, workspaceId);
        return { row, entity: ok ? entity : null };
    }));
    return {
        live: results.filter((r) => r.entity),
        stale: results.filter((r) => !r.entity).map((r) => r.row),
    };
};
