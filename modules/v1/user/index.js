import { z } from 'zod';
import { getUserSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, search } = request.query;

        let result, output;
        let mediaAttachments = [];

        if (id || search) {
            const validatedParams = getUserSchema.parse({ _id: id, search });

            if (validatedParams._id) {
                result = await global.User.findOne({ _id: validatedParams._id });
                if (!result) {
                    return response.status(404).json(formatErrorMessage('User not found'));
                }

                const attachments = Array.isArray(result.attachments) ? result.attachments : [];
                mediaAttachments = await Promise.all(
                    attachments.map(async (attachment) => {
                        return await global.Attachment.findOne({ _id: attachment });
                    })
                );

                const workspaces = await global.Space.find({ user_id: validatedParams._id });
                if (!workspaces || workspaces.length === 0) {
                    result.workspaces_flag = false;
                } else {
                    result.workspaces_flag = true;
                }

                const { password, ...userWithoutPassword } = result;
                result = userWithoutPassword;
                output = { ...result, mediaAttachments };

            } else if (validatedParams.search) {
                const searchRegex = validatedParams.search;
            
                result = await global.User.find({
                    where: {
                        or: [
                            { name: { contains: searchRegex } },
                            { email: { contains: searchRegex } }
                        ],
                        _id: request.user.id
                    },
                    select: ['name', 'email']
                });
            
                if (!result || result.length === 0) {
                    return response.status(404).json(formatErrorMessage('No users found matching the search criteria'));
                }
                output = result;
            }

        }
        // else {
        //     result = await global.User.find({
        //         select: ['_id', 'name', 'email', 'attachments', 'createdAt', 'updatedAt']
        //     });
        // }

        response.json(formatSuccessMessage("Users fetched successfully", output));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};