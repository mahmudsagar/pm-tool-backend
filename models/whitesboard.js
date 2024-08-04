import Waterline from 'waterline';

const Whiteboard = Waterline.Collection.extend({
    identity: 'whiteboard',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        content: { type: 'json', required: true },
        summery: { type: 'string', required: true },
        document: { model: 'page', columnName: 'page_content_id', required: true }
    }
});

export default Whiteboard;