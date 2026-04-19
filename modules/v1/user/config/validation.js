import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getUserSchema = z.object({
    _id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    search: z.string().optional()
}).refine(data => data._id || data.search, {
    message: "Either _id or search query must be provided",
    path: ["_id", "search"]
});

export const putUserSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).optional(),
    avatar: z.string().optional(),
});

export const changePasswordSchema = z.object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "New password must be at least 8 characters"),
});