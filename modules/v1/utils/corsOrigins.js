/**
 * Parse allowed frontend origins from FRONTEND_URL.
 * Supports comma-separated values, e.g.:
 * FRONTEND_URL=http://localhost:5173,https://pm-tool-frontend.vercel.app
 */
export function getAllowedOrigins() {
    const defaults = ['http://localhost:3000', 'http://localhost:5173'];
    const configured = (process.env.FRONTEND_URL || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    return [...new Set([...defaults, ...configured])];
}

export function isOriginAllowed(origin) {
    if (!origin) {
        return true;
    }

    return getAllowedOrigins().includes(origin);
}

export function socketCorsOrigin(origin, callback) {
    if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
    }

    callback(new Error(`Origin not allowed by CORS: ${origin}`));
}
