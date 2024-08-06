import Waterline from 'waterline';

const MongoTest = Waterline.Collection.extend({
    identity: 'mongoTest',
    datastore: 'default',
    primaryKey: 'id',

    attributes: {
        id: { type: 'string', required: true },
        foo: { type: 'string', required: true },
    }
});

export default MongoTest;