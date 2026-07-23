import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getMessageSchema = z.object({
    conversation_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid conversation ID' }),
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    before: z.string().optional().refine(v => !v || isValidObjectId(v), { message: 'Invalid message ID' }),
});

export const postMessageSchema = z.object({
    conversation_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid conversation ID' }),
    body: z.string().optional().default(''),
    content: z.string().optional(),
    mentions: z.array(z.string().refine(isValidObjectId, { message: 'Invalid mention user ID' })).optional().default([]),
    attachments: z.array(z.string().refine(isValidObjectId, { message: 'Invalid attachment ID' })).optional().default([]),
    entity_refs: z.array(z.object({
        type: z.enum(['task', 'story', 'subtask']),
        id: z.string().refine(isValidObjectId, { message: 'Invalid entity ID' }),
        title: z.string().optional(),
        url: z.string().optional(),
        board_id: z.string().optional(),
        board_name: z.string().optional(),
        status: z.string().optional(),
    })).optional().default([]),
});
