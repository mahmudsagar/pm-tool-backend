import HyperExpress from 'hyper-express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
const webserver = new HyperExpress.Server();
import initializeWaterline from './models/index.js';
import cors from 'cors';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { verifyPassword } from './models/user.js';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3001;

// Configure CORS for all routes
// Replace your current CORS handling with this

// Set up CORS - specific for frontend on port 5173
webserver.options('*', (req, res) => {
    // Specific origin instead of wildcard for better security
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.status(204).send();
});

// Global middleware for CORS
webserver.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle actual OPTIONS requests
    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});

// Add this before your route loading 
// Add cookie parser
// webserver.use(cookieParser());

// Session middleware must be added before Passport initialization
// webserver.use(session({
//     secret: process.env.SESSION_SECRET || 'your-secret-key',
//     resave: false,
//     saveUninitialized: false,
//     cookie: { 
//         secure: process.env.NODE_ENV === 'production',
//         maxAge: 24 * 60 * 60 * 1000 // 24 hours
//     }
// }));

passport.use(
    new LocalStrategy(
        { usernameField: 'email', passwordField: 'password' },
        async (email, password, done) => {
            try {
                // Find user by email using Waterline
                const user = await global.User.findOne({ email });
                if (!user) {
                    return done(null, false, { message: 'Incorrect email.' });
                }

                // Verify password using the verifyPassword function
                const isValidPassword = await verifyPassword(user, password);
                if (!isValidPassword) {
                    return done(null, false, { message: 'Incorrect password.' });
                }

                return done(null, user);
            } catch (error) {
                return done(error);
            }
        }
    )
);

// Configure JWT strategy
const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET || 'your-jwt-secret'
};

passport.use(new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
    try {
        const user = await global.User.findOne({ id: jwtPayload.id });
        if (user) {
            return done(null, user);
        }
        return done(null, false);
    } catch (error) {
        return done(error, false);
    }
}));

// Serialize user into session
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
    try {
        const user = await global.User.findOne({ id });
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Initialize passport middleware - AFTER session middleware
webserver.use(passport.initialize());
// webserver.use(passport.session());

// // Add login and register routes
// webserver.post('/login', (req, res, next) => {
//     passport.authenticate('local', (err, user, info) => {
//         if (err) {
//             return res.status(500).json({ message: 'Authentication error', error: err.message });
//         }
//         if (!user) {
//             return res.status(401).json({ message: info.message || 'Authentication failed' });
//         }

//         req.login(user, (loginErr) => {
//             if (loginErr) {
//                 return res.status(500).json({ message: 'Session error', error: loginErr.message });
//             }

//             // Don't include password in response
//             const { password, ...userWithoutPassword } = user;
//             return res.status(200).json({ 
//                 message: 'Login successful',
//                 user: userWithoutPassword
//             });
//         });
//     })(req, res, next);
// });

// // User registration route
// webserver.post('/register', async (req, res) => {
//     try {
//         const { email, password } = req.body;

//         // Check if user already exists
//         const existingUser = await waterline.collections.user.findOne({ email });
//         if (existingUser) {
//             return res.status(400).json({ message: 'User with this email already exists' });
//         }

//         // Create new user
//         const newUser = await waterline.collections.user.create({ 
//             email, 
//             password
//         }).fetch();

//         // Remove password from response
//         const { password: _, ...userWithoutPassword } = newUser;

//         res.status(201).json({ 
//             message: 'Registration successful', 
//             user: userWithoutPassword 
//         });
//     } catch (error) {
//         console.error('Registration error:', error);
//         res.status(500).json({ message: 'Registration failed', error: error.message });
//     }
// });

async function loadRoutes(directory, baseRoute = '') {
    const filesAndFolders = fs.readdirSync(directory, { withFileTypes: true });
    // Skip processing if the folder is empty
    if (filesAndFolders.length === 0) {
        return;
    }
    for (const entry of filesAndFolders) {
        // Skip the 'config' folder
        if (entry.name === 'config' && entry.isDirectory()) {
            continue;
        }

        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {

            // Check if the directory name is a route parameter
            let updatedBaseRoute = baseRoute;
            updatedBaseRoute = `${baseRoute}/${entry.name}`;
            // Recursively load routes for nested directories
            await loadRoutes(fullPath, updatedBaseRoute);
        } else {
            // Determine the route and method based on the file name
            let [routeName, method] = entry.name.split('.');
            // Default to 'get' method for 'index.js' files
            if (routeName === 'index') {
                method = 'get'; // Correct method for 'index.js'
            } else {
                // Adjust method based on specific naming conventions
                switch (routeName) {
                    case 'postRequest':
                        method = 'post';
                        break;
                    case 'putRequest':
                        method = 'put';
                        break;
                    case 'deleteRequest':
                        method = 'delete';
                        break;
                    default:
                        method = 'get'; // Default to 'get' for any other cases
                        break;
                }
            }
            if (['index', 'postRequest', 'putRequest', 'deleteRequest'].includes(routeName)) {

                // Determine the route path
                let routePath = baseRoute;
                if (routeName !== 'index') {
                    // For files named 'postRequest', 'putRequest', etc., do not append the method name to the route
                    routePath = baseRoute; // Keep the base route as is for these special cases
                } else {
                    // For 'index.js' files or any other special cases, use the base route directly
                    routePath = baseRoute;
                }

                const handler = (await import(pathToFileURL(fullPath).href)).default;

                // Load middleware if exists
                const middlewareFiles = ['index.middleware', `${method}.middleware`].map(m => `${directory}/${m}.js`);
                const middlewares = await Promise.all(
                    middlewareFiles
                        .filter(file => fs.existsSync(file))
                        .map(async file => {
                            const module = await import(pathToFileURL(file).href);
                            return module.default;
                        })
                );

                console.log(`Route loaded: ${method.toUpperCase()} ${routePath}`);
                // console.log(`Middlewares loaded: ${middlewares.map(m => m.name).join(', ')}`);

                // Create the route with middleware and handler
                switch (method) {
                    case 'get':
                        if (middlewares.length > 0) {
                            webserver.get(routePath, ...middlewares, handler);
                        } else {
                            webserver.get(routePath, handler);
                        }
                        break;
                    case 'post':
                        if (middlewares.length > 0) {
                            webserver.post(routePath, ...middlewares, handler);
                        } else {
                            webserver.post(routePath, handler);
                        }
                        break;
                    case 'put':
                        if (middlewares.length > 0) {
                            webserver.put(routePath, ...middlewares, handler);
                        } else {
                            webserver.put(routePath, handler);
                        }
                        break;
                    case 'delete':
                        if (middlewares.length > 0) {
                            webserver.delete(routePath, ...middlewares, handler);
                        } else {
                            webserver.delete(routePath, handler);
                        }
                        break;
                }
            }
        }
    }
}

async function startServer() {
    try {
        console.log('Starting the server...', PORT);
        await initializeWaterline();
        await webserver.listen(parseInt(PORT), () => {
            console.log(`Server is listening on port ${PORT}`);
        });
        // console.log('Server is listening on port 3000');
    } catch (error) {
        console.error('Failed to start the server:', error);
        // Handle specific error codes if necessary
        if (error.code === 'ERR_UNHANDLED_REJECTION') {
            console.error('Possible reasons: Invalid host or busy port.');
        }
        process.exit(1); // Exit the process with a failure code
    }
}

// Serve the index.html file for the base URL '/'
webserver.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'matrix', 'index.html');
    res.type('text/html').sendFile(indexPath);
});

// Load routes from the 'modules' folder and start the server
loadRoutes(path.join(__dirname, 'modules')).then(() => {
    startServer();
});