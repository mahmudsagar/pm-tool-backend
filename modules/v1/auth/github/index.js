import passport from 'passport';
import { getFrontendOrigin } from '../utils/issueAuthResponse.js';

export default (request, response, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        const frontend = getFrontendOrigin();
        return response.redirect(`${frontend}/login?error=oauth_not_configured`);
    }

    passport.authenticate('github', {
        scope: ['user:email'],
        session: false,
    })(request, response, next);
};
