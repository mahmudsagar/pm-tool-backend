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
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default Message;
