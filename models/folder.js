import Waterline from 'waterline';

const Folder = Waterline.Collection.extend({
    identity: 'folder',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        description: { type: 'string', required: true },
        parent_id: { type: 'string', required: true },
        workspace_id: { type: 'string', required: true },
        teams: { type: 'json', defaultsTo: [] },
        users: { type: 'json', defaultsTo: [] }
    }
});

export default Folder;