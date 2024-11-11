import Waterline from 'waterline';

const CommentContent = Waterline.Collection.extend({
    identity: 'comment_content',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string' },
        content: { type: 'json', defaultsTo: {} },
    }
});

export default CommentContent;