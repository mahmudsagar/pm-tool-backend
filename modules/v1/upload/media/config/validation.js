import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postMediaSchema = z.object({
    reference_id: z.string().nonempty("Reference ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    reference_for: z.enum(['page', 'comment', 'user', 'space', 'message', 'workspace'], {
        errorMap: () => ({ message: 'Invalid reference_for value. Allowed values are page, comment, user, space, message, and workspace.' })
    }),
    media_type: z.enum(['cover_photo', 'icon', 'comment_attachment', 'chat_attachment'], {
        errorMap: () => ({ message: 'Invalid media type. Allowed types are cover_photo, comment_attachment, icon, and chat_attachment.' })
    }),
    caption: z.string().optional(),
    description: z.string().optional(),
    meta_data: z.object({}).optional()
}).refine((data) => data.reference_for !== 'workspace' || data.media_type === 'icon', {
    message: "media_type must be 'icon' when reference_for is 'workspace'",
    path: ['media_type'],
});

export const putMediaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    reference_id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    reference_for: z.enum(['page', 'comment', 'user', 'space', 'message'], {
        errorMap: () => ({ message: 'Invalid reference_for value. Allowed values are page, comment, user, space, and message.' })
    }).optional(),
    media_type: z.enum(['cover_photo', 'icon', 'comment_attachment', 'chat_attachment'], {
        errorMap: () => ({ message: 'Invalid media type. Allowed types are cover_photo, comment_attachment, icon, and chat_attachment.' })
    }).optional(),
    caption: z.string().optional(),
    description: z.string().optional(),
    meta_data: z.object({}).optional(),
});

export const getMediaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});

export const deleteMediaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    reference_for: z.enum(['page', 'comment', 'user'], {
        errorMap: () => ({ message: 'Invalid reference_for value. Allowed values are page and comment.' })
    }),
});