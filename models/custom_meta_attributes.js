import Waterline from 'waterline';

const CustomMetaAttributes = Waterline.Collection.extend({
    identity: 'flexibleModel',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        data: { type: 'json', columnType: 'json', required: true },
        created_at: { type: 'ref', columnType: 'datetime' },
        updated_at: { type: 'ref', columnType: 'datetime' },
        custom_meta_attributes: { model: 'page', columnName: 'custom_meta_attribute_id', required: true }
    },
    autoCreatedAt: true,
    autoUpdatedAt: true
});

export default CustomMetaAttributes;