import { z } from 'zod';
import multer from 'multer';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { putMediaSchema } from './config/validation.js';
import { formatZodErrors } from '../../utils/error.js';

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage }).single('file');

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
        // Parse and validate the request body using Zod
        const body = await new Promise((resolve, reject) => {
            upload(request, response, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(request.body);
                }
            });
        });
        const { id: _id, ...rest } = body;
        const validatedData = putMediaSchema.parse({ _id, ...rest });

        // Find the existing media by _id
        const media = await global.Media.findOne({ _id: validatedData._id });
        if (!media || media.length) {
            return response.status(404).json({ status: 'failed', error: 'Media not found' });
        }

        // Check if reference_id is being changed
        if (validatedData.reference_id && validatedData.reference_id !== media?.reference_id) {
            return response.status(400).json({ status: 'failed', error: 'reference_id cannot be changed' });
        }

        // Check if media_type is being changed
        if (validatedData.media_type && validatedData.media_type !== media?.media_type) {
            return response.status(400).json({ status: 'failed', error: 'reference_id cannot be changed' });
        }

        // Handle file upload
        const file = request.file;
        let newUrl = media?.url;

        if (file) {
            // Delete the previous file from R2
            const urlParts = media?.url.split('/');
            const fileName = urlParts[urlParts.length - 1];
            const deleteParams = {
                Bucket: process.env.R2_BUCKET,
                Key: fileName,
            };

            await s3Client.send(new DeleteObjectCommand(deleteParams));

            // Upload new file to R2
            const newFileName = `${Date.now()}_${file.originalname}`;
            const uploadParams = {
                Bucket: process.env.R2_BUCKET,
                Key: newFileName,
                Body: file.buffer,
                ContentType: file.mimetype,
            };

            await s3Client.send(new PutObjectCommand(uploadParams));
            newUrl = `${process.env.R2_URL}/${newFileName}`;
        }

        // Update the media data in MongoDB
        const updatedMediaData = {
            ...validatedData,
            url: newUrl,
        };

        const result = await global.Media.updateOne({ _id: validatedData._id }).set(updatedMediaData);
        if (!result) {
            return response.status(404).json({ status: 'failed', error: 'Media not found' });
        }

        response.json({ status: 'success', data: result });
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