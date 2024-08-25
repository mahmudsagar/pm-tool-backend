import Waterline from 'waterline';

const Whiteboard = Waterline.Collection.extend({
    identity: 'whiteboard',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: {
            type: 'string',
            columnName: '_id'
        },
        content: {
            type: 'json',
            required: true
        },
        summery: {
            type: 'string',
            required: true
        },
        page_id: {
            model: 'page',
            columnName: 'page_id',
            required: true
        }
    }
});

export default Whiteboard;