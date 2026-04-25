import Waterline from 'waterline';

const Space = Waterline.Collection.extend({
    identity: 'space',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        name: { type: 'string', required: true },
        description: { type: 'string' },
        color: { type: 'string' },
        icon: { type: 'string' },
        default_view: { type: 'string', defaultsTo: 'table' },
        space_lead: { type: 'string' },
        working_start_date: { type: 'ref' },
        working_end_date: { type: 'ref' },
        is_private: { type: 'boolean', required: true },
        shared_teams: { type: 'json', defaultsTo: [] },
        // shared_teams format: [team_id] (just IDs for access control)
        shared_members: { type: 'json', defaultsTo: [] },
        // shared_members format: [user_id] (just IDs for access control)
        member_roles: { type: 'json', defaultsTo: {} },
        // member_roles format: { user_id: 'manager'|'contributor'|'viewer', ... }
        team_roles: { type: 'json', defaultsTo: {} },
        // team_roles format: { team_id: 'manager'|'contributor'|'viewer', ... }
        user_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        is_default: { type: 'boolean', required: true },
        entity_type: { type: 'string', defaultsTo: 'space' },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Space;