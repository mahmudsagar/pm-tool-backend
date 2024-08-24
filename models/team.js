import Waterline from 'waterline';

const Team = Waterline.Collection.extend({
    identity: 'team',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        use_ids: { type: 'json', defaultsTo: [] },
        description: { type: 'string' }
    }
});

export default Team;