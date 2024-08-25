import Waterline from 'waterline';

const PageMeta = Waterline.Collection.extend({
    identity: 'page_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        page_types: { type: 'string', required: true },
        title: { type: 'string', required: true },
        page_content_id: { type: 'string', required: true },
        user_id: { type: 'string', required: true },
        last_updated_by: { type: 'string' },
        folder_id: { type: 'string', required: true },
        custom_meta: { type: 'json', required: true },
        shared_members: { type: 'json', defaultsTo: [] },
        shared_teams: { type: 'json', defaultsTo: [] }
    },

    beforeValidate: function (values, cb) {
        const validPageTypes = ['document', 'sheet', 'whiteboard'];
        if (!validPageTypes.includes(values.page_types)) {
            return cb(new Error('Invalid page type'));
        }
        return cb();
    },

    afterValidate: function (values, cb) {
        const validPageTypes = ['document', 'sheet', 'whiteboard'];
        if (!validPageTypes.includes(values.page_types)) {
            return cb(new Error('Invalid page type'));
        }
        return cb();
    }
});

export default PageMeta;