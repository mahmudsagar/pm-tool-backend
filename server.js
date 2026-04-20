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
import jwtValidation from './modules/v1/middlewares/jwtValidation.js';
import authorizationMiddleware from './modules/v1/middlewares/authorization.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3001;

// Configure CORS for all routes
// Replace your current CORS handling with this

// Global middleware for CORS
webserver.use((req, res, next) => {
    const origin = req.headers['origin'];
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Workspace-ID');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});

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

                // Exclude 'register' and 'login' routes from JWT validation
                const isExcludedRoute = routePath.includes('/register') || routePath.includes('/login');
                const middlewares = isExcludedRoute ? [] : [jwtValidation, authorizationMiddleware];

                console.log(`Route loaded: ${method.toUpperCase()} ${routePath}`);
                // console.log(`Middlewares loaded: ${middlewares.map(m => m.name).join(', ')}`);

                // Create the route with middleware and handler
                switch (method) {
                    case 'get':
                        webserver.get(routePath, ...middlewares, handler);
                        break;
                    case 'post':
                        webserver.post(routePath, ...middlewares, handler);
                        break;
                    case 'put':
                        webserver.put(routePath, ...middlewares, handler);
                        break;
                    case 'delete':
                        webserver.delete(routePath, ...middlewares, handler);
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