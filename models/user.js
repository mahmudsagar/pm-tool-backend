import Waterline from 'waterline';

const User = Waterline.Collection.extend({
    identity: 'user',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        email: { type: 'string', required: true },
        first_name: { type: 'string', required: true },
        last_name: { type: 'string', required: true },
        full_name: { type: 'string', required: true },
        attachments: { type: 'json', defaultsTo: [] }
    }
});

export default User;