import Waterline from 'waterline';

/**
 * Board sprint. Task membership: page_meta.custom_meta.values.sprint === sprint _id.
 * committed: { points, issues, task_ids, at } snapshot taken on start.
 * closed:    { completed_points, completed_issues, completed_ids, spillover_ids, at } on complete.
 */
const Sprint = Waterline.Collection.extend({
    identity: 'sprint',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string' },
        board_id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        goal: { type: 'string', defaultsTo: '' },
        start_date: { type: 'string', allowNull: true },   // YYYY-MM-DD
        end_date: { type: 'string', allowNull: true },     // YYYY-MM-DD
        status: { type: 'string', defaultsTo: 'planned' }, // planned | active | closed
        committed: { type: 'json', defaultsTo: null },
        closed: { type: 'json', defaultsTo: null },
        created_by: { type: 'string' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },
});

export default Sprint;
