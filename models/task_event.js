import Waterline from 'waterline';

/**
 * Append-only log of board task value changes (see utils/taskEvents.js).
 * field: status | story_points | sprint | assignee | epic | priority | blocked
 *        | _created | _removed | _restored
 * Rows are written with the native driver (one insertMany per request); indexed by
 * { board_id, at } and { task_id, at } in models/index.js.
 */
const TaskEvent = Waterline.Collection.extend({
    identity: 'task_event',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string' },
        board_id: { type: 'string', required: true },
        task_id: { type: 'string', required: true },
        field: { type: 'string', required: true },
        from: { type: 'ref' },
        to: { type: 'ref' },
        at: { type: 'ref' },             // Date
        actor: { type: 'string' },       // user id
        reason: { type: 'string', allowNull: true },
        backfilled: { type: 'boolean', defaultsTo: false },
    },
});

export default TaskEvent;
