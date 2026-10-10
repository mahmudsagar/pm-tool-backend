import Waterline from 'waterline';

// Per-user view history. One row per (user_id, entity_type, entity_id), viewed_at is bumped on each view.
const RecentItem = Waterline.Collection.extend({
    identity: 'recent_item',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        entity_type: { type: 'string', required: true },
        entity_id: { type: 'string', required: true },
        viewed_at: { type: 'ref' },
    },
});

export default RecentItem;
