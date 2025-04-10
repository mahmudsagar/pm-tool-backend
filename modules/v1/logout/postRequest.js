import { z } from 'zod';
import { formatSuccessMessage } from '../utils/success.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
// Optional: If you want to track invalidated tokens
// You might want to use Redis or another fast storage for this in production
const tokenBlacklist = new Set();

export default async (request, response) => {
    try {
        // Get the token from the Authorization header
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return response.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];

        // Add the token to the blacklist
        // This makes the token invalid for future requests
        tokenBlacklist.add(token);

        // Optional: Store in database for persistence across server restarts
        // await global.InvalidatedToken.create({ token });

        return response.json(formatSuccessMessage("Successfully logged out"));
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