import Waterline from 'waterline';

// Restorable delete. `snapshot` holds every row the delete handler removed, keyed by
// collection identity: { [identity]: [row, ...] }, so restore can reinsert them with original _ids.
const TrashItem = Waterline.Collection.extend({
    identity: 'trash_item',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string' },
        deleted_by: { type: 'string', required: true },
        deleted_at: { type: 'ref' },
        expires_at: { type: 'ref' },
        entity_type: { type: 'string', required: true },
        entity_id: { type: 'string', required: true },
        name: { type: 'string', defaultsTo: '' },
        page_type: { type: 'string', allowNull: true },
        parent: { type: 'json', defaultsTo: {} },
        snapshot: { type: 'json', defaultsTo: {} },
    },
});

export default TrashItem;
