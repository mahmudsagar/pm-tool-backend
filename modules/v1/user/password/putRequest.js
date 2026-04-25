import { z } from 'zod';
import { changePasswordSchema } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { verifyPassword } from '../../../../models/user.js';
import bcrypt from 'bcrypt';

export default async (request, response) => {
    try {
        const body = request.body;
        const userId = request.user.id;

        const validatedData = changePasswordSchema.parse(body);

        const user = await global.User.findOne({ _id: userId });
        if (!user) {
            return response.status(404).json(formatErrorMessage('User not found'));
        }

        const isValidPassword = await verifyPassword(user, validatedData.current_password);
        if (!isValidPassword) {
            return response.status(400).json(formatErrorMessage('Current password is incorrect'));
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(validatedData.new_password, salt);

        await global.User.updateOne({ _id: userId }).set({ password: hashedPassword });

        response.json(formatSuccessMessage("Password changed successfully", null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
