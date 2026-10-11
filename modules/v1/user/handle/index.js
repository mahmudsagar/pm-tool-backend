import { z } from 'zod';
import { handleQuerySchema, handleSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

// GET /v1/user/handle?handle= -> { available, valid } (the current user's own handle counts as available)
export default async (request, response) => {
    try {
        const { handle } = handleQuerySchema.parse(request.query);

        if (!handleSchema.safeParse(handle).success) {
            return response.json(formatSuccessMessage('Handle checked', { available: false, valid: false }));
        }

        const taken = await global.User.findOne({ handle, _id: { '!=': request.user.id } });
        response.json(formatSuccessMessage('Handle checked', { available: !taken, valid: true }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
