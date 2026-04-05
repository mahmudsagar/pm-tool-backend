import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';


/**
 * Middleware to validate JWT token.
 * @param {Object} request - The request object.
 * @param {Object} response - The response object.
 * @param {Function} next - The next middleware function.
 */
export default function jwtValidation(request, response, next) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return response.status(401).json(formatErrorMessage("No token provided"));
    }

    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            if (err instanceof z.ZodError) {
                const formattedErrors = formatZodErrors(err.errors);
                return response.status(400).json(formatErrorMessage(formattedErrors));
            } else {
                return response.status(400).json(formatErrorMessage(err.message));
            }
        }
        
        request.user = {
            id: decoded.id,
            email: decoded.email
        };
        request.workspaceId = request.headers['x-workspace-id'] || null;
        next();
    });
}