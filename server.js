import HyperExpress from 'hyper-express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
const webserver = new HyperExpress.Server();
import { waterline, dbConfig } from './db/connection.js';
import initializeWaterline from './models/index.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Load environment variables from .env file
dotenv.config();


const PORT = process.env.PORT || 3001;

async function loadRoutes(directory, baseRoute = '') {
    const filesAndFolders = fs.readdirSync(directory, { withFileTypes: true });
    // Skip processing if the folder is empty
    if (filesAndFolders.length === 0) {
        return;
    }
    for (const entry of filesAndFolders) {
        // Skip the 'db' folder
        if (entry.name === 'config' && entry.isDirectory()) {
            continue;
        }

        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            // Check if the directory name is a route parameter
            let updatedBaseRoute = baseRoute;
            if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
                // Convert [:something] to :something as a route parameter
                const paramName = entry.name.replace(/^\[\:/, ':').replace(/\]$/, '');
                updatedBaseRoute = `${baseRoute}/${paramName}`;
            } else {
                updatedBaseRoute = `${baseRoute}/${entry.name}`;
            }
            // Recursively load routes for nested directories
            await loadRoutes(fullPath, updatedBaseRoute);
        } else {
            // Determine the route and method based on the file name
            let [routeName, method] = entry.name.split('.');
            // Default to 'get' method for 'index.js' files
            // console.log(`method: ${entry.name}`);
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

                const handler = (await import(fullPath)).default;

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
        await webserver.listen(parseInt(PORT), () => {
            console.log(`Server is listening on port ${PORT}`);
        })
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
initializeWaterline()


// Load routes from the 'modules' folder and start the server
loadRoutes(path.join(__dirname, 'modules')).then(() => {
    startServer();
});
