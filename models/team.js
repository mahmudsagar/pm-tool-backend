import Waterline from 'waterline';

const Team = Waterline.Collection.extend({
    identity: 'team',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        shared_members: { type: 'json', defaultsTo: [] },
        description: { type: 'string' },
        entity_type: { type: 'string', defaultsTo: 'team' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Team;