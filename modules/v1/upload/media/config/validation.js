import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const postMediaSchema = z.object({
    reference_id: z.string().nonempty("Reference ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    media_type: z.string().nonempty("Media type is required"),
    caption: z.string().optional(),
    description: z.string().optional(),
    meta_data: z.object({}).optional(),
});

export const putMediaSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    reference_id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    media_type: z.string().optional(),
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
});