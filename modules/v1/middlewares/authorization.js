import { formatErrorMessage } from '../utils/error.js';

const checkEntityAccess = async (entityType, entityId, userId) => {
    let entity;
    console.log('e', entityType, entityId, userId);
    
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
            return entity.owner_id === userId || (entity.members && entity.members.includes(userId));
        default:
            return false;
    }

    if (!entity) {
        console.log(`Entity not found: ${entityType} with id: ${entityId}`);
        return false;
    }

    console.log(`Checking access for ${entityType} ${entityId}:`, { 
        entity_user_id: entity.user_id, 
        request_user_id: userId,
        shared_members: entity.shared_members,
        shared_teams: entity.shared_teams 
    });

    if (entity.user_id === userId) {
        console.log('Access granted: User is owner');
        return true;
    }

    if (entity.shared_members && entity.shared_members.includes(userId)) {
        console.log('Access granted: User in shared_members');
        return true;
    }

    if (entity.shared_teams && entity.shared_teams.length > 0) {
        const userTeams = await global.Team.find({ 
            _id: { in: entity.shared_teams }
        });
        
        console.log('Found teams:', userTeams.length);
        
        for (const team of userTeams) {
            if (team.user_id === userId || 
                (team.shared_members && team.shared_members.includes(userId))) {
                console.log('Access granted: User in shared team');
                return true;
            }
        }
    }

    if (entity.space_id) {
        console.log('Checking parent space:', entity.space_id);
        return await checkEntityAccess('space', entity.space_id, userId);
    }
    if (entity.group_id) {
        console.log('Checking parent group:', entity.group_id);
        return await checkEntityAccess('group', entity.group_id, userId);
    }
    if (entity.folder_id) {
        console.log('Checking parent folder:', entity.folder_id);
        return await checkEntityAccess('folder', entity.folder_id, userId);
    }
    if (entity.board_id) {
        console.log('Checking parent board:', entity.board_id);
        return await checkEntityAccess('board', entity.board_id, userId);
    }
    if (entity.parent_id) {
        console.log('Checking parent folder:', entity.parent_id);
        return await checkEntityAccess('folder', entity.parent_id, userId);
    }
    if (entity.page_id) {
        console.log('Checking parent page:', entity.page_id);
        return await checkEntityAccess('page', entity.page_id, userId);
    }

    console.log('Access denied: No matching criteria');
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

            // Require workspace header for all entity routes
            if (!isWorkspaceRoute && !workspace_id) {
                return response.status(400).json(formatErrorMessage('X-Workspace-ID header is required'));
            }

            // Always check workspace access from X-Workspace-ID header
            if (workspace_id) {
                const hasWorkspaceAccess = await checkEntityAccess('workspace', workspace_id, userId);
                if (!hasWorkspaceAccess) {
                    return response.status(403).json(formatErrorMessage("Access denied"));
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
                
                if (routePath.includes('/workspace')) {
                    entityChecks.push({ type: 'workspace', id });
                } else if (routePath.includes('/space')) {
                    entityChecks.push({ type: 'space', id });
                } else if (routePath.includes('/folder')) {
                    entityChecks.push({ type: 'folder', id });
                } else if (routePath.includes('/group')) {
                    entityChecks.push({ type: 'group', id });
                } else if (routePath.includes('/board')) {
                    entityChecks.push({ type: 'board', id });
                } else if (routePath.includes('/page')) {
                    entityChecks.push({ type: 'page', id });
                }
            }

            for (const check of entityChecks) {
                if (check.id) {
                    const hasAccess = await checkEntityAccess(check.type, check.id, userId);
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