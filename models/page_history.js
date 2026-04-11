import Waterline from 'waterline';

const PageHistory = Waterline.Collection.extend({
    identity: 'page_history',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        page_id: { type: 'string', required: true },
        page_content_id: { type: 'string', required: true },
        user_id: { type: 'string', required: true },
        version: { type: 'number', required: true },
        action: { type: 'string', required: true },
        content_snapshot: { type: 'json', defaultsTo: null },
        meta_snapshot: { type: 'json', defaultsTo: null },
        changes: { type: 'json', defaultsTo: {} },
        createdAt: { type: 'ref', autoCreatedAt: true },
    },

    beforeValidate: function (values, cb) {
        const validActions = [
            'created',
            'content_updated',
            'meta_updated',
            'title_updated',
            'custom_meta_updated',
            'sharing_updated',
            'restored',
        ];
        if (!validActions.includes(values.action)) {
            return cb(new Error('Invalid history action'));
        }
        return cb();
    },
});

export default PageHistory;
