import { z } from 'zod';
import { putPageMetaSchema, putPageContentSchema } from './config/validation.js';
import { postCommentContentSchema, putCommentContentSchema, putInnerCommentMetaSchema } from '../../comment/config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, ...rest } = await request.json();

        let mediaAttachments = [];
        let comments = [];
        let pageContentResult, pageMetaResult;

        const pageMetaData = putPageMetaSchema.parse({
            _id,
            page_type: rest.page_type,
            title: rest.title,
            folder_id: rest.folder_id,
            space_id: rest.space_id,
            group_id: rest.group_id,
            custom_meta: rest.custom_meta,
            shared_members: rest.shared_members,
            shared_teams: rest.shared_teams,
            attachments: rest.attachments,
            last_updated_by: rest.last_updated_by,
            pinned: rest.pinned,
            entity_type: rest.entity_type,
        });

        pageMetaResult = await global.PageMeta.update(
            { _id },
            pageMetaData
        ).fetch();

        if (!pageMetaResult || !pageMetaResult.length) {
            return response.status(404).json(formatErrorMessage('PageMeta not found'));
        }

        if (pageMetaResult.length > 0) pageMetaResult = pageMetaResult[0];

        if (rest.content || rest.summary) {
            const pageContentData = putPageContentSchema.parse({
                _id: pageMetaResult.page_content_id,
                content: rest.content,
                summary: rest.summary,
            });

            pageContentResult = await global.PageContent.update(
                { _id: pageMetaResult.page_content_id },
                pageContentData
            ).fetch();
            if (!pageContentResult || !pageContentResult.length) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }

            if (pageContentResult.length > 0) pageContentResult = pageContentResult[0];
        } else {
            pageContentResult = await global.PageContent.findOne({ _id: pageMetaResult.page_content_id });
            if (!pageContentResult) {
                return response.status(404).json(formatErrorMessage('PageContent not found'));
            }
        }

        if (pageMetaResult.attachments && pageMetaResult.attachments.length > 0) {
            mediaAttachments = await Promise.all(
                pageMetaResult.attachments.map(async (attachment) => {
                    return await global.Media.findOne({ reference_id: pageMetaResult._id });
                })
            );
        }

        const commentsMeta = await global.CommentMeta.find({ page_id: pageMetaResult._id, inner_comment: false });
        const commentsWithMeta = await Promise.all(
            commentsMeta.map(async (comment) => {
                const commentContent = await global.CommentContent.findOne({ _id: comment.associate_id });
                const mediaAttachments = comment.attachments && comment.attachments.length > 0
                    ? await Promise.all(
                        comment.attachments.map(async (attachment) => {
                            return await global.Media.findOne({ reference_id: comment._id });
                        })
                    )
                    : [];

                return { ...comment, commentContent, mediaAttachments };

            })
        );

        // Handle inner_comments
        const innerComments = rest.inner_comments || [];
        const innerCommentResults = [];

        for (const comment of innerComments) {
            let commentContentResult = {};
            let commentMetaResult;

            // Validate the comment_meta part of the request body
            const commentMetaData = putInnerCommentMetaSchema.parse({
                _id: comment.id,
                comment_body: comment.comment_body,
                inner_comment: comment.inner_comment,
                parent_id: comment.parent_id,
            });

            if (commentMetaData._id) {
                // Fetch the existing CommentMeta
                const existingCommentMeta = await global.CommentMeta.findOne({ _id: commentMetaData._id });
                if (!existingCommentMeta) {
                    // If no existing comment, create a new one
                    if (comment.content && Object.keys(comment.content).length > 0) {
                        // Validate the comment_content part of the request body
                        const commentContentData = postCommentContentSchema.parse({
                            user_id: comment.user_id,
                            content: comment.content,
                        });

                        // Save the validated comment_content data to MongoDB
                        commentContentResult = await global.CommentContent.create(commentContentData).fetch();
                    }

                    // Save the validated comment_meta data to MongoDB
                    commentMetaResult = await global.CommentMeta.create({
                        ...commentMetaData,
                        user_id: comment.user_id,
                        associate_id: commentContentResult._id || '',
                    }).fetch();

                    // Check if the parent_id is present
                    if (commentMetaData.parent_id) {
                        const parentComment = await global.CommentMeta.findOne({ _id: commentMetaData.parent_id });
                        if (!parentComment) {
                            throw new Error("Parent comment not found");
                        }

                        // Updating the parent comment
                        await global.CommentMeta.updateOne({ _id: commentMetaData.parent_id }).set({ has_childs: true }).fetch();
                    }
                } else {
                    // If existing comment, update it
                    if (!existingCommentMeta.associate_id && comment.content && Object.keys(comment.content).length > 0) {
                        // Validate the comment_content part of the request body
                        const commentContentData = postCommentContentSchema.parse({
                            user_id: comment.user_id,
                            content: comment.content,
                        });

                        // Save the validated comment_content data to MongoDB
                        commentContentResult = await global.CommentContent.create(commentContentData).fetch();

                        // Update the associate_id in CommentMeta
                        await global.CommentMeta.updateOne({ _id: commentMetaData._id }).set({ associate_id: commentContentResult._id }).fetch();
                    } else if (comment.content) {
                        // Validate the comment_content part of the request body
                        const commentContentData = putCommentContentSchema.parse({
                            _id: existingCommentMeta.associate_id,
                            content: comment.content,
                        });

                        // Update the validated comment_content data in MongoDB
                        commentContentResult = await global.CommentContent.updateOne({ _id: existingCommentMeta.associate_id }).set(commentContentData).fetch();
                    }

                    // Update the validated comment_meta data in MongoDB
                    commentMetaResult = await global.CommentMeta.updateOne({ _id: commentMetaData._id }).set(commentMetaData).fetch();
                }
            } else {
                // If no _id, create a new comment
                if (comment.content && Object.keys(comment.content).length > 0) {
                    // Validate the comment_content part of the request body
                    const commentContentData = postCommentContentSchema.parse({
                        user_id: comment.user_id,
                        content: comment.content,
                    });

                    // Save the validated comment_content data to MongoDB
                    commentContentResult = await global.CommentContent.create(commentContentData).fetch();
                }

                // Save the validated comment_meta data to MongoDB
                commentMetaResult = await global.CommentMeta.create({
                    ...commentMetaData,
                    user_id: comment.user_id,
                    associate_id: commentContentResult._id || '',
                }).fetch();

                // Check if the parent_id is present
                if (commentMetaData.parent_id) {
                    const parentComment = await global.CommentMeta.findOne({ _id: commentMetaData.parent_id });
                    if (!parentComment) {
                        throw new Error("Parent comment not found");
                    }

                    // Updating the parent comment
                    await global.CommentMeta.updateOne({ _id: commentMetaData.parent_id }).set({ has_childs: true }).fetch();
                }
            }

            // Fetch child comments for the inner comment
            const childComments = await global.CommentMeta.find({ parent_id: commentMetaResult._id });
            const childCommentsWithMeta = await Promise.all(
                childComments.map(async (childComment) => {
                    const childCommentContent = await global.CommentContent.findOne({ _id: childComment.associate_id });
                    const childMediaAttachments = childComment.attachments && childComment.attachments.length > 0
                        ? await Promise.all(
                            childComment.attachments.map(async (attachment) => {
                                return await global.Media.findOne({ _id: attachment });
                            })
                        )
                        : [];
                    return { ...childComment, commentContent: childCommentContent, mediaAttachments: childMediaAttachments };
                })
            );

            innerCommentResults.push({ ...commentMetaResult, commentContent: commentContentResult, childComments: childCommentsWithMeta });
        }

        // Fetch inner comments from the database to ensure they are up-to-date
        const updatedInnerComments = await global.CommentMeta.find({ page_id: pageMetaResult._id, inner_comment: true });
        const updatedInnerCommentsWithMeta = await Promise.all(
            updatedInnerComments.map(async (innerComment) => {
                const innerCommentContent = await global.CommentContent.findOne({ _id: innerComment.associate_id });

                // Fetch child comments for inner comments
                const childComments = await global.CommentMeta.find({ parent_id: innerComment._id });
                const childCommentsWithMeta = await Promise.all(
                    childComments.map(async (childComment) => {
                        const childCommentContent = await global.CommentContent.findOne({ _id: childComment.associate_id });
                        const childMediaAttachments = childComment.attachments && childComment.attachments.length > 0
                            ? await Promise.all(
                                childComment.attachments.map(async (attachment) => {
                                    return await global.Media.findOne({ _id: attachment });
                                })
                            )
                            : [];
                        return { ...childComment, commentContent: childCommentContent, mediaAttachments: childMediaAttachments };
                    })
                );

                return { ...innerComment, commentContent: innerCommentContent, childComments: childCommentsWithMeta };
            })
        );

        response.json(formatSuccessMessage("Page updated successfully", { ...pageMetaResult, mediaAttachments, pageContent: pageContentResult, comments: commentsWithMeta, innerComments: updatedInnerCommentsWithMeta }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};