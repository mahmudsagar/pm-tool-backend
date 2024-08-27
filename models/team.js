import Waterline from 'waterline';

const Team = Waterline.Collection.extend({
    identity: 'team',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        users: { type: 'json', defaultsTo: [] },
        description: { type: 'string' }
    }
});

export default Team;