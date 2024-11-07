import { z } from 'zod';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { postMediaSchema } from './config/validation.js';
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

        const validatedData = postMediaSchema.parse(body);

        // Handle file upload
        const file = request.file;

        // Upload file to R2
        const fileName = `${Date.now()}_${file.originalname}`;
        const uploadParams = {
            Bucket: process.env.R2_BUCKET,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        const mediaData = {
            ...validatedData,
            url: `${process.env.R2_URL}/${fileName}`,
        };

        let result = await global.Media.create(mediaData).fetch();
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