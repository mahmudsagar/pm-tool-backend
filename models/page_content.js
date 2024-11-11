import Waterline from 'waterline';

const PageContent = Waterline.Collection.extend({
    identity: 'page_content',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        content: { type: 'json', defaultsTo: {} },
        summary: { type: 'string' },
    }
});

export default PageContent;