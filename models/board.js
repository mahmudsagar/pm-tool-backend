import Waterline from 'waterline';

const Board = Waterline.Collection.extend({
    identity: 'board',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        custom_meta: { type: 'json', defaultsTo: {} },
        shared_members: { type: 'json', defaultsTo: [] },
        shared_teams: { type: 'json', defaultsTo: [] },
        is_private: { type: 'boolean', defaultsTo: false },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        space_id: { type: 'string' },
        group_id: { type: 'string' },
        folder_id: { type: 'string' },
        pinned: { type: 'boolean', defaultsTo: false },
        saved_view: { type: 'json', defaultsTo: null },
        entity_type: { type: 'string', defaultsTo: 'board' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Board;