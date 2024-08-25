import Waterline from 'waterline';

const Comment = Waterline.Collection.extend({
    identity: 'comment',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        content: { type: 'json', required: true },
        summery: { type: 'string', required: true },
        document: { model: 'page', columnName: 'page_content_id', required: true }
    }
});

export default Comment;