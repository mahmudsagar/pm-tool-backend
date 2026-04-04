import { z } from 'zod';
import passport from "passport";
import jwt from 'jsonwebtoken';
import { loginUserSchema } from '../config/validation.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';

export default async (request, response, next) => {
    try {
        const body = await request.json();

        const validatedData = loginUserSchema.parse(body);

        request.body = validatedData;

        passport.authenticate('local', { session: false }, async (err, user, info) => {
            if (err) {
                console.error('Authentication error:', err);
                return response.status(501).json(formatErrorMessage("Authentication error"));
            }

            if (!user) {
                return response.status(400).json(formatErrorMessage("Authentication failed"));
            }

            const token = jwt.sign(
                { id: user._id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN }
            );

            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await global.Auth.destroy({ user_id: user._id });

            await global.Auth.create({
                user_id: user._id,
                token: token,
                expires_at: expiresAt
            });

            const { password, ...userWithoutPassword } = user;

            const workspaces = await global.Workspace.find({
                or: [
                    { owner_id: userWithoutPassword._id },
                    { members: { contains: userWithoutPassword._id } }
                ]
            });
            userWithoutPassword.workspaces_flag = workspaces && workspaces.length > 0;

            return response.json(formatSuccessMessage("Login successful",
                { user_info: userWithoutPassword, workspaces, token }
            ));
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