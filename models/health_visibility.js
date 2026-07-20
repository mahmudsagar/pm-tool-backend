import Waterline from 'waterline';

const VALID_SCOPES = new Set(['self', 'direct_report', 'team_aggregate', 'escalated']);

const HealthVisibility = Waterline.Collection.extend({
    identity: 'health_visibility',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string', required: true },
        board_id: { type: 'string' },
        team_id: { type: 'string' },
        viewer_id: { type: 'string', required: true },
        subject_id: { type: 'string', required: true },
        scope: { type: 'string', required: true },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    beforeValidate(values, cb) {
        if (values.scope && !VALID_SCOPES.has(values.scope)) {
            return cb(new Error('Invalid health visibility scope'));
        }
        return cb();
    },
});

export default HealthVisibility;
