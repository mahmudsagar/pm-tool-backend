import Waterline from 'waterline';

const CustomMeta = Waterline.Collection.extend({
    identity: 'custom_meta',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        meta_data: { type: 'json', required: true },
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        space_id: { type: 'string', required: true },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    }
});

export default CustomMeta;