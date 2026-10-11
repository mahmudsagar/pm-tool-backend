import Waterline from 'waterline';

/**
 * Workspace audit log (append-only; kept forever, no retention job). Rows are written and read
 * with the native driver (see modules/v1/utils/audit.js); indexed by { workspace_id, createdAt }
 * and { workspace_id, action } in models/index.js.
 */
const AuditLog = Waterline.Collection.extend({
    identity: 'audit_log',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string', required: true },
        actor_id: { type: 'string', allowNull: true },
        action: { type: 'string', required: true },        // e.g. 'member.invited'
        target_type: { type: 'string', allowNull: true },  // 'member' | 'invitation' | 'workspace' | 'space' | ...
        target_id: { type: 'string', allowNull: true },
        target_name: { type: 'string', allowNull: true },
        metadata: { type: 'json', defaultsTo: {} },
        ip: { type: 'string', allowNull: true },
        user_agent: { type: 'string', allowNull: true },
        createdAt: { type: 'ref' },                        // Date
    },
});

export default AuditLog;
