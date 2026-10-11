import { isWorkspaceAdmin } from './workspaceAccess.js';

const sameId = (a, b) => !!a && !!b && String(a) === String(b);

/** Fields of page_meta that a lock protects (page content is protected separately). */
export const LOCK_PROTECTED_FIELDS = ['title', 'subtitle', 'icon', 'custom_meta', 'cover_position'];

/** Studio fields that always come back on a page, with their defaults for older rows. */
export const withStudioDefaults = (page) => page && ({
    ...page,
    icon: page.icon ?? '',
    subtitle: page.subtitle ?? '',
    doc_status: page.doc_status || 'draft',
    cover_position: page.cover_position ?? null,
    locked: page.locked === true,
    locked_by: page.locked_by || null,
    locked_at: page.locked_at || null,
});

/**
 * Who may toggle a page lock, and who may still edit a locked page:
 * the page creator, whoever holds the lock, or a workspace admin (owner or role 'admin').
 */
export const canManagePageLock = async (page, userId, workspaceId) => {
    if (!page || !userId) return false;
    if (sameId(page.user_id, userId) || sameId(page.locked_by, userId)) return true;
    const wsId = page.workspace_id || workspaceId;
    if (!wsId) return false;
    const workspace = await global.Workspace.findOne({ _id: wsId });
    return isWorkspaceAdmin(workspace, userId);
};

export const PAGE_LOCKED_MESSAGE = 'This page is locked';
