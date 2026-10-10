import Waterline from 'waterline';

// Per-user stars on workspace entities. Unique per (user_id, entity_type, entity_id)
// (enforced by a native index created in models/index.js plus app-level checks).
const Favorite = Waterline.Collection.extend({
    identity: 'favorite',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        entity_type: { type: 'string', required: true },
        entity_id: { type: 'string', required: true },
        created_at: { type: 'ref' },
    },
});

export default Favorite;
