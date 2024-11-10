import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Configure S3 client for R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

/**
 * deleteAttachments
 * Deletes attachments from Media schema and R2 storage.
 * @param {Array} attachments - Array of attachment IDs to be deleted.
 * @return {Promise<void>}
 */
export const deleteAttachments = async (attachments) => {
    for (const attachmentId of attachments) {
        // Find the media by _id
        const media = await global.Media.findOne({ _id: attachmentId });
        if (!media) {
            continue; // Skip if media not found
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
        await global.Media.destroyOne({ _id: attachmentId });
    }
};