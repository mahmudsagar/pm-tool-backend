import { z } from 'zod';
import { postConversationSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import {
    enrichConversation,
    findExistingDM,
    channelAccessUserIds,
    resolveConversationAccess,
} from '../utils/chatHelper.js';

export default async (request, response) => {
    try {
        const userId = request.user.id;
        const workspaceId = request.workspaceId;
        const body = postConversationSchema.parse(request.body);

        if (body.type === 'dm') {
            if (!body.target_user_id) {
                return response.status(400).json(formatErrorMessage('target_user_id is required for DM'));
            }
            if (body.target_user_id === userId) {
                return response.status(400).json(formatErrorMessage('Cannot create DM with yourself'));
            }

            const existing = await findExistingDM(workspaceId, userId, body.target_user_id);
            if (existing) {
                const enriched = await enrichConversation(existing, userId);
                return response.json(formatSuccessMessage('Conversation already exists', enriched));
            }

            const conversation = await global.Conversation.create({
                workspace_id: workspaceId,
                type: 'dm',
                members: [userId, body.target_user_id],
                created_by: userId,
            }).fetch();

            const enriched = await enrichConversation(conversation, userId);
            return response.json(formatSuccessMessage('DM created successfully', enriched));
        }

        if (body.type === 'channel') {
            if (!body.space_id) {
                return response.status(400).json(formatErrorMessage('space_id is required for channel'));
            }

            const space = await global.Space.findOne({ _id: body.space_id, workspace_id: workspaceId });
            if (!space) {
                return response.status(404).json(formatErrorMessage('Space not found'));
            }

            // Channel members follow live space access (kept in sync on every read).
            const workspace = await global.Workspace.findOne({ _id: workspaceId });
            const spaceMembers = await channelAccessUserIds({ space_id: body.space_id, workspace_id: workspaceId }, workspace);
            if (!spaceMembers.includes(userId)) {
                return response.status(404).json(formatErrorMessage('Space not found'));
            }
            const channelName = body.name || `${space.name} Channel`;

            const existingChannel = await global.Conversation.findOne({
                workspace_id: workspaceId,
                type: 'channel',
                space_id: body.space_id,
            });

            if (existingChannel) {
                const synced = await resolveConversationAccess(existingChannel, userId, { workspace });
                if (!synced) return response.status(404).json(formatErrorMessage('Space not found'));
                const enriched = await enrichConversation(synced, userId, { workspace });
                return response.json(formatSuccessMessage('Space channel already exists', enriched));
            }

            const conversation = await global.Conversation.create({
                workspace_id: workspaceId,
                type: 'channel',
                name: channelName,
                description: body.description || `Channel for ${space.name}`,
                space_id: body.space_id,
                members: spaceMembers,
                created_by: userId,
            }).fetch();

            const enriched = await enrichConversation(conversation, userId);
            return response.json(formatSuccessMessage('Channel created successfully', enriched));
        }

        if (body.type === 'group') {
            if (!body.name?.trim()) {
                return response.status(400).json(formatErrorMessage('Group name is required'));
            }

            const members = new Set([userId, ...(body.members || [])]);

            const conversation = await global.Conversation.create({
                workspace_id: workspaceId,
                type: 'group',
                name: body.name.trim(),
                description: body.description || '',
                members: Array.from(members),
                created_by: userId,
            }).fetch();

            const enriched = await enrichConversation(conversation, userId);
            return response.json(formatSuccessMessage('Group created successfully', enriched));
        }

        return response.status(400).json(formatErrorMessage('Invalid conversation type'));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
