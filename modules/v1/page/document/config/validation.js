import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

// Custom validation function to check if a string is valid JSON
const isValidJson = (str) => {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
};

export const postDocumentSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    content: z.union([
        z.object({}).passthrough(),
        z.string().nonempty("Content is required").refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]),
    summary: z.string().optional(),
    folder_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional()
}).refine(data => {
    const { folder_id, space_id, group_id } = data;
    const keys = [folder_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length === 0) {
        return false; // One of folder_id, space_id, or group_id must be present
    }
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, space_id, or group_id must be present
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

export const postPageMetaSchema = z.object({
    page_type: z.string().nonempty("Page type is required"),
    title: z.string().nonempty("Title is required"),
    page_content_id: z.string().nonempty("Page content ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    last_updated_by: z.string().optional(),
    custom_meta: z.union([
        z.object({}).passthrough(),
        z.string().refine(isValidJson, {
            message: "Custom meta must be a valid JSON string",
        })
    ]).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    attachments: z.string().optional()
});

export const putDocumentSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    content: z.union([
        z.object({}).passthrough(),
        z.string().nonempty("Content is required").refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]).optional(),
    summary: z.string().optional(),
    folder_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional()
}).refine(data => {
    const { folder_id, space_id, group_id } = data;
    const keys = [folder_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, space_id, or group_id must be present
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

export const putPageMetaSchema = z.object({
    page_content_id: z.string().nonempty("Page content ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    page_type: z.string().optional(),
    title: z.string().optional(),
    last_updated_by: z.string().optional(),
    custom_meta: z.union([
        z.object({}).passthrough(),
        z.string().refine(isValidJson, {
            message: "Custom meta must be a valid JSON string",
        })
    ]).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    attachments: z.string().optional()
});

export const getDocumentSchema = z.object({
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

export const deleteDocumentSchema = z.object({
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