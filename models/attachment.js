import Waterline from 'waterline';

const Attachment = Waterline.Collection.extend({
    identity: 'attachment',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', required: true },
        file_name: { type: 'string', required: true },
        file_url: { type: 'string', required: true },
        file_type: { type: 'string', required: true },
        file_meta: { type: 'json' }
    }
});

export default Attachment;