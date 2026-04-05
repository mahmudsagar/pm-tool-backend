import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { registerUserSchema } from './config/validation.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        // Validate request body
        const validatedData = registerUserSchema.parse(body);
        const { name, email, password } = validatedData;

        // Check if user already exists
        const existingUser = await global.User.findOne({ email });
        if (existingUser) {
            return response.status(400).json(formatErrorMessage("User with this email already exists"));
        }

        // Create new user
        const newUser = await global.User.create({
            name,
            email,
            // password will be hashed by the beforeCreate hook
            password
        }).fetch();

        // Generate JWT token
        const token = jwt.sign(
            { id: newUser._id, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await global.Auth.destroy({ user_id: newUser._id });

        await global.Auth.create({
            user_id: newUser._id,
            token: token,
            expires_at: expiresAt
        });

        // Create default workspace for the new user
        const defaultWorkspace = await global.Workspace.create({
            name: `${name}'s Workspace`,
            owner_id: newUser._id,
            members: [],
        }).fetch();

        // Remove password from response
        const { password: _, ...userWithoutPassword } = newUser;

        // Find workspaces for this user (owned or member of)
        const workspaces = await global.Workspace.find({
            or: [
                { owner_id: newUser._id },
                { members: { contains: newUser._id } }
            ]
        });
        userWithoutPassword.workspaces_flag = workspaces && workspaces.length > 0;

        // Send success response
        response.json(formatSuccessMessage("Registration successful",
            {
                user_info: userWithoutPassword,
                workspaces,
                token
            }));
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