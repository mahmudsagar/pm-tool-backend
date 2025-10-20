import jwt from 'jsonwebtoken';
import { formatSuccessMessage } from '../../utils/success.js';
import { formatErrorMessage } from '../../utils/error.js';

export default async (request, response) => {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return response.status(401).json(formatErrorMessage("No token provided"));
        }

        const token = authHeader.substring(7);

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (jwtError) {
            return response.status(401).json(formatErrorMessage("Invalid token"));
        }

        const authRecord = await global.Auth.findOne({
            token: token,
            user_id: decoded.id
        });

        if (authRecord) {
            await global.Auth.destroyOne({ _id: authRecord._id });
        }

        return response.json(formatSuccessMessage("Logout successful"));

    } catch (error) {
        console.error('Logout error:', error);
        return response.status(500).json(formatErrorMessage("Logout failed"));
    }
};