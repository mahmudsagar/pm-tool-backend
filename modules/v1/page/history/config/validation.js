import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getHistorySchema = z.object({
    page_id: z.string().nonempty("Page ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    skip: z.coerce.number().min(0).optional().default(0),
});

export const rollbackSchema = z.object({
    page_id: z.string().nonempty("Page ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    history_id: z.string().nonempty("History ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});
