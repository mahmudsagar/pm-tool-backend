import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

// Board key: 2-6 letters/digits starting with a letter; stored uppercase.
const boardKeySchema = z.string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z][A-Z0-9]{1,5}$/.test(v), {
        message: 'Key must be 2-6 letters or digits and start with a letter',
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
    /** Tab order on the board Data page (table, kanban, timeline, calendar, scrum, …) */
    layout_tabs_order: z.array(z.string()).optional(),
    scrum: z.object({}).passthrough().optional(),
}).passthrough().nullable();

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
    automations: z.object({}).passthrough().optional(),
    /** Initial tab layout / scrum settings when creating a board */
    saved_view: savedViewSchema.optional(),
    /** Task key prefix; derived from the name when omitted */
    key: boardKeySchema.optional(),
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

const automationRuleSchema = z.object({
    id: z.string().optional(),
    enabled: z.boolean().optional(),
    trigger: z.object({
        field: z.string(),
        operator: z.enum(['equals', 'not_equals']).optional(),
        value: z.any().optional(),
    }).optional(),
    action: z.object({
        type: z.enum(['assign', 'set_status', 'set_priority', 'add_tag', 'set_start_date_offset']),
        value: z.any().optional(),
    }).optional(),
});

const automationsSchema = z.object({
    status: z.boolean().optional(),
    dates: z.boolean().optional(),
    assignment: z.boolean().optional(),
    priority: z.boolean().optional(),
    typeBased: z.boolean().optional(),
    dependency: z.boolean().optional(),
    notifications: z.boolean().optional(),
    recurring: z.boolean().optional(),
    workflowRules: z.array(automationRuleSchema).optional(),
}).passthrough().nullable();

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
    automations: automationsSchema.optional(),
    key: boardKeySchema.optional(),
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