import Waterline from 'waterline';

const Document = Waterline.Collection.extend({
    identity: 'document',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        content: { type: 'json' },
        summary: { type: 'string' }
    }
});

export default Document;