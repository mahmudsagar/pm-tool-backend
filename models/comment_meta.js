import Waterline from 'waterline';

const CommentMeta = Waterline.Collection.extend({
    identity: 'comment_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        associate_id: { type: 'string', required: true },
        user_id: { type: 'string', required: true },
        parent_id: { type: 'string', required: true },
        comment_body: { type: 'string', required: true },
        attachments: { type: 'string', required: true },
    }
});

export default CommentMeta;