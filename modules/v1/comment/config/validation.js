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

export const postCommentSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    page_id: z.string().optional(),
    parent_id: z.string().optional(),
    content: z.union([
        z.object({}).passthrough(),
        z.string().nonempty("Content is required").refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]).optional(),
}).refine(data => {
    const { page_id, parent_id } = data;
    const keys = [page_id, parent_id];
    const presentKeys = keys.filter(key => key !== undefined && key !== '');
    if (presentKeys.length === 0) {
        return false; // One of page_id or parent_id must be present
    }

    if (presentKeys.length > 1) {
        return false; // Both of page_id or parent_id cannot be present
    }
    return true;
}, {
    message: "One of page_id or parent_id must be present",
    path: ["page_id", "parent_id"]
}).refine(data => {
    if (data.page_id && !isValidObjectId(data.page_id)) {
        return false;
    }
    if (data.parent_id && !isValidObjectId(data.parent_id)) {
        return false;
    }
    return true;
}, {
    message: "Invalid MongoDB ObjectId",
    path: ["page_id", "parent_id"]
});

export const postCommentMetaSchema = z.object({
    associate_id: z.string().nonempty("Associate ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    comment_body: z.string().nonempty("Comment body is required"),
    // attachments: z.array().optional()
});


export const putCommentSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    content: z.union([
        z.object({}).passthrough(),
        z.string().optional().refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]).optional(),
});

export const putCommentMetaSchema = z.object({
    associate_id: z.string().nonempty("Associate ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    comment_body: z.string().optional(),
    // attachments: z.array().optional()
});

export const getCommentSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })
})

export const deleteCommentSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })
});