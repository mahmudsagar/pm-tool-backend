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
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Document;