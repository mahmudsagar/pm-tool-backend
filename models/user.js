import Waterline from 'waterline';
import bcrypt from 'bcrypt';

const User = Waterline.Collection.extend({
    identity: 'user',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        password: { type: 'string', required: false },
        google_id: { type: 'string' },
        github_id: { type: 'string' },
        phone: { type: 'string' },
        avatar: { type: 'string' },
        attachments: { type: 'json', defaultsTo: [] },
        // Profile (settings). `handle` is unique when non-empty (native partial index in models/index.js).
        handle: { type: 'string' },
        title: { type: 'string' },
        pronouns: { type: 'string' },
        timezone: { type: 'string' },
        // { accent?: 'indigo'|'emerald'|'violet'|'cyan'|'amber'|'slate', density?: 'compact'|'comfortable' }
        preferences: { type: 'json', defaultsTo: {} },
        // { mentions?, assignments?, updates?: boolean, digest?: 'daily'|'instant'|'off', snooze_until?: ISO|null }
        notification_prefs: { type: 'json', defaultsTo: {} },
        last_seen_at: { type: 'ref' },
    },

    // Add indexes at the model level instead of on individual attributes
    indexes: [
        { attributes: { email: 1 }, unique: true }
    ],

    // Lifecycle callback to hash password before creating a user
    beforeCreate: async function (values, proceed) {
        try {
            if (!values.password) {
                return proceed();
            }
            const salt = await bcrypt.genSalt(10);
            values.password = await bcrypt.hash(values.password, salt);
            return proceed();
        } catch (error) {
            return proceed(error);
        }
    }
});

export default User;

// Add a standalone helper function for password verification
export const verifyPassword = async (user, password) => {
    if (!user?.password) {
        return false;
    }
    return bcrypt.compare(password, user.password);
};
