import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const objectId = (message) => z.string().refine(isValidObjectId, { message });
const isIsoDate = (v) => !Number.isNaN(Date.parse(v));
const truthyFlag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true');

export const getMessageSchema = z.object({
    conversation_id: objectId('Invalid conversation ID').optional(),
    thread_id: objectId('Invalid thread ID').optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    // ISO timestamp (createdAt of the oldest loaded message) or, for older clients, a message id.
    before: z.string().optional().refine(v => !v || isValidObjectId(v) || isIsoDate(v), { message: 'Invalid before (ISO date or message ID)' }),
    page: truthyFlag,
    pinned: truthyFlag,
}).refine((q) => q.conversation_id || q.thread_id, { message: 'conversation_id or thread_id is required', path: ['conversation_id'] });

export const searchMessageSchema = z.object({
    q: z.string().trim().min(1).max(200),
    conversation_id: objectId('Invalid conversation ID').optional(),
});

const entityRefSchema = z.object({
    type: z.enum(['task', 'story', 'subtask']),
    id: z.string().refine(isValidObjectId, { message: 'Invalid entity ID' }),
    title: z.string().optional(),
    url: z.string().optional(),
    board_id: z.string().optional(),
    board_name: z.string().optional(),
    status: z.string().optional(),
});

export const postMessageSchema = z.object({
    conversation_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid conversation ID' }),
    parent_message_id: objectId('Invalid parent message ID').nullable().optional(),
    body: z.string().optional().default(''),
    content: z.string().optional(),
    mentions: z.array(z.string().refine(isValidObjectId, { message: 'Invalid mention user ID' })).optional().default([]),
    attachments: z.array(z.string().refine(isValidObjectId, { message: 'Invalid attachment ID' })).optional().default([]),
    entity_refs: z.array(entityRefSchema).optional().default([]),
});

export const putMessageSchema = z.object({
    id: objectId('Invalid message ID'),
    body: z.string().optional(),
    content: z.string().optional(),
    mentions: z.array(objectId('Invalid mention user ID')).optional(),
}).refine((b) => b.body !== undefined || b.content !== undefined || b.mentions !== undefined, { message: 'Nothing to update' });

export const deleteMessageSchema = z.object({
    id: objectId('Invalid message ID'),
});

export const reactionSchema = z.object({
    message_id: objectId('Invalid message ID'),
    emoji: z.string().trim().min(1).max(16),
});

export const pinSchema = z.object({
    message_id: objectId('Invalid message ID'),
    pinned: z.boolean(),
});
