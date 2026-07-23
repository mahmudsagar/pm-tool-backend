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
        password: { type: 'string', required: true },
        phone: { type: 'string' },
        avatar: { type: 'string' },
        attachments: { type: 'json', defaultsTo: [] },
    },

    // Add indexes at the model level instead of on individual attributes
    indexes: [
        { attributes: { email: 1 }, unique: true }
    ],

    // Lifecycle callback to hash password before creating a user
    beforeCreate: async function (values, proceed) {
        try {
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
    return bcrypt.compare(password, user.password);
};