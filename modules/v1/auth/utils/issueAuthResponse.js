import jwt from 'jsonwebtoken';
import { acceptPendingInvitationsForUser } from '../../utils/invitations.js';

/**
 * Issue a JWT, store it in Auth, and return the same payload shape as login/register.
 */
export async function issueAuthForUser(user) {
    const token = jwt.sign(
        { id: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await global.Auth.destroy({ user_id: user._id });

    await global.Auth.create({
        user_id: user._id,
        token,
        expires_at: expiresAt
    });

    // Resolve pending invitations first so the invited workspaces are part of `workspaces`
    await acceptPendingInvitationsForUser(user);

    const { password: _, ...userWithoutPassword } = user;

    const workspaces = await global.Workspace.find({
        or: [
            { owner_id: userWithoutPassword._id },
            { members: { contains: userWithoutPassword._id } }
        ]
    });
    userWithoutPassword.workspaces_flag = workspaces && workspaces.length > 0;

    const workspacesWithRole = workspaces.map(ws => ({
        ...ws,
        role: ws.owner_id === userWithoutPassword._id ? 'owner' : 'member'
    }));

    return {
        token,
        user_info: userWithoutPassword,
        workspaces: workspacesWithRole
    };
}

/**
 * Find an existing OAuth user, auto-link by email, or create a new user + default workspace.
 * @param {{ provider: 'google'|'github', providerId: string, email: string, name: string, avatar?: string }}
 */
export async function findOrCreateOAuthUser({ provider, providerId, email, name, avatar }) {
    if (!email) {
        throw new Error('Email is required from the OAuth provider');
    }

    const providerField = provider === 'google' ? 'google_id' : 'github_id';

    let user = await global.User.findOne({ [providerField]: providerId });
    if (user) {
        await acceptPendingInvitationsForUser(user);
        return user;
    }

    user = await global.User.findOne({ email });
    if (user) {
        const updates = { [providerField]: providerId };
        if (avatar && !user.avatar) {
            updates.avatar = avatar;
        }
        await global.User.updateOne({ _id: user._id }).set(updates);
        const linked = await global.User.findOne({ _id: user._id });
        await acceptPendingInvitationsForUser(linked);
        return linked;
    }

    const createPayload = {
        name: name || email.split('@')[0],
        email,
        [providerField]: providerId,
    };
    if (avatar) {
        createPayload.avatar = avatar;
    }

    const newUser = await global.User.create(createPayload).fetch();

    await global.Workspace.create({
        name: `${newUser.name}'s Workspace`,
        owner_id: newUser._id,
        members: [],
    });

    await acceptPendingInvitationsForUser(newUser);
    return newUser;
}

/**
 * First origin from FRONTEND_URL (comma-separated), used for OAuth redirects.
 */
export function getFrontendOrigin() {
    const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
    return raw.split(',')[0].trim().replace(/\/$/, '');
}
