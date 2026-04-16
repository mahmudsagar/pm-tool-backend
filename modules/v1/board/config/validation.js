import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postBoardSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
    is_private: z.boolean().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    pinned: z.boolean().optional(),
    folder_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
    custom_meta: z.object({}).passthrough().optional(),
}).refine(data => {
    const { folder_id, space_id, group_id } = data;
    const keys = [folder_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length === 0) {
        return false; // One of folder_id, board_id, space_id, or group_id must be present
    }
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, board_id, space_id, or group_id must be present
    }
    return true;
}, {
    message: "One of folder_id, space_id, or group_id must be present, and only one can be present",
    path: ["folder_id", "space_id", "group_id"]
}).refine(data => {
    if (data.folder_id && !isValidObjectId(data.folder_id)) {
        return false;
    }
    if (data.space_id && !isValidObjectId(data.space_id)) {
        return false;
    }
    if (data.group_id && !isValidObjectId(data.group_id)) {
        return false;
    }
    return true;
}, {
    message: "Invalid MongoDB ObjectId",
    path: ["folder_id", "space_id", "group_id"]
});

const savedViewFilterSchema = z.object({
    field: z.string(),
    operator: z.enum(['is', 'is_not', 'contains', 'is_empty', 'is_not_empty']),
    value: z.any().optional(),
});

const savedViewSortSchema = z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']),
});

const savedViewSchema = z.object({
    sorts: z.array(savedViewSortSchema).optional(),
    filters: z.array(savedViewFilterSchema).optional(),
    search: z.string().optional(),
}).nullable();

export const putBoardSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    is_private: z.boolean().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    pinned: z.boolean().optional(),
    folder_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
    custom_meta: z.object({}).passthrough().optional(),
    saved_view: savedViewSchema.optional(),
}).refine(data => {
    const { folder_id, space_id, group_id } = data;
    const keys = [folder_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    // When updating metadata like saved_view, parent fields may not be re-sent
    if (presentKeys.length === 0) return true;
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, space_id, or group_id may be present
    }
    return true;
}, {
    message: "Only one of folder_id, space_id, or group_id can be present at a time",
    path: ["folder_id", "space_id", "group_id"]
}).refine(data => {
    if (data.folder_id && !isValidObjectId(data.folder_id)) {
        return false;
    }
    if (data.space_id && !isValidObjectId(data.space_id)) {
        return false;
    }
    if (data.group_id && !isValidObjectId(data.group_id)) {
        return false;
    }
    return true;
}, {
    message: "Invalid MongoDB ObjectId",
    path: ["folder_id", "space_id", "group_id"]
});

export const getBoardSchema = z.object({
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

export const deleteBoardSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })
});