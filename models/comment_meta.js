import Waterline from 'waterline';

const CommentMeta = Waterline.Collection.extend({
    identity: 'comment_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        page_id: { type: 'string' },
        parent_id: { type: 'string' },
        associate_id: { type: 'string' },
        comment_body: { type: 'string', required: true },
        attachments: { type: 'json', defaultsTo: [] },
        has_childs: { type: 'boolean', defaultsTo: false },
        inner_comment: { type: 'boolean', defaultsTo: false },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default CommentMeta;