import { z } from 'zod';
import { ENTITY_TYPES } from '../../utils/entities.js';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const recentEntitySchema = z.object({
    entity_type: z.enum(ENTITY_TYPES, {
        errorMap: () => ({ message: `entity_type must be one of ${ENTITY_TYPES.join(', ')}` }),
    }),
    entity_id: z.string().nonempty('entity_id is required').refine(isValidObjectId, {
        message: 'Invalid MongoDB ObjectId',
    }),
});

export const getRecentSchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
