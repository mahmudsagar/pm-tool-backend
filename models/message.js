import Waterline from 'waterline';

const Message = Waterline.Collection.extend({
    identity: 'message',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        conversation_id: { type: 'string', required: true },
        sender_id: { type: 'string', required: true },
        body: { type: 'string', defaultsTo: '' },
        content: { type: 'string' },
        mentions: { type: 'json', defaultsTo: [] },
        attachments: { type: 'json', defaultsTo: [] },
        entity_refs: { type: 'json', defaultsTo: [] },
        entity_type: { type: 'string', defaultsTo: 'message' },
        // Threads: replies point at a top-level root; the root keeps the summary.
        parent_message_id: { type: 'string', allowNull: true },
        reply_count: { type: 'number', defaultsTo: 0 },
        last_reply_at: { type: 'ref' },
        reply_user_ids: { type: 'json', defaultsTo: [] }, // up to 5 most recent distinct repliers, newest first
        reactions: { type: 'json', defaultsTo: [] },      // [{ emoji, user_ids: [] }]
        edited_at: { type: 'ref' },
        deleted_at: { type: 'ref' },                       // soft delete; content is blanked
        deleted_by: { type: 'string', allowNull: true },
        pinned: { type: 'boolean', defaultsTo: false },
        pinned_by: { type: 'string', allowNull: true },
        pinned_at: { type: 'ref' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Message;
