import Waterline from 'waterline';

const Workspace = Waterline.Collection.extend({
    identity: 'workspace',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        owner_id: { type: 'string', required: true },
        members: { type: 'json', defaultsTo: [] },
        entity_type: { type: 'string', defaultsTo: 'workspace' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Workspace;
