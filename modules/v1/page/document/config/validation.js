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

export const DOC_STATUSES = ['draft', 'in_review', 'approved', 'published'];

export const postPageContentSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    content: z.union([
        z.object({}).passthrough(),
        z.string().nonempty("Content is required").refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]).optional(),
    summary: z.string().optional(),
});

export const postPageMetaSchema = z.object({
    title: z.string().nonempty("Title is required"),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    folder_id: z.string().optional(),
    board_id: z.string().optional(),
    parent_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
    page_content_id: z.string().nonempty("Page content ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    custom_meta: z.union([
        z.object({}).passthrough(),
        z.string().refine(isValidJson, {
            message: "Custom meta must be a valid JSON string",
        })
    ]).optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    attachments: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    page_type: z.enum(['document', 'sheet', 'whiteboard'], {
        errorMap: () => ({ message: 'Invalid page type. Allowed types are document, sheet, and whiteboard.' })
    }),
    inner_comments: z.array(z.any()).optional(),
    last_updated_by: z.string().optional(),
    entity_type: z.string().optional(),
}).refine(data => {
    const { folder_id, board_id, space_id, group_id } = data;
    const keys = [folder_id, board_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length === 0) {
        return false; // One of folder_id, board_id, space_id, or group_id must be present
    }
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, board_id, space_id, or group_id must be present
    }
    return true;
}, {
    message: "One of folder_id, board_id, space_id, or group_id must be present, and only one can be present",
    path: ["folder_id", "board_id", "space_id", "group_id"]
}).refine(data => {
    if (data.folder_id && !isValidObjectId(data.folder_id)) {
        return false;
    }
    if (data.board_id && !isValidObjectId(data.board_id)) {
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

export const putPageContentSchema = z.object({
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
});

export const putPageMetaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    page_type: z.enum(['document', 'sheet', 'whiteboard'], {
        errorMap: () => ({ message: 'Invalid page type. Allowed types are document, sheet, and whiteboard.' })
    }).optional(),
    title: z.string().optional(),
    folder_id: z.string().optional(),
    board_id: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
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
    attachments: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    last_updated_by: z.string().optional(),
    pinned: z.boolean().optional(),
    entity_type: z.string().optional(),
    inner_comments: z.array(z.any()).optional(),
    icon: z.string().max(64, 'Icon must be at most 64 characters').optional(),
    subtitle: z.string().max(300, 'Subtitle must be at most 300 characters').optional(),
    doc_status: z.enum(DOC_STATUSES, {
        errorMap: () => ({ message: `Invalid doc_status. Allowed values are ${DOC_STATUSES.join(', ')}.` })
    }).optional(),
    cover_position: z.number().int('cover_position must be an integer').min(0).max(100).nullable().optional(),
    locked: z.boolean().optional(),
    /** Position among sibling board tasks (nulls sort last) */
    sort_order: z.number().finite('sort_order must be a finite number').nullable().optional(),
}).refine(data => {
    const { folder_id, board_id, space_id, group_id } = data;
    const keys = [folder_id, board_id, space_id, group_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length > 1) {
        return false; // Only one of folder_id, board_id, space_id, or group_id must be present
    }
    return true;
}, {
    message: "Only one of folder_id, board_id, space_id, or group_id must be present",
    path: ["folder_id", "board_id", "space_id", "group_id"]
}).refine(data => {
    if (data.folder_id && !isValidObjectId(data.folder_id)) {
        return false;
    }
    if (data.board_id && !isValidObjectId(data.board_id)) {
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

/**
 * Partial update of custom_meta.values, merged server-side (a null value deletes the key).
 * Keys are stored as Mongo sub-document fields, so they must not contain '.' or start with '$'.
 */
export const customMetaValuesSchema = z.record(z.any()).refine(
    (obj) => Object.keys(obj).every((k) => k.length > 0 && !k.includes('.') && !k.startsWith('$')),
    { message: "Value keys must be non-empty and must not contain '.' or start with '$'" },
);

export const getPageMetaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});

export const deletePageMetaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});