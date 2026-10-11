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
        automations: { type: 'json', defaultsTo: null },
        entity_type: { type: 'string', defaultsTo: 'board' },
        // Task keys: tasks display as `${key}-${task_number}`; task_seq is the last number handed out.
        key: { type: 'string' },                         // uppercase, 2-6 letters/digits, starts with a letter
        task_seq: { type: 'number', defaultsTo: 0 },     // incremented atomically ($inc) by the server
        // Team capacity for sprint planning: { members: { [userId]: {...} }, policy, working_days }
        capacity: { type: 'json', defaultsTo: null },
        // Lazy one-time migrations (server-set): task_event backfill from page_history and
        // legacy saved_view sprint names -> sprint documents.
        events_backfilled_at: { type: 'ref' },
        sprints_migrated_at: { type: 'ref' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Board;