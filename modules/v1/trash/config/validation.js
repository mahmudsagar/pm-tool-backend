import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const restoreTrashSchema = z.object({
    id: z.string().nonempty('id is required').refine(isValidObjectId, {
        message: 'Invalid MongoDB ObjectId',
    }),
});

export const deleteTrashSchema = z.object({
    id: z.string().optional().refine((v) => !v || isValidObjectId(v), {
        message: 'Invalid MongoDB ObjectId',
    }),
    all: z.enum(['true', 'false']).optional(),
}).refine((data) => data.id || data.all === 'true', {
    message: 'Either id or all=true must be provided',
    path: ['id', 'all'],
});
