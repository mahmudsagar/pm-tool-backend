import Waterline from 'waterline';
import { v4 as uuidv4 } from 'uuid';
import { dbConfig, waterline } from '../db/connection.js';

const Page = Waterline.Collection.extend({
    identity: 'page',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: {
            type: 'string',
            columnName: '_id',
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
            type: 'string',
            autoUpdatedAt: true
        }
    },

    beforeCreate: (values, next) => {
        console.log("beforeCreate hook called"); // Log to verify hook execution
        values.id = uuidv4();
        console.log("before create", values);

        const allowedPageTypes = ['document', 'sheet', 'whiteboard'];
        if (!allowedPageTypes.includes(values.page_type)) {
            return next(new Error('Invalid page_type value.'));
        }
        return next();
    },

    beforeUpdate: (values, next) => {
        if (values.page_type) {
            const allowedPageTypes = ['document', 'sheet', 'whiteboard'];
            if (!allowedPageTypes.includes(values.page_type)) {
                return next(new Error('Invalid page_type value.'));
            }
        }
        return next();
    }
});

export default Page;

// Example usage with additional logs
console.log("Creating a new page...");
waterline.registerModel(Page);
waterline.initialize(dbConfig, (err, ontology) => {
    const page = ontology.collections.page
    if (err) {
        console.error('Failed to initialize ORM:', err);
        return;
    }
    console.log('ORM initialized:');
    global.Page = ontology.collections.page;
    console.log("Page model registered");
    console.log("Creating a new page...");
    const ts = async () => {
        const result = await page.create({
            title: 'New Page',
            page_type: 'document',
            custom_meta_attribute_id: '123',
            page_content_id: '456',
            folder_id: '789',
            created_by: 'user1',
            last_updated_by: 'user1'
        });
        console.log("Page created:", result);
    }
    ts()
})