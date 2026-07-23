import express from 'express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
import http from 'http';
import { initializeWebSocket } from './modules/v1/utils/websocketService.js';

const app = express();
const httpServer = http.createServer(app);
import initializeWaterline from './models/index.js';
import cors from 'cors';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { verifyPassword } from './models/user.js';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import jwtValidation from './modules/v1/middlewares/jwtValidation.js';
import authorizationMiddleware from './modules/v1/middlewares/authorization.js';
import { findOrCreateOAuthUser } from './modules/v1/auth/utils/issueAuthResponse.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3001;

// Configure CORS for all routes
// Replace your current CORS handling with this

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global middleware for CORS
app.use((req, res, next) => {
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

                if (!user.password) {
                    return done(null, false, {
                        message: 'This account uses social login. Please sign in with Google or GitHub.'
                    });
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

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL,
            },
            async (_accessToken, _refreshToken, profile, done) => {
                try {
                    const email = profile.emails?.[0]?.value;
                    const user = await findOrCreateOAuthUser({
                        provider: 'google',
                        providerId: profile.id,
                        email,
                        name: profile.displayName || email?.split('@')[0],
                        avatar: profile.photos?.[0]?.value,
                    });
                    return done(null, user);
                } catch (error) {
                    return done(error);
                }
            }
        )
    );
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(
        new GitHubStrategy(
            {
                clientID: process.env.GITHUB_CLIENT_ID,
                clientSecret: process.env.GITHUB_CLIENT_SECRET,
                callbackURL: process.env.GITHUB_CALLBACK_URL,
                scope: ['user:email'],
            },
            async (_accessToken, _refreshToken, profile, done) => {
                try {
                    const email =
                        profile.emails?.find((e) => e.primary)?.value ||
                        profile.emails?.[0]?.value;
                    const user = await findOrCreateOAuthUser({
                        provider: 'github',
                        providerId: String(profile.id),
                        email,
                        name: profile.displayName || profile.username || email?.split('@')[0],
                        avatar: profile.photos?.[0]?.value,
                    });
                    return done(null, user);
                } catch (error) {
                    return done(error);
                }
            }
        )
    );
}

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
app.use(passport.initialize());
// app.use(passport.session());

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

                // Exclude public auth and webhook routes from JWT validation
                const isExcludedRoute = routePath.includes('/register')
                    || routePath.includes('/login')
                    || routePath.includes('/webhook')
                    || routePath.includes('/auth/google')
                    || routePath.includes('/auth/github')
                    || routePath === '/v1/auth';
                const middlewares = isExcludedRoute ? [] : [jwtValidation, authorizationMiddleware];

                console.log(`Route loaded: ${method.toUpperCase()} ${routePath}`);
                // console.log(`Middlewares loaded: ${middlewares.map(m => m.name).join(', ')}`);

                // Create the route with middleware and handler
                switch (method) {
                    case 'get':
                        app.get(routePath, ...middlewares, handler);
                        break;
                    case 'post':
                        app.post(routePath, ...middlewares, handler);
                        break;
                    case 'put':
                        app.put(routePath, ...middlewares, handler);
                        break;
                    case 'delete':
                        app.delete(routePath, ...middlewares, handler);
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
        
        // Initialize WebSocket on the same http server as the REST API
        initializeWebSocket(httpServer);
        
        // Single server listening on one port for both REST API and WebSocket
        httpServer.listen(parseInt(PORT), () => {
            console.log(`Server (REST + WebSocket) is listening on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start the server:', error);
        process.exit(1);
    }
}

// Serve the index.html file for the base URL '/'
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'matrix', 'index.html');
    res.type('text/html').sendFile(indexPath);
});

// Load routes from the 'modules' folder and start the server
loadRoutes(path.join(__dirname, 'modules')).then(() => {
    startServer();
});