import passport from "passport";
import jwt from 'jsonwebtoken';

export default async (req, res, next) => {
    try {
        // Get request body - HyperExpress requires manual parsing
        const body = await req.json();
        console.log('Logging in user...', body);
        
        // Set body on req object for Passport
        req.body = body;
        
        passport.authenticate('local', { session: false }, (err, user, info) => {
            if (err) {
                console.error('Authentication error:', err);
                return res.status(500).json({ message: 'Authentication error', error: err.message });
            }
            
            if (!user) {
                return res.status(401).json({ message: info?.message || 'Authentication failed' });
            }
            
            // Generate JWT token
            const token = jwt.sign(
                { id: user.id, email: user.email }, 
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '24h' }
            );
            
            // Don't include password in response
            const { password, ...userWithoutPassword } = user;
            
            return res.status(200).json({ 
                message: 'Login successful',
                user: userWithoutPassword,
                token
            });
        })(req, res, next);
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}