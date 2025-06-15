import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const searchSchema = z.object({
    query: z.string().min(1, "Search query is required"),
    limit: z.number().optional().default(20),
    user_id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    })
});