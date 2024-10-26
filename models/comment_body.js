import Waterline from 'waterline';

const CommentBody = Waterline.Collection.extend({
    identity: 'comment_body',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        content: { type: 'json', required: true },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default CommentBody;