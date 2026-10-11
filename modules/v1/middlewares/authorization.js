import { formatErrorMessage } from '../utils/error.js';
import { canUserAccessEntity } from '../utils/helper.js';
import { isWorkspaceMember, isMemberSuspended } from '../utils/workspaceAccess.js';

export const checkEntityAccess = async (entityType, entityId, userId, workspaceId = null) => {
    const normalizeId = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return String(value._id || value.id || value.user_id || value.team_id || '');
        return String(value);
    };
    const includesId = (arr = [], target) =>
        Array.isArray(arr) && arr.some((entry) => normalizeId(entry) === normalizeId(target));

    let entity;
    
    switch (entityType) {
        case 'space':
            entity = await global.Space.findOne({ _id: entityId });
            break;
        case 'group':
            entity = await global.Group.findOne({ _id: entityId });
            break;
        case 'folder':
            entity = await global.Folder.findOne({ _id: entityId });
            break;
        case 'board':
            entity = await global.Board.findOne({ _id: entityId });
            break;
        case 'page':
            entity = await global.PageMeta.findOne({ _id: entityId });
            break;
        case 'comment':
            entity = await global.CommentMeta.findOne({ _id: entityId });
            break;
        case 'team':
            entity = await global.Team.findOne({ _id: entityId });
            break;
        case 'workspace':
            entity = await global.Workspace.findOne({ _id: entityId });
            if (!entity) return false;
            return normalizeId(entity.owner_id) === normalizeId(userId) || includesId(entity.members, userId);
        default:
            return false;
    }

    if (!entity) return false;

    // Use shared access helper (owner, explicit sharing, or public workspace-wide)
    const hasAccess = await canUserAccessEntity(entity, userId, workspaceId);
    if (hasAccess) return true;

    // Recurse up the parent chain
    if (entity.space_id) return await checkEntityAccess('space', entity.space_id, userId, workspaceId);
    if (entity.group_id) return await checkEntityAccess('group', entity.group_id, userId, workspaceId);
    if (entity.folder_id) return await checkEntityAccess('folder', entity.folder_id, userId, workspaceId);
    if (entity.board_id) return await checkEntityAccess('board', entity.board_id, userId, workspaceId);
    if (entity.parent_id) return await checkEntityAccess('folder', entity.parent_id, userId, workspaceId);
    if (entity.page_id) return await checkEntityAccess('page', entity.page_id, userId, workspaceId);

    return false;
};

export default function authorizationMiddleware(request, response, next) {
    const userId = request.user?.id;
    
    if (!userId) {
        return response.status(401).json(formatErrorMessage("User not authenticated"));
    }

    const { id, user_id, space_id, group_id, folder_id, board_id, page_id, parent_id } = request.query;
    const workspace_id = request.workspaceId;
    const body = request.body || {};
    const method = request.method;

    (async () => {
        try {
            const routePath = request.path || request.url;
            const isWorkspaceRoute = routePath.includes('/workspace');
            // Invite links are opened before the user belongs to the invited workspace
            const isInvitationRoute = routePath.startsWith('/v1/invitation');

            // Require workspace header for all entity routes
            if (!isWorkspaceRoute && !isInvitationRoute && !workspace_id) {
                return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
            }

            // Always check workspace access (and suspension) from X-Workspace-ID header
            if (workspace_id) {
                const workspace = await global.Workspace.findOne({ _id: workspace_id });
                if (!workspace || !isWorkspaceMember(workspace, userId)) {
                    return response.status(403).json(formatErrorMessage("Access denied"));
                }
                if (isMemberSuspended(workspace, userId)) {
                    return response.status(403).json(formatErrorMessage("Your access to this workspace is suspended"));
                }
            }

            if (method === 'POST' && !id && !user_id && !space_id && !group_id && !folder_id && !board_id && !page_id && !parent_id) {
                return next();
            }

            if (user_id && user_id !== userId) {
                const hasAccess = await checkUserRelationship(user_id, userId);
                if (!hasAccess) {
                    return response.status(403).json(formatErrorMessage("Access denied"));
                }
            }

            const entityChecks = [
                { type: 'space', id: space_id || body.space_id },
                { type: 'group', id: group_id || body.group_id },
                { type: 'folder', id: folder_id || body.folder_id || parent_id || body.parent_id },
                { type: 'board', id: board_id || body.board_id },
                { type: 'page', id: page_id || body.page_id },
            ];
            
            if (id && !space_id && !group_id && !folder_id && !board_id && !page_id && !parent_id) {
                const routePath = request.path || request.url;
                
                if (routePath.includes('/workspace/invitation')) {
                    // `id` is an invitation id; the handler checks workspace admin rights
                } else if (routePath.includes('/workspace')) {
                    entityChecks.push({ type: 'workspace', id });
                } else if (routePath.includes('/space')) {
                    entityChecks.push({ type: 'space', id });
                } else if (routePath.includes('/folder')) {
                    entityChecks.push({ type: 'folder', id });
                } else if (routePath.includes('/group')) {
                    entityChecks.push({ type: 'group', id });
                } else if (method === 'GET' && (request.path === '/v1/board' || request.path === '/v1/board/')) {
                    // GET /v1/board?id= checks access itself and answers 404 for boards the
                    // user cannot see, so their existence is not revealed by a 403.
                } else if (routePath.includes('/board')) {
                    entityChecks.push({ type: 'board', id });
                } else if (routePath.includes('/page')) {
                    entityChecks.push({ type: 'page', id });
                }
            }

            for (const check of entityChecks) {
                if (check.id) {
                    const hasAccess = await checkEntityAccess(check.type, check.id, userId, workspace_id);
                    if (!hasAccess) {
                        return response.status(403).json(formatErrorMessage("Access denied to this resource"));
                    }
                }
            }

            next();
        } catch (error) {
            console.error('Authorization error:', error);
            return response.status(500).json(formatErrorMessage("Authorization check failed"));
        }
    })();
}

async function checkUserRelationship(targetUserId, requestUserId) {
    if (targetUserId === requestUserId) return true;

    const sharedSpaces = await global.Space.find({
        or: [
            { user_id: requestUserId, shared_members: { contains: targetUserId } },
            { user_id: targetUserId, shared_members: { contains: requestUserId } }
        ]
    });

    if (sharedSpaces.length > 0) return true;

    const sharedTeams = await global.Team.find({
        or: [
            { user_id: requestUserId, shared_members: { contains: targetUserId } },
            { user_id: targetUserId, shared_members: { contains: requestUserId } }
        ]
    });

    return sharedTeams.length > 0;
}