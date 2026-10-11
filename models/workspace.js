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
        // members format: [user_id]
        member_roles: { type: 'json', defaultsTo: [] },
        // member_roles format: [{ user_id, role: 'admin'|'member'|'guest', status?: 'active'|'suspended', joined_at? }]
        logo: { type: 'string' },
        timezone: { type: 'string', defaultsTo: 'UTC' },
        date_format: { type: 'string', defaultsTo: 'MM/DD/YYYY' },
        first_day_of_week: { type: 'string', defaultsTo: 'monday' },
        working_days: { type: 'json', defaultsTo: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
        billing_plan: { type: 'string', defaultsTo: 'free' },
        entity_type: { type: 'string', defaultsTo: 'workspace' },
        // Settings. `slug` is unique when non-empty (native partial index in models/index.js).
        slug: { type: 'string' },
        language: { type: 'string', defaultsTo: 'en-US' },
        sprint_cadence: { type: 'string', defaultsTo: '2w' },
        issue_prefix: { type: 'string' },
        // { sheets?, whiteboards?, databoards?, scrum?, chat? } booleans
        features: { type: 'json', defaultsTo: {} },
        auto_archive_days: { type: 'number', defaultsTo: 0 },
        // { allow_member_public_create?: boolean, default_space_id?: string|null }
        space_policies: { type: 'json', defaultsTo: {} },
        archived_at: { type: 'ref' },
        // Storage quota in bytes; null = unlimited. Rows created before quotas lack the field and
        // count as the 5 GiB default (see modules/v1/utils/storage.js).
        storage_quota_bytes: { type: 'ref', defaultsTo: 5 * 1024 * 1024 * 1024 },
        // Usage alert thresholds (80 / 95) already notified; cleared when usage drops below.
        storage_alerts_sent: { type: 'json', defaultsTo: [] },
        // [{ domain, token, status: 'pending'|'verified'|'failed', auto_join, role: 'member'|'guest',
        //    added_by, added_at, verified_at, last_checked_at, last_error }] (see utils/domains.js)
        domains: { type: 'json', defaultsTo: [] },
        // Users removed by an admin: domain auto-join does not add them back (cleared on re-add).
        auto_join_excluded: { type: 'json', defaultsTo: [] },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },

    indexes: [
        { attributes: { name: 'text', description: 'text' } }
    ]
});

export default Workspace;
