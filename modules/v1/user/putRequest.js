import { z } from 'zod';
import { putUserSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { isUniqueViolation } from '../utils/workspaceAccess.js';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export default async (request, response) => {
    try {
        const body = request.body;
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
        if (validatedData.title !== undefined) updateData.title = validatedData.title;
        if (validatedData.pronouns !== undefined) updateData.pronouns = validatedData.pronouns;
        if (validatedData.timezone !== undefined) updateData.timezone = validatedData.timezone;

        if (validatedData.handle !== undefined && validatedData.handle !== user.handle) {
            const taken = await global.User.findOne({ handle: validatedData.handle, _id: { '!=': userId } });
            if (taken) {
                return response.status(409).json(formatErrorMessage('Handle is taken'));
            }
            updateData.handle = validatedData.handle;
        }

        // JSON settings are merged (partial updates), not replaced
        if (validatedData.preferences !== undefined) {
            updateData.preferences = {
                ...(isPlainObject(user.preferences) ? user.preferences : {}),
                ...validatedData.preferences,
            };
        }
        if (validatedData.notification_prefs !== undefined) {
            updateData.notification_prefs = {
                ...(isPlainObject(user.notification_prefs) ? user.notification_prefs : {}),
                ...validatedData.notification_prefs,
            };
        }

        let result;
        try {
            result = await global.User.updateOne({ _id: userId }).set(updateData);
        } catch (updateErr) {
            if (isUniqueViolation(updateErr)) {
                return response.status(409).json(formatErrorMessage('Handle is taken'));
            }
            throw updateErr;
        }

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
