import Waterline from 'waterline';

const Folder = Waterline.Collection.extend({
    identity: 'folder',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        parent_id: { type: 'string' },
        shared_members: { type: 'json', defaultsTo: [] },
        shared_teams: { type: 'json', defaultsTo: [] },
        user_id: { type: 'string', required: true },
        space_id: { type: 'string', required: true },
        group_id: { type: 'string' }
    }
});

export default Folder;