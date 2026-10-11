import { z } from 'zod';
import { dateString } from '../../sprint/config/validation.js';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const objectId = (label) => z.string({ required_error: `${label} is required` })
    .refine(isValidObjectId, { message: `${label} must be a valid MongoDB ObjectId` });

export const MAX_RANGE_DAYS = 120;

export const getAnalyticsSchema = z.object({
    board_id: objectId('board_id'),
    sprint_id: objectId('sprint_id').optional(),
    from: dateString('from').optional(),
    to: dateString('to').optional(),
}).refine((d) => !d.from || !d.to || d.to >= d.from, { message: 'to must be on or after from', path: ['to'] });
