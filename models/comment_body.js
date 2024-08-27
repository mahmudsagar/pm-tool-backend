import Waterline from 'waterline';

const CommentBody = Waterline.Collection.extend({
    identity: 'comment_body',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        content: { type: 'json', required: true },
        // summery: { type: 'string', required: true },
        // document: { model: 'page', columnName: 'page_content_id', required: true }
    }
});

export default CommentBody;