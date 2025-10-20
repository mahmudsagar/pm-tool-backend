import jwt from 'jsonwebtoken';
import { formatSuccessMessage } from '../utils/success.js';
import { formatErrorMessage } from '../utils/error.js';

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
            return response.status(401).json(formatErrorMessage("Invalid or expired token"));
        }

        const authRecord = await global.Auth.find({
            token: token,
            user_id: decoded.id
        });

        if (!authRecord || authRecord.length === 0) {
            return response.status(401).json(formatErrorMessage("Token not found in database"));
        }

        const now = new Date();
        if (new Date(authRecord.expires_at) <= now) {
            await global.Auth.destroyOne({ _id: authRecord._id });
            return response.status(401).json(formatErrorMessage("Token has expired"));
        }

        // except pass
        const user = await global.User.find({ email: decoded.email }).select('name');
        if (!user) {
            await global.Auth.destroyOne({ _id: authRecord[0]._id });
            return response.status(401).json(formatErrorMessage("User not found"));
        }

        const workspaces = await global.Space.find({ user_id: user._id });
        user.workspaces_flag = workspaces && workspaces.length > 0;

        return response.json(formatSuccessMessage("Token is valid", {
            user_info: user,
            expires_at: authRecord[0].expires_at
        }));

    } catch (error) {
        console.error('Token verification error:', error);
        return response.status(500).json(formatErrorMessage("Token verification failed"));
    }
};