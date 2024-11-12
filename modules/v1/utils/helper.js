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

export const deleteCommentAndChildren = async (commentId) => {
    const commentMeta = await global.CommentMeta.findOne({ _id: commentId });
    if (!commentMeta) {
        throw new Error('Comment not found');
    }

    if (commentMeta.attachments && commentMeta.attachments.length > 0) {
        await deleteAttachments(commentMeta.attachments);
    }

    await global.CommentMeta.destroy({ _id: commentId });
    await global.CommentContent.destroyOne({ _id: commentMeta.associate_id });

    const childCommentMetas = await global.CommentMeta.find({ parent_id: commentId });
    for (const childCommentMeta of childCommentMetas) {
        await deleteCommentAndChildren(childCommentMeta._id);
    }
};

export const deleteFolderAndChildren = async (folderId) => {
    const childFolders = await global.Folder.find({ parent_id: folderId });
    for (const childFolder of childFolders) {
        await deleteFolderAndChildren(childFolder._id);
    }

    const pageMetas = await global.PageMeta.find({ folder_id: folderId });
    for (const pageMeta of pageMetas) {
        await global.PageContent.destroyOne({ _id: pageMeta.page_content_id });

        if (pageMeta.attachments && pageMeta.attachments.length > 0) {
            await deleteAttachments(pageMeta.attachments);
        }

        const commentMetas = await global.CommentMeta.find({ page_id: pageMeta._id });
        for (const commentMeta of commentMetas) {
            await deleteCommentAndChildren(commentMeta._id);
        }

        await global.PageMeta.destroyOne({ _id: pageMeta._id });
    }

    await global.Folder.destroyOne({ _id: folderId });
};