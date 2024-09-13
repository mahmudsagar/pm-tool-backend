import Waterline from 'waterline';

const Group = Waterline.Collection.extend({
    identity: 'group',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        is_private: { type: 'boolean' },
        shared_teams: { type: 'json', defaultsTo: [] },
        shared_members: { type: 'json', defaultsTo: [] },
        user_id: { type: 'string', required: true },
        space_id: { type: 'string', required: true }
    }
});

export default Group;