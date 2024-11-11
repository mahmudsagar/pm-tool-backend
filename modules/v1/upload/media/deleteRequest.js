import { z } from 'zod';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { deleteMediaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

// Configure S3 client for R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

export default async (request, response) => {
    try {
        const { id: _id, reference_for } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteMediaSchema.parse({ _id, reference_for });

        // Find the media by _id
        const media = await global.Media.findOne({ _id: validatedParams._id });
        if (!media) {
            return response.status(400).json({ status: 'failed', error: 'No media found with this id!' });
        }

        // Delete the image from R2
        const urlParts = media.url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const deleteParams = {
            Bucket: process.env.R2_BUCKET,
            Key: fileName,
        };

        await s3Client.send(new DeleteObjectCommand(deleteParams));

        // Delete the data by _id from MongoDB
        const result = await global.Media.destroyOne({ _id: validatedParams._id });
        if (!result) {
            return response.status(404).json({ status: 'failed', error: 'Media not found' });
        }

        // Handle reference_for logic
        if (reference_for === 'page') {
            const pageMeta = await global.PageMeta.findOne({ _id: media.reference_id });
            if (!pageMeta) {
                throw new Error('PageMeta not found');
            }

            pageMeta.attachments = pageMeta.attachments || [];
            const index = pageMeta.attachments.indexOf(validatedParams._id);
            if (index > -1) {
                pageMeta.attachments.splice(index, 1);
                await global.PageMeta.updateOne({ _id: media.reference_id }).set({ attachments: pageMeta.attachments });
            }
        } else if (reference_for === 'comment') {
            const comment = await global.Comment.findOne({ _id: media.reference_id });
            if (!comment) {
                throw new Error('Comment not found');
            }

            const commentMeta = await global.CommentMeta.findOne({ associate_id: media.reference_id });
            if (!commentMeta) {
                throw new Error('CommentMeta not found');
            }

            commentMeta.attachments = commentMeta.attachments || [];
            const index = commentMeta.attachments.indexOf(validatedParams._id);
            if (index > -1) {
                commentMeta.attachments.splice(index, 1);
                await global.CommentMeta.updateOne({ associate_id: media.reference_id }).set({ attachments: commentMeta.attachments });
            }
        } else {
            throw new Error('Invalid reference_for value. Allowed values are page and comment.');
        }

        response.json({
            status: "success", data: [{
                message: 'Media deleted successfully'
            }]
        });
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json({ status: 'failed', error: formattedErrors });
        } else {
            // Handle other errors
            response.status(400).json({ status: 'failed', error: err.message });
        }
    }
};