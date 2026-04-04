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
        workspace_id: { type: 'string' },
        space_id: { type: 'string' },
        group_id: { type: 'string' },
        pinned: { type: 'boolean', defaultsTo: false },
        entity_type: { type: 'string', defaultsTo: 'folder' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Folder;