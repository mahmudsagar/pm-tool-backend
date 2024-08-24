import Waterline from 'waterline';

const CustomMeta = Waterline.Collection.extend({
    identity: 'custom_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', required: true },
        meta_data: { type: 'json', required: true },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string', required: true }
    }
});

export default CustomMeta;