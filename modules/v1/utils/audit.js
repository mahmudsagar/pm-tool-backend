import { collection, toObjectId } from './boardTasks.js';

/**
 * Workspace audit log (audit_log collection). Every entry is kept (no retention / pruning).
 *
 * Row: { workspace_id, actor_id, action, target_type, target_id, target_name, metadata, ip,
 *        user_agent, createdAt: Date }
 */

const str = (value, max = 500) => {
    if (value === undefined || value === null || value === '') return null;
    return String(value).slice(0, max);
};

/** Client IP: first x-forwarded-for hop, else x-real-ip, else the socket address. */
export const clientIp = (request) => {
    if (!request) return null;
    const forwarded = request.headers?.['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '')).split(',')[0].trim();
    if (first) return first.slice(0, 100);
    const real = request.headers?.['x-real-ip'];
    if (real) return String(real).slice(0, 100);
    const raw = request.socket?.remoteAddress || request.ip || null;
    return raw ? String(raw).replace(/^::ffff:/, '').slice(0, 100) : null;
};

/**
 * Append one audit entry. Never throws (failures are logged): auditing must not break the action.
 * `workspace_id` / `actor_id` default to the request's X-Workspace-ID and authenticated user.
 */
export const recordAudit = async (request, {
    action, target_type, target_id, target_name, metadata, workspace_id, actor_id,
} = {}) => {
    try {
        const workspaceId = workspace_id || request?.workspaceId;
        if (!workspaceId || !action) return null;
        const row = {
            workspace_id: String(workspaceId),
            actor_id: str(actor_id !== undefined ? actor_id : request?.user?.id, 64),
            action: String(action),
            target_type: str(target_type, 64),
            target_id: str(target_id, 128),
            target_name: str(target_name, 300),
            metadata: metadata && typeof metadata === 'object' ? metadata : {},
            ip: clientIp(request),
            user_agent: str(request?.headers?.['user-agent'], 500),
            createdAt: new Date(),
        };
        const res = await collection('audit_log').insertOne(row);
        return { ...row, _id: res.insertedId };
    } catch (err) {
        console.error(`recordAudit(${action}) failed:`, err.message);
        return null;
    }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mongo filter for the audit list / export (filters already validated). */
export const buildAuditFilter = (workspaceId, { action, actor_id, target_id, from, to, q } = {}) => {
    const filter = { workspace_id: String(workspaceId) };
    if (action) filter.action = { $regex: `^${escapeRegex(action)}` };
    if (actor_id) filter.actor_id = String(actor_id);
    if (target_id) filter.target_id = String(target_id);
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) filter.createdAt.$lte = new Date(to);
    }
    if (q) {
        const re = { $regex: escapeRegex(q), $options: 'i' };
        filter.$or = [{ target_name: re }, { action: re }];
    }
    return filter;
};

/**
 * Newest-first page of entries. `cursor` is the _id of the last entry of the previous page
 * (ordering is createdAt desc, _id desc). Returns { rows, next_cursor }.
 * An unknown cursor yields an empty page.
 */
export const queryAudit = async (workspaceId, filters = {}, { cursor, limit = 50 } = {}) => {
    const filter = buildAuditFilter(workspaceId, filters);
    if (cursor) {
        const anchor = await collection('audit_log').findOne(
            { _id: toObjectId(cursor), workspace_id: String(workspaceId) },
            { projection: { createdAt: 1 } },
        );
        if (!anchor) return { rows: [], next_cursor: null };
        const after = { $or: [
            { createdAt: { $lt: anchor.createdAt } },
            { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
        ] };
        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, after];
            delete filter.$or;
        } else {
            filter.$or = after.$or;
        }
    }
    const rows = await collection('audit_log').find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { rows: page, next_cursor: hasMore ? String(page[page.length - 1]._id) : null };
};

/** Attach `actor: { _id, name, email, avatar } | null` and stringify ids / dates. */
export const decorateAuditRows = async (rows) => {
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id) => /^[0-9a-fA-F]{24}$/.test(String(id || ''))))];
    const users = actorIds.length
        ? await collection('user').find({ _id: { $in: actorIds.map(toObjectId) } }, { projection: { name: 1, email: 1, avatar: 1 } }).toArray()
        : [];
    const byId = new Map(users.map((u) => [String(u._id), { _id: String(u._id), name: u.name || '', email: u.email || '', avatar: u.avatar || '' }]));
    return rows.map((r) => ({
        _id: String(r._id),
        workspace_id: r.workspace_id,
        actor_id: r.actor_id || null,
        actor: r.actor_id ? byId.get(String(r.actor_id)) || null : null,
        action: r.action,
        target_type: r.target_type || null,
        target_id: r.target_id || null,
        target_name: r.target_name || null,
        metadata: r.metadata || {},
        ip: r.ip || null,
        user_agent: r.user_agent || null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
};

// --- CSV ------------------------------------------------------------------------------------------

export const AUDIT_CSV_COLUMNS = ['created_at', 'action', 'actor_id', 'actor_name', 'actor_email',
    'target_type', 'target_id', 'target_name', 'ip', 'user_agent', 'metadata'];

/** RFC 4180 field; values starting with = + - @ (or tab / CR) get a leading ' against formula injection. */
export const csvField = (value) => {
    let s = value === undefined || value === null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const auditRowsToCsv = (entries) => {
    const lines = [AUDIT_CSV_COLUMNS.join(',')];
    for (const e of entries) {
        lines.push([
            e.createdAt, e.action, e.actor_id, e.actor?.name, e.actor?.email,
            e.target_type, e.target_id, e.target_name, e.ip, e.user_agent,
            JSON.stringify(e.metadata || {}),
        ].map(csvField).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
};
