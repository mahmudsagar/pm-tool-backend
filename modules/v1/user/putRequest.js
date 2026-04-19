import { z } from 'zod';
import { putUserSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();
        const userId = request.user.id;

        const validatedData = putUserSchema.parse(body);

        const user = await global.User.findOne({ _id: userId });
        if (!user) {
            return response.status(404).json(formatErrorMessage('User not found'));
        }

        const updateData = {};
        if (validatedData.name !== undefined) updateData.name = validatedData.name;
        if (validatedData.phone !== undefined) updateData.phone = validatedData.phone;
        if (validatedData.avatar !== undefined) updateData.avatar = validatedData.avatar;

        const result = await global.User.updateOne({ _id: userId }).set(updateData);

        const { password: _, ...userWithoutPassword } = result;
        response.json(formatSuccessMessage("Profile updated successfully", userWithoutPassword));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
