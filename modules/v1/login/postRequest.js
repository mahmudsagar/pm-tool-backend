import { z } from 'zod';
import passport from "passport";
import jwt from 'jsonwebtoken';
import { loginUserSchema } from './config/validation.js';
import { formatSuccessMessage } from '../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';

export default async (request, response, next) => {
    try {
        // Get request body - HyperExpress requires manual parsing
        const body = await request.json();

        const validatedData = loginUserSchema.parse(body);

        // Set body on request object for Passport
        request.body = validatedData;

        passport.authenticate('local', { session: false }, (err, user, info) => {
            if (err) {
                console.error('Authentication error:', err);
                return response.status(501).json(formatErrorMessage("Authentication error"));
            }

            if (!user) {
                return response.status(400).json(formatErrorMessage("Authentication failed"));
            }

            // Generate JWT token
            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN }
            );

            // Don't include password in response
            const { password, ...userWithoutPassword } = user;

            return response.json(formatSuccessMessage("Login successful",
                { user_info: userWithoutPassword, token }
            ));
        })(request, response, next);
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
}