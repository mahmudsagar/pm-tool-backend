import Waterline from 'waterline';

const CommentBody = Waterline.Collection.extend({
    identity: 'comment_body',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        content: { type: 'json', required: true }
    }
});

export default CommentBody;