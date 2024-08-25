import Waterline from 'waterline';
import { v4 as uuidv4 } from 'uuid';

const Page = Waterline.Collection.extend({
    identity: 'page',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: {
            type: 'string',
            columnName: '_id'
        },
        title: {
            type: 'string',
            required: true
        },
        page_type: {
            type: 'string',
            required: true
        },
        custom_meta_attribute_id: {
            type: 'string',
            required: true
        },
        page_content_id: {
            type: 'string',
            required: true
        },
        folder_id: {
            type: 'string',
            required: true
        },
        created_by: {
            type: 'string',
            required: true
        },
        last_updated_by: {
            type: 'string',
            required: true
        },
        created_at: {
            type: 'string',
            autoCreatedAt: true
        },
        updated_at: {
            type: 'ref',
            autoUpdatedAt: true
        }
    },
});

export default Page;