import Waterline from 'waterline';

const Document = Waterline.Collection.extend({
    identity: 'document',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        content: { type: 'json', required: true },
        summery: { type: 'string', required: true },
        document: { model: 'page', columnName: 'page_content_id', required: true }
    }
});

export default Document;