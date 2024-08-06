import Waterline from 'waterline';

const CustomMetaAttributes = Waterline.Collection.extend({
    identity: 'flexibleModel',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        data: { type: 'json', required: true },
        custom_meta_attributes: { model: 'page', columnName: 'custom_meta_attribute_id', required: true }
    }
});

export default CustomMetaAttributes;