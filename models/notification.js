import Waterline from 'waterline';

const Notification = Waterline.Collection.extend({
    identity: 'notification',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string', required: true },
        recipient_id: { type: 'string', required: true }, // User ID who receives the notification
        actor_id: { type: 'string', required: true },      // User ID who performed the action
        action: { type: 'string', required: true },        // 'create', 'update', 'delete', 'share', 'comment'
        entity_type: { type: 'string', required: true },   // 'page', 'board', 'folder', 'document', etc.
        entity_id: { type: 'string', required: true },     // ID of the entity that was acted upon
        entity_name: { type: 'string' },                   // Name/title of the entity (for display)
        message: { type: 'string' },                       // Custom notification message
        metadata: { type: 'json', defaultsTo: {} },        // Additional context (old values, changes, etc.)
        is_read: { type: 'boolean', defaultsTo: false },
        read_at: { type: 'ref' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { workspace_id: 1, recipient_id: 1, is_read: 1 } },
        { attributes: { entity_id: 1 } },
        { attributes: { createdAt: -1 } }
    ]
});

export default Notification;
