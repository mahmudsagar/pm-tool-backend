import { z } from 'zod';
import passport from "passport";
import { loginUserSchema } from '../config/validation.js';
import { issueAuthForUser } from '../utils/issueAuthResponse.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';

export default async (request, response, next) => {
    try {
        const body = request.body;

        const validatedData = loginUserSchema.parse(body);

        request.body = validatedData;

        passport.authenticate('local', { session: false }, async (err, user, info) => {
            if (err) {
                console.error('Authentication error:', err);
                return response.status(501).json(formatErrorMessage("Authentication error"));
            }

            if (!user) {
                return response.status(400).json(formatErrorMessage(info?.message || "Authentication failed"));
            }

            const authData = await issueAuthForUser(user);

            return response.json(formatSuccessMessage("Login successful", authData));
        })(request, response, next);
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
}
