import { z } from 'zod';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { postMediaSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(file.originalname.toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('File type not supported. Only jpg, jpeg, and png are allowed.'));
        }
    }
}).single('file');

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
                    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                        return reject(new Error('File size exceeds the limit of 1MB.'));
                    }
                    return reject(err);
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

        // Handle reference_for logic
        const { reference_for, reference_id } = body;

        if (reference_for === 'page') {
            const pageMeta = await global.PageMeta.findOne({ _id: reference_id });
            if (!pageMeta) {
                throw new Error('Something went wrong when finding page');
            }

            pageMeta.attachments = pageMeta.attachments || [];
            pageMeta.attachments.push(result._id);
            await global.PageMeta.updateOne({ _id: reference_id }).set({ attachments: pageMeta.attachments });
        } else if (reference_for === 'comment') {
            const commentMeta = await global.CommentMeta.findOne({ _id: reference_id });
            if (!commentMeta) {
                throw new Error('CommentMeta not found');
            }

            commentMeta.attachments = commentMeta.attachments || [];
            commentMeta.attachments.push(result._id);
            await global.CommentMeta.updateOne({ _id: reference_id }).set({ attachments: commentMeta.attachments });
        } else {
            throw new Error('Invalid reference_for value. Allowed values are page and comment.');
        }

        response.json(formatSuccessMessage('Media created successfully', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            // Handle other errors
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};