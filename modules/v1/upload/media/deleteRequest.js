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
        const { id: _id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteMediaSchema.parse({ _id });

        // Find the media by _id
        const media = await global.Media.findOne({ _id: validatedParams._id });
        if (!media || media.length) {
            return response.status(400).json({ status: 'failed', error: 'No media found with this id!' });
        }

        if (media.length && media[0]?.url) {
            // Delete the image from R2
            const urlParts = media[0].url.split('/');
            const fileName = urlParts[urlParts.length - 1];
            const deleteParams = {
                Bucket: process.env.R2_BUCKET,
                Key: fileName,
            };

            await s3Client.send(new DeleteObjectCommand(deleteParams));
            // return response.status(404).json({ status: 'failed', error: 'Media not found' });
        }

        // Delete the data by _id from MongoDB
        const result = await global.Media.destroyOne({ _id: validatedParams._id });
        if (!result) {
            return response.status(404).json({ status: 'failed', error: 'Media not found' });
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