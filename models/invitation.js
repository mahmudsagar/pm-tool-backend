import Waterline from 'waterline';

// Workspace invitation. No email provider exists: pending invitations are resolved when a user
// with the invited email signs in (see modules/v1/utils/invitations.js) or opens the invite link.
const Invitation = Waterline.Collection.extend({
    identity: 'invitation',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        workspace_id: { type: 'string', required: true },
        email: { type: 'string', required: true }, // lowercased
        role: { type: 'string', defaultsTo: 'member' }, // 'admin'|'member'|'guest'
        space_ids: { type: 'json', defaultsTo: [] },
        token: { type: 'string', required: true }, // random 32-byte hex, unique
        invited_by: { type: 'string' },
        status: { type: 'string', defaultsTo: 'pending' }, // 'pending'|'accepted'|'revoked'|'expired'
        expires_at: { type: 'ref' },
        accepted_by: { type: 'string', allowNull: true },
        accepted_at: { type: 'ref' },
        created_at: { type: 'ref' },
    },
});

export default Invitation;
