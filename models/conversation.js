import Waterline from 'waterline';

const Conversation = Waterline.Collection.extend({
    identity: 'conversation',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string', required: true },
        type: { type: 'string', required: true }, // 'dm' | 'channel' | 'group'
        name: { type: 'string' },
        description: { type: 'string' },
        space_id: { type: 'string' },
        members: { type: 'json', defaultsTo: [] },
        created_by: { type: 'string', required: true },
        last_message_at: { type: 'ref' },
        last_message_preview: { type: 'string' },
        entity_type: { type: 'string', defaultsTo: 'conversation' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Conversation;
