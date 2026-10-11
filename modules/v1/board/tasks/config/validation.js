import { z } from 'zod';
import { customMetaValuesSchema } from '../../../page/document/config/validation.js';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const objectId = (label) => z.string({ required_error: `${label} is required` })
    .refine(isValidObjectId, { message: 'Invalid MongoDB ObjectId' });

export const MAX_BULK_UPDATES = 500;

const taskUpdateSchema = z.object({
    id: objectId('id'),
    /** Merged into custom_meta.values; null deletes a key */
    values: customMetaValuesSchema.optional(),
    sort_order: z.number().finite('sort_order must be a finite number').optional(),
}).refine((u) => u.values !== undefined || u.sort_order !== undefined, {
    message: 'Each update needs values and/or sort_order',
});

export const putBoardTasksSchema = z.object({
    board_id: objectId('board_id'),
    updates: z.array(taskUpdateSchema)
        .min(1, 'updates must not be empty')
        .max(MAX_BULK_UPDATES, `At most ${MAX_BULK_UPDATES} updates per request`),
    /** Stored on the task events of this request (e.g. "Re-planned after standup") */
    reason: z.string().trim().max(500, 'reason must be at most 500 characters').optional(),
    /** Notify the new assignee(s) of tasks whose assignee changed */
    notify: z.boolean().optional(),
}).refine((d) => new Set(d.updates.map((u) => u.id)).size === d.updates.length, {
    message: 'Each task id may appear only once in updates',
    path: ['updates'],
});

export const deleteBoardTasksSchema = z.object({
    board_id: objectId('board_id'),
    ids: z.array(objectId('id'))
        .min(1, 'ids must not be empty')
        .max(MAX_BULK_UPDATES, `At most ${MAX_BULK_UPDATES} ids per request`),
});
