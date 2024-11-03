import Waterline from 'waterline';

const PageMeta = Waterline.Collection.extend({
    identity: 'page_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        page_type: { type: 'string', required: true },
        title: { type: 'string', required: true },
        page_content_id: { type: 'string', required: true },
        last_updated_by: { type: 'string' },
        custom_meta: { type: 'json', defaultsTo: {} },
        shared_members: { type: 'json', defaultsTo: [] },
        shared_teams: { type: 'json', defaultsTo: [] },
        attachments: { type: 'string' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    beforeValidate: function (values, cb) {
        const validPageTypes = ['document', 'sheet', 'whiteboard'];
        if (!validPageTypes.includes(values.page_type)) {
            return cb(new Error('Invalid page type'));
        }
        return cb();
    },

    afterValidate: function (values, cb) {
        const validPageTypes = ['document', 'sheet', 'whiteboard'];
        if (!validPageTypes.includes(values.page_type)) {
            return cb(new Error('Invalid page type'));
        }
        return cb();
    }
});

export default PageMeta;