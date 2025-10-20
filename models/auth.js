import Waterline from 'waterline';

const Auth = Waterline.Collection.extend({
    identity: 'auth',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        token: { type: 'string', required: true },
        expires_at: { type: 'ref', required: true },
        created_at: { type: 'ref', autoCreatedAt: true },
        updated_at: { type: 'ref', autoUpdatedAt: true }
    },

    indexes: [
        { attributes: { user_id: 1 } },
        { attributes: { token: 1 }, unique: true },
        { attributes: { expires_at: 1 } }
    ]
});

export default Auth;