import Waterline from 'waterline';

const Workspace = Waterline.Collection.extend({
    identity: 'workspace',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        user_id: { type: 'string', required: true }
    }
});

export default Workspace;