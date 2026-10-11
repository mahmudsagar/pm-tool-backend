import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getConversationSchema = z.object({
    id: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid MongoDB ObjectId' }),
    type: z.enum(['dm', 'channel', 'group']).optional(),
    space_id: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid MongoDB ObjectId' }),
});

export const postConversationSchema = z.object({
    type: z.enum(['dm', 'channel', 'group']),
    name: z.string().optional(),
    description: z.string().optional(),
    space_id: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid MongoDB ObjectId' }),
    members: z.array(z.string().refine(isValidObjectId, { message: 'Invalid member ID' })).optional(),
    target_user_id: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid user ID' }),
});

export const getMessageSchema = z.object({
    conversation_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid conversation ID' }),
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    before: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid message ID' }),
});

export const postMessageSchema = z.object({
    conversation_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid conversation ID' }),
    body: z.string().optional().default(''),
    attachments: z.array(z.string().refine(isValidObjectId, { message: 'Invalid attachment ID' })).optional().default([]),
});

const objectId = (message) => z.string().refine(isValidObjectId, { message });

export const bookmarkSchema = z.object({
    id: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(200),
    url: z.string().trim().min(1).max(2000),
    entity_type: z.string().trim().max(50).optional().nullable(),
    entity_id: z.string().trim().max(64).optional().nullable(),
});

export const putConversationSchema = z.object({
    id: objectId('Invalid conversation ID'),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    topic: z.string().max(250).optional(),
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    bookmarks: z.array(bookmarkSchema).max(20, { message: 'At most 20 bookmarks' }).optional(),
    add_members: z.array(objectId('Invalid member ID')).max(200).optional(),
    remove_members: z.array(objectId('Invalid member ID')).max(200).optional(),
});

export const readConversationSchema = z.object({
    conversation_id: objectId('Invalid conversation ID'),
});
