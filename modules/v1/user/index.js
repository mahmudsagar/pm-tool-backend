import { z } from 'zod';
import { getUserSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id } = request.query;

        let result;
        let mediaAttachments = [];
        if (id) {
            // Validate the _id if present in query
            const validatedParams = getUserSchema.parse({ _id: id });

            // Fetch data by _id
            result = await global.User.findOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('User not found'));
            }

            // Fetch media attachments
            mediaAttachments = await Promise.all(result.attachments.map(async (attachment) => {
                return await global.Media.findOne({ _id: attachment });
            }));

        } else {
            // Fetch all data
            result = await global.User.find();
        }

        response.json(formatSuccessMessage("Users fetched successfully", { ...result, mediaAttachments }));
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