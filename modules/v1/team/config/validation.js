import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postTeamSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    workspace_id: z.string().nonempty("Workspace ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional()
});

export const putTeamSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional()
});

export const getTeamSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined()),
    user_id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined())
}).refine(data => data._id || data.user_id, {
    message: "Either _id or user_id must be provided",
    path: ["_id", "user_id"]
});

export const deleteTeamSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined()),
    user_id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined())
}).refine(data => data._id || data.user_id, {
    message: "Either _id or user_id must be provided",
    path: ["_id", "user_id"]
});