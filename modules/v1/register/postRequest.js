import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { registerUserSchema } from './config/validation.js';
import { formatSuccessMessage } from '../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';

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
            { id: newUser.id, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // Remove password from response
        const { password: _, ...userWithoutPassword } = newUser;
        // Send success response
        response.json(formatSuccessMessage("Registration successful", { user_info: userWithoutPassword, token }));
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