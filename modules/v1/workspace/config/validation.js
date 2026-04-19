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
    logo: z.string().optional(),
    timezone: z.string().optional(),
    date_format: z.string().optional(),
    first_day_of_week: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).optional(),
    working_days: z.array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])).optional(),
    billing_plan: z.string().optional(),
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
    email: z.string().email("Invalid email address").optional(),
    user_id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    role: z.enum(['admin', 'member', 'guest']).default('member'),
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

export const putMemberRoleSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    role: z.enum(['admin', 'member', 'guest'], { message: "Role must be admin, member, or guest" }),
});
