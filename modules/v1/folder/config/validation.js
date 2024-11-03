import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postFolderSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
    parent_id: z.string().optional(),
}).refine(data => {
    const { parent_id, space_id, group_id } = data;
    const keys = [parent_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined);
    if (presentKeys.length === 0) {
        return false; // One of parent_id, space_id, or group_id must be present
    }
    if (presentKeys.length > 1) {
        return false; // Only one of parent_id, space_id, or group_id must be present
    }
    return true;
}, {
    message: "One of parent_id, space_id, or group_id must be present, and only one can be present",
    path: ["parent_id", "space_id", "group_id"]
}).refine(data => {
    if (data.parent_id && !isValidObjectId(data.parent_id)) {
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
    path: ["parent_id", "space_id", "group_id"]
});

export const putFolderSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
    parent_id: z.string().optional(),
}).refine(data => {
    const { parent_id, space_id, group_id } = data;
    const keys = [parent_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined);
    if (presentKeys.length > 1) {
        return false; // Only one of parent_id, space_id, or group_id must be present
    }
    return true;
}, {
    message: "One of parent_id, space_id, or group_id must be present, and only one can be present",
    path: ["parent_id", "space_id", "group_id"]
}).refine(data => {
    if (data.parent_id && !isValidObjectId(data.parent_id)) {
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
    path: ["parent_id", "space_id", "group_id"]
});

export const getFolderSchema = z.object({
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

export const deleteFolderSchema = z.object({
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