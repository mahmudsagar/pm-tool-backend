import Waterline from 'waterline';

const Page = Waterline.Collection.extend({
    identity: 'page',
    datastore: 'default',
    primaryKey: 'id',

    "attributes": {
        "id": {
            "type": "string",
            "required": true
        },
        "title": {
            "type": "string",
            "required": true
        },
        "page_type": {
            "type": "string",
            "isIn": [
                "document",
                "sheet",
                "whiteboard"
            ],
            "required": true,
        },
        "custom_meta_attribute_id": {
            "type": "string",
            "required": true
        },
        "page_content_id": {
            "type": "string",
            "required": true,
        },
        "folder_id": {
            "type": "string",
            "required": true
        },
        "created_by": {
            "type": "string",
            "required": true
        },
        "last_updated_by": {
            "type": "string",
            "required": true
        },
        "created_at": {
            "type": "ref",
            "columnType": "datetime"
        },
        "updated_at": {
            "type": "ref",
            "columnType": "datetime"
        }
    },
    "associations": {
        "page": {
            "type": "belongsTo",
            "model": "folder",
            "foreignKey": "folderId",
            "required": true
        },
        "custom_meta_attributes": {
            "type": "belongsTo",
            "model": "custom_meta_attributes",
            "foreignKey": "custom_meta_attribute_id"
        }
    }
});

export default Page;