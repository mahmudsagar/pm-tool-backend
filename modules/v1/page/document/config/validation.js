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
    content: z.union([
        z.object({}).passthrough(),
        z.string().nonempty("Content is required").refine(isValidJson, {
            message: "Content must be a valid JSON string",
        })
    ]),
    summary: z.string().nonempty("Summary is required")
});

export const postPageMetaSchema = z.object({
    page_types: z.string().nonempty("Page type is required"),
    title: z.string().nonempty("Title is required"),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    last_updated_by: z.string().optional(),
    folder_id: z.string().nonempty("Folder ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    custom_meta: z.union([
        z.object({}).passthrough(),
        z.string().refine(isValidJson, {
            message: "Custom meta must be a valid JSON string",
        })
    ]).optional(),
    workspace_id: z.string().nonempty("Workspace ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
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
    summary: z.string().optional()
});

export const putPageMetaSchema = z.object({
    page_content_id: z.string().nonempty("Page content ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    page_types: z.string().optional(),
    title: z.string().optional(),
    user_id: z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).optional(),
    last_updated_by: z.string().optional(),
    folder_id: z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).optional(),
    shared_teams: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    shared_members: z.array(z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })).optional(),
    custom_meta: z.union([
        z.object({}).passthrough(),
        z.string().refine(isValidJson, {
            message: "Custom meta must be a valid JSON string",
        })
    ]).optional(),
    workspace_id: z.string().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).optional(),
});


export const getDocumentSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    })
});