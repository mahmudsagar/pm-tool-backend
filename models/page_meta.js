import Waterline from 'waterline';

const PageMeta = Waterline.Collection.extend({
    identity: 'page_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        title: { type: 'string', required: true },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        folder_id: { type: 'string' },
        board_id: { type: 'string' },
        parent_id: { type: 'string' },
        space_id: { type: 'string' },
        group_id: { type: 'string' },
        page_content_id: { type: 'string', required: true },
        custom_meta: { type: 'json', defaultsTo: {} },
        shared_members: { type: 'json', defaultsTo: [] },
        shared_teams: { type: 'json', defaultsTo: [] },
        attachments: { type: 'json', defaultsTo: [] },
        page_type: { type: 'string', required: true },
        last_updated_by: { type: 'string' },
        pinned: { type: 'boolean', defaultsTo: false },
        entity_type: { type: 'string', defaultsTo: 'page' },
        inner_comments: { type: 'json', defaultsTo: [] },
        // Studio fields (document / sheet / whiteboard)
        icon: { type: 'string' },                       // emoji or image URL
        subtitle: { type: 'string' },
        doc_status: { type: 'string', defaultsTo: 'draft' }, // draft | in_review | approved | published
        cover_position: { type: 'number', allowNull: true }, // 0-100, vertical focus % of the cover image
        locked: { type: 'boolean', defaultsTo: false },
        locked_by: { type: 'string', allowNull: true },  // server-set
        locked_at: { type: 'ref' },                     // server-set
        // Board tasks
        task_number: { type: 'number', allowNull: true }, // server-set, permanent within the board
        sort_order: { type: 'number', allowNull: true },  // position among siblings; nulls sort last
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
    },

    indexes: [
        { attributes: { title: 'text', description: 'text' } }
    ]
});

export default PageMeta;