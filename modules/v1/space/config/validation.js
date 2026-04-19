import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const spaceAccessMemberSchema = z.object({
    user_id: z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
    role: z.enum(['manager', 'contributor', 'viewer']),
});

const spaceAccessTeamSchema = z.object({
    team_id: z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
    role: z.enum(['manager', 'contributor', 'viewer']),
});

export const postSpaceSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    default_view: z.enum(['table', 'timeline', 'calendar', 'kanban']).optional(),
    space_lead: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    is_private: z.boolean().default(false),
    shared_teams: z.array(z.union([
        z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
        spaceAccessTeamSchema,
    ])).optional(),
    shared_members: z.array(z.union([
        z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
        spaceAccessMemberSchema,
    ])).optional(),
    is_default: z.boolean().default(false),
    working_start_date: z.string().optional(),
    working_end_date: z.string().optional(),
});

export const putSpaceSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    default_view: z.enum(['table', 'timeline', 'calendar', 'kanban']).optional(),
    space_lead: z.string().nullable().optional().refine(value => value === null || value === undefined || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    is_private: z.boolean().optional(),
    shared_teams: z.array(z.union([
        z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
        spaceAccessTeamSchema,
    ])).optional(),
    shared_members: z.array(z.union([
        z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
        spaceAccessMemberSchema,
    ])).optional(),
    working_start_date: z.string().nullable().optional(),
    working_end_date: z.string().nullable().optional(),
});

export const putSpaceAccessSchema = z.object({
    shared_teams: z.array(spaceAccessTeamSchema).optional(),
    shared_members: z.array(spaceAccessMemberSchema).optional(),
});

export const getSpaceSchema = z.object({
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

export const deleteSpaceSchema = z.object({
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