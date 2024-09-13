import Waterline from 'waterline';

const Space = Waterline.Collection.extend({
    identity: 'space',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        is_private: { type: 'boolean', required: true },
        shared_teams: { type: 'json', defaultsTo: [] },
        shared_members: { type: 'json', defaultsTo: [] },
        user_id: { type: 'string', required: true },
        is_default: { type: 'boolean', required: true }
    }
});

export default Space;