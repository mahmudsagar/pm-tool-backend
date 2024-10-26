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
        attachments: { type: 'string' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default CommentMeta;