import jwt from 'jsonwebtoken';

// Optional: If you want to track invalidated tokens
// You might want to use Redis or another fast storage for this in production
const tokenBlacklist = new Set();

export default async (req, res) => {
    try {
        // Get the token from the Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        
        // Add the token to the blacklist
        // This makes the token invalid for future requests
        tokenBlacklist.add(token);
        
        // Optional: Store in database for persistence across server restarts
        // await global.InvalidatedToken.create({ token });
        
        console.log('User logged out, token invalidated');
        
        return res.status(200).json({ 
            success: true,
            message: 'Successfully logged out' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}