import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postWorkspaceSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
});

export const putWorkspaceSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
});

export const getWorkspaceSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined()),
});

export const deleteWorkspaceSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});

export const postMemberSchema = z.object({
    workspace_id: z.string().nonempty("Workspace ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    email: z.string().email("Invalid email address").optional(),
    user_id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
}).refine(data => data.email || data.user_id, {
    message: "Either email or user_id must be provided",
    path: ["email", "user_id"],
});

export const deleteMemberSchema = z.object({
    workspace_id: z.string().nonempty("Workspace ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});
