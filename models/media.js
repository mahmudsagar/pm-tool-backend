import Waterline from 'waterline';

const Media = Waterline.Collection.extend({
    identity: 'media',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        reference_id: { type: 'string', required: true },
        media_type: { type: 'string', required: true },
        url: { type: 'string', required: true },
        caption: { type: 'string', defaultsTo: '' },
        description: { type: 'string', defaultsTo: '' },
        meta_data: { type: 'json', defaultsTo: {} },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    beforeValidate: function (values, cb) {
        const validMediaTypes = ['cover_photo', 'icon'];
        if (!validMediaTypes.includes(values.media_type)) {
            return cb(new Error('Invalid media type. Allowed types are cover_photo and icon.'));
        }
        return cb();
    },

    afterValidate: function (values, cb) {
        const validMediaTypes = ['cover_photo', 'icon'];
        if (!validMediaTypes.includes(values.media_type)) {
            return cb(new Error('Invalid media type. Allowed types are cover_photo and icon.'));
        }
        return cb();
    }
});

export default Media;