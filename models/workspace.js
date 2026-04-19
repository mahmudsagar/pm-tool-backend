import Waterline from 'waterline';

const Workspace = Waterline.Collection.extend({
    identity: 'workspace',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        owner_id: { type: 'string', required: true },
        members: { type: 'json', defaultsTo: [] },
        // members format: [{ user_id, role: 'admin'|'member'|'guest' }]
        member_roles: { type: 'json', defaultsTo: [] },
        logo: { type: 'string' },
        timezone: { type: 'string', defaultsTo: 'UTC' },
        date_format: { type: 'string', defaultsTo: 'MM/DD/YYYY' },
        first_day_of_week: { type: 'string', defaultsTo: 'monday' },
        working_days: { type: 'json', defaultsTo: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
        billing_plan: { type: 'string', defaultsTo: 'free' },
        entity_type: { type: 'string', defaultsTo: 'workspace' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Workspace;
