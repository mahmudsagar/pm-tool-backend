import Waterline from 'waterline';

const Comment = Waterline.Collection.extend({
    identity: 'comment',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        page_id: { type: 'string' },
        parent_id: { type: 'string' },
        content: { type: 'json' },
        has_childs: { type: 'boolean', defaultsTo: false },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Comment;