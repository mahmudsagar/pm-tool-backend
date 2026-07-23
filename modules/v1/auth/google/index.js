import passport from 'passport';
import { getFrontendOrigin } from '../utils/issueAuthResponse.js';

export default (request, response, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        const frontend = getFrontendOrigin();
        return response.redirect(`${frontend}/login?error=oauth_not_configured`);
    }

    passport.authenticate('google', {
        scope: ['profile', 'email'],
        session: false,
    })(request, response, next);
};
