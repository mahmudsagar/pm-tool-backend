import { z } from 'zod';
import { registerUserSchema } from './config/validation.js';
import { issueAuthForUser } from '../utils/issueAuthResponse.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const body = request.body;

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

        // Create default workspace for the new user
        await global.Workspace.create({
            name: `${name}'s Workspace`,
            owner_id: newUser._id,
            members: [],
        }).fetch();

        const authData = await issueAuthForUser(newUser);

        response.json(formatSuccessMessage("Registration successful", authData));
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
