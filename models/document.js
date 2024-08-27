import Waterline from 'waterline';

const Document = Waterline.Collection.extend({
    identity: 'document',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        content: { type: 'json', required: true },
        summary: { type: 'string', required: true }
    }
});

export default Document;