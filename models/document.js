import Waterline from 'waterline';

const Document = Waterline.Collection.extend({
    identity: 'document',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        content: { type: 'json' },
        summary: { type: 'string' },
        folder_id: { type: 'string' },
        space_id: { type: 'string' },
        group_id: { type: 'string' },
        entity_type: { type: 'string', defaultsTo: 'page' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Document;