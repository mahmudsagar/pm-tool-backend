import Waterline from 'waterline';

const Team = Waterline.Collection.extend({
    identity: 'team',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        description: { type: 'string', required: true },
        created_by: { type: 'string', required: true },
        created_at: { type: 'ref', columnType: 'datetime' },
        updated_at: { type: 'ref', columnType: 'datetime' },
        team: { collection: 'team', via: 'workspace_id' },
        folder: { collection: 'folder', via: 'workspace_id' }
    },
    autoCreatedAt: true,
    autoUpdatedAt: true
});

export default Team;