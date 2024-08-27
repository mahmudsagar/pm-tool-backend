import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postTeamSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
    users: z.array(z.string()).optional()
});

export const putTeamSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    users: z.array(z.string()).optional()
});

export const getTeamSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })
});