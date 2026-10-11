import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const objectId = (label) => z.string({ required_error: `${label} is required` })
    .refine(isValidObjectId, { message: `${label} must be a valid MongoDB ObjectId` });

const isRealDate = (v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const dateString = (label) => z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD`)
    .refine(isRealDate, { message: `${label} is not a valid date` });

const endAfterStart = (d) => !d.start_date || !d.end_date || d.end_date >= d.start_date;
const endAfterStartMessage = { message: 'end_date must be on or after start_date', path: ['end_date'] };

export const getSprintsSchema = z.object({ board_id: objectId('board_id') });

export const postSprintSchema = z.object({
    board_id: objectId('board_id'),
    name: z.string().trim().min(1, 'name is required').max(200),
    goal: z.string().max(2000).optional(),
    start_date: dateString('start_date').nullable().optional(),
    end_date: dateString('end_date').nullable().optional(),
}).refine(endAfterStart, endAfterStartMessage);

export const putSprintSchema = z.object({
    id: objectId('id'),
    name: z.string().trim().min(1, 'name must not be empty').max(200).optional(),
    goal: z.string().max(2000).optional(),
    start_date: dateString('start_date').nullable().optional(),
    end_date: dateString('end_date').nullable().optional(),
}).refine(endAfterStart, endAfterStartMessage);

export const startSprintSchema = z.object({
    id: objectId('id'),
    start_date: dateString('start_date').optional(),
    end_date: dateString('end_date').optional(),
}).refine(endAfterStart, endAfterStartMessage);

export const completeSprintSchema = z.object({
    id: objectId('id'),
    move_to: z.union([z.literal('backlog'), objectId('move_to')], {
        errorMap: () => ({ message: "move_to must be 'backlog' or a sprint id" }),
    }),
});

export const deleteSprintSchema = z.object({ id: objectId('id') });
