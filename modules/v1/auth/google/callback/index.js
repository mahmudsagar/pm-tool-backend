import passport from 'passport';
import { issueAuthForUser, getFrontendOrigin } from '../../utils/issueAuthResponse.js';

export default (request, response, next) => {
    const frontend = getFrontendOrigin();

    passport.authenticate('google', { session: false }, async (err, user) => {
        if (err || !user) {
            console.error('Google OAuth error:', err);
            return response.redirect(`${frontend}/login?error=oauth_failed`);
        }

        try {
            const { token } = await issueAuthForUser(user);
            return response.redirect(`${frontend}/oauth/callback?token=${encodeURIComponent(token)}`);
        } catch (error) {
            console.error('Google OAuth token issue error:', error);
            return response.redirect(`${frontend}/login?error=oauth_failed`);
        }
    })(request, response, next);
};
