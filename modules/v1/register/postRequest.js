import jwt from 'jsonwebtoken';

export default async (request, res) => {
    console.log('Registering user...');
    
    try {
        const { email, password } = await request.json();;
        
        // Check if user already exists
        const existingUser = await global.User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }
        
        // Validate password (optional - add your rules)
        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }
        
        // Create new user
        const newUser = await global.User.create({ 
            email, 
            password  // Password will be hashed by beforeCreate hook
        }).fetch();
        
        // Generate JWT token
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email }, 
            process.env.JWT_SECRET || 'your-jwt-secret',
            { expiresIn: '24h' }
        );
        
        // Remove password from response
        const { password: _, ...userWithoutPassword } = newUser;
        
        res.status(201).json({ 
            message: 'Registration successful', 
            user: userWithoutPassword,
            token
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
}