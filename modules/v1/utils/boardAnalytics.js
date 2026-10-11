/**
 * Board analytics: pure functions (no DB access) over board tasks and their task_event log.
 *
 *   statusCategory(value)              free-form status -> backlog | todo | in_progress | review | blocked | done
 *   computeTaskTimestamps(task, evs)   completed_at / started_at / status_changed_at / blocked_at
 *   buildAnalytics({...})              burndown / CFD / churn / flow / velocity for GET /v1/board/analytics
 *
 * Days are UTC calendar days ('YYYY-MM-DD'); a day's state is the state at 23:59:59.999Z.
 * Events: { task_id, field, from, to, at, actor, reason }, field one of TRACKED_FIELDS or
 * _created / _removed / _restored (to = { title, task_number, parent_id, created_at, values }).
 */

export const CATEGORIES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];
export const TRACKED_FIELDS = ['status', 'story_points', 'sprint', 'assignee', 'epic', 'priority', 'blocked'];
export const SPRINT_COMPLETED_REASON = 'Sprint completed';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Map a free-form status value to its category (first match wins). */
export const statusCategory = (value) => {
    const s = String(value ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
    if (!s) return 'todo';
    if (/(^| )(done|complete|completed|closed|shipped|resolved)( |$)/.test(s)) return 'done';
    if (/(block|stuck|on hold)/.test(s)) return 'blocked';
    if (/(review|qa|testing|verify)/.test(s)) return 'review';
    if (/(progress|doing|active|started|wip)/.test(s)) return 'in_progress';
    if (/(backlog|icebox|later)/.test(s)) return 'backlog';
    return 'todo';
};

/** Truthiness of a `blocked` value (checkbox, text, select). */
export const isTruthyFlag = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (Array.isArray(v)) return v.length > 0;
    const s = String(v).trim().toLowerCase();
    return !['', 'false', 'no', '0', 'off', 'null', 'none'].includes(s);
};

/** Numeric story points; anything non-numeric is 0. */
export const toPoints = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

export const boardFields = (board) => {
    let meta = board?.custom_meta;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
    }
    return Array.isArray(meta?.fields) ? meta.fields.filter((f) => f && typeof f === 'object') : [];
};

/** values key holding story points: field `story_points`, else a field labelled "Story points"/"Points". */
export const resolvePointsKey = (fields) => {
    if (fields.some((f) => f.name === 'story_points')) return 'story_points';
    const byLabel = fields.find((f) => /^(story points|points)$/i.test(String(f.label || f.title || '').trim()));
    return byLabel?.name || 'story_points';
};

/** Status options of the board's `status` field as [{ value, label, category }]. */
export const statusOptions = (fields) => {
    const field = fields.find((f) => f.name === 'status');
    const options = Array.isArray(field?.options) ? field.options : [];
    return options
        .map((o) => {
            if (o === null || o === undefined) return null;
            if (typeof o !== 'object') return { value: String(o), label: String(o) };
            const value = o.value ?? o.name ?? o.label ?? o.id;
            if (value === undefined || value === null) return null;
            return { value: String(value), label: String(o.label ?? o.name ?? value) };
        })
        .filter(Boolean)
        .map((o) => ({ ...o, category: statusCategory(o.value) }));
};

export const taskValues = (task) => {
    let meta = task?.custom_meta;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
    }
    const values = meta?.values;
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
};

/** Tracked values of a task, story points read from `pointsKey` and stored as `story_points`. */
export const trackedValues = (values, pointsKey = 'story_points') => {
    const out = {};
    for (const f of TRACKED_FIELDS) {
        const v = f === 'story_points' ? values?.[pointsKey] : values?.[f];
        out[f] = v === undefined ? null : v;
    }
    return out;
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Changed tracked fields between two values objects -> [{ field, from, to }]. */
export const diffTrackedValues = (before, after, pointsKey = 'story_points') => {
    const a = trackedValues(before || {}, pointsKey);
    const b = trackedValues(after || {}, pointsKey);
    return TRACKED_FIELDS.filter((f) => !same(a[f], b[f])).map((f) => ({ field: f, from: a[f], to: b[f] }));
};

const ms = (v) => {
    if (v === null || v === undefined) return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
};
const iso = (t) => (t === null || t === undefined ? null : new Date(t).toISOString());
const roundDays = (msDiff) => Math.round((msDiff / DAY_MS) * 100) / 100;

export const dayString = (t) => new Date(t).toISOString().slice(0, 10);
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00.000Z`);
export const dayEndMs = (day) => Date.parse(`${day}T23:59:59.999Z`);
export const addDays = (day, n) => dayString(dayStartMs(day) + n * DAY_MS);
export const daysBetween = (from, to) => {
    const out = [];
    for (let t = dayStartMs(from); t <= dayStartMs(to); t += DAY_MS) out.push(dayString(t));
    return out;
};

const effectiveCategory = (state) => {
    const cat = statusCategory(state.values.status);
    return cat !== 'done' && isTruthyFlag(state.values.blocked) ? 'blocked' : cat;
};

/**
 * Values of each tracked field before the task's first event: the `from` of the first event of
 * that field, or the current value when the field never changed.
 */
const initialTracked = (current, events) => {
    const values = { ...current };
    const seen = new Set();
    for (const ev of events) {
        if (!TRACKED_FIELDS.includes(ev.field) || seen.has(ev.field)) continue;
        seen.add(ev.field);
        values[ev.field] = ev.from === undefined ? null : ev.from;
    }
    return values;
};

/**
 * completed_at (last entry into done; null unless done now), started_at (first entry into
 * in_progress), status_changed_at (last status change, else createdAt) and blocked_at (when the
 * task entered blocked status or its `blocked` value became truthy; null unless blocked now).
 * `events` are this task's events sorted by `at`.
 */
export const computeTaskTimestamps = (task, events = [], pointsKey = 'story_points') => {
    const current = trackedValues(taskValues(task), pointsKey);
    const values = initialTracked(current, events);
    const createdAt = ms(task.createdAt);

    let started = null;
    let completed = null;
    let statusChanged = null;
    let blockedSince = null;
    const isBlocked = (v) => statusCategory(v.status) === 'blocked' || isTruthyFlag(v.blocked);
    let wasBlocked = isBlocked(values);
    if (wasBlocked) blockedSince = createdAt;

    for (const ev of events) {
        if (ev.field !== 'status' && ev.field !== 'blocked') continue;
        const at = ms(ev.at);
        if (ev.field === 'status') {
            const fromCat = statusCategory(values.status);
            const toCat = statusCategory(ev.to);
            statusChanged = at;
            if (toCat === 'in_progress' && started === null) started = at;
            if (toCat === 'done' && (fromCat !== 'done' || ev.from === null || ev.from === undefined)) completed = at;
        }
        values[ev.field] = ev.to === undefined ? null : ev.to;
        const nowBlocked = isBlocked(values);
        if (nowBlocked && !wasBlocked) blockedSince = at;
        if (!nowBlocked) blockedSince = null;
        wasBlocked = nowBlocked;
    }

    const fallback = statusChanged ?? createdAt;
    const doneNow = statusCategory(current.status) === 'done';
    const blockedNow = isBlocked(current);
    return {
        completed_at: doneNow ? iso(completed ?? fallback) : null,
        started_at: iso(started),
        status_changed_at: iso(fallback),
        blocked_at: blockedNow ? iso(blockedSince ?? fallback) : null,
    };
};

/** Group events (sorted by at) per task id. */
export const eventsByTask = (events) => {
    const map = new Map();
    for (const ev of events) {
        const id = String(ev.task_id);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(ev);
    }
    return map;
};

const emptyCategories = () => Object.fromEntries(CATEGORIES.map((c) => [c, { points: 0, issues: 0 }]));

/**
 * Build the analytics payload.
 *   board      board row (custom_meta.fields, key)
 *   tasks      current page_meta rows of the board (incl. subtasks)
 *   events     all task_event rows of the board, sorted by at (then insertion order)
 *   sprint     sprint doc for sprint mode, else null
 *   sprints    all sprint docs of the board (velocity)
 *   from, to   'YYYY-MM-DD' (inclusive)
 *   today      'YYYY-MM-DD'; later days are left out of `daily`
 *   users      Map userId -> name (churn actor_name)
 */
export const buildAnalytics = ({ board, tasks = [], events = [], sprint = null, sprints = [], from, to, today, users = new Map() }) => {
    const fields = boardFields(board);
    const pointsKey = resolvePointsKey(fields);
    const boardKey = board?.key || '';
    const sprintId = sprint ? String(sprint._id) : null;
    const days = daysBetween(from, to);
    const rangeStart = dayStartMs(from);
    const rangeEnd = dayEndMs(to);
    const nowMs = dayEndMs(today);

    // --- task registry (current tasks + tasks only known from events) ---------------------
    const byTask = eventsByTask(events);
    const registry = new Map();
    for (const t of tasks) {
        registry.set(String(t._id), {
            id: String(t._id),
            title: t.title || '',
            task_number: t.task_number ?? null,
            parent: t.parent_id ? String(t.parent_id) : null,
            createdAt: ms(t.createdAt),
            current: trackedValues(taskValues(t), pointsKey),
            live: true,
        });
    }
    for (const [id, evs] of byTask) {
        if (registry.has(id)) continue;
        const info = [...evs].reverse().find((e) => ['_removed', '_created', '_restored'].includes(e.field) && e.to && typeof e.to === 'object')?.to || {};
        registry.set(id, {
            id,
            title: info.title || '',
            task_number: info.task_number ?? null,
            parent: info.parent_id ? String(info.parent_id) : null,
            createdAt: ms(info.created_at),
            current: trackedValues(info.values || {}, 'story_points'),
            live: false,
        });
    }
    const keyOf = (r) => (r.task_number ? `${boardKey}-${r.task_number}` : null);

    // --- initial states --------------------------------------------------------------------
    const states = new Map();
    for (const [id, r] of registry) {
        const evs = byTask.get(id) || [];
        const firstExistence = evs.find((e) => e.field === '_created' || e.field === '_restored' || e.field === '_removed');
        const exists = firstExistence ? firstExistence.field === '_removed' : r.live;
        const values = initialTracked(r.current, evs);
        const state = {
            r,
            exists,
            values,
            catSince: r.createdAt,
            sprintSince: r.createdAt,
            startedAt: null,       // first entry into in_progress
            addedAt: r.createdAt,  // lead-time start
        };
        state.cat = effectiveCategory(state);
        if (state.cat === 'in_progress') state.startedAt = r.createdAt;
        states.set(id, state);
    }

    const sprintStart = sprint ? (ms(sprint.committed?.at) ?? (sprint.start_date ? dayStartMs(sprint.start_date) : null)) : null;
    const sprintCutoff = sprint?.closed?.at ? ms(sprint.closed.at) : null;
    const inSprint = (s) => !sprintId || String(s.values.sprint ?? '') === sprintId;
    const inScope = (s, t) => s.exists && !s.r.parent && (s.r.createdAt === null || s.r.createdAt <= t) && inSprint(s);
    const pointsNow = (s) => toPoints(s.values.story_points);

    // --- outputs ---------------------------------------------------------------------------
    const daily = [];
    const churn = [];
    const completions = new Map();   // day -> Map(taskId -> { task_id, key, title, points })
    const lastCompletion = new Map(); // taskId -> { at, startedAt, addedAt }
    const stage = new Map();         // `${from}>${to}` -> { sum, count }

    const snapshotDay = (day) => {
        const end = dayEndMs(day);
        const row = {
            date: day,
            scope_points: 0, scope_issues: 0,
            remaining_points: 0, remaining_issues: 0,
            done_points: 0, done_issues: 0,
            by_category: emptyCategories(),
            completed: [...(completions.get(day)?.values() || [])],
        };
        for (const s of states.values()) {
            if (!inScope(s, end)) continue;
            const pts = pointsNow(s);
            row.scope_points += pts;
            row.scope_issues += 1;
            const cat = effectiveCategory(s);
            row.by_category[cat].points += pts;
            row.by_category[cat].issues += 1;
            if (cat === 'done') {
                row.done_points += pts;
                row.done_issues += 1;
            }
        }
        row.remaining_points = row.scope_points - row.done_points;
        row.remaining_issues = row.scope_issues - row.done_issues;
        daily.push(row);
    };

    const recordChurn = (s, ev, kind, delta) => {
        if (!sprintId || sprintStart === null || s.r.parent) return;
        const at = ms(ev.at);
        if (at < sprintStart || (sprintCutoff !== null && at > sprintCutoff)) return;
        if (ev.reason === SPRINT_COMPLETED_REASON) return;
        churn.push({
            at: iso(at),
            task_id: s.r.id,
            key: keyOf(s.r),
            title: s.r.title,
            delta_points: delta,
            kind,
            actor: ev.actor || null,
            actor_name: ev.actor ? (users.get(String(ev.actor)) || null) : null,
            reason: ev.reason || null,
        });
    };

    // `initial`: the value was set as part of the task's creation (no time spent in a stage).
    const updateCategory = (s, at, initial = false) => {
        const next = effectiveCategory(s);
        if (next === s.cat) return;
        const inRange = at >= rangeStart && at <= rangeEnd;
        if (!initial && inRange && s.exists && !s.r.parent && inSprint(s) && s.catSince !== null) {
            const k = `${s.cat}>${next}`;
            const agg = stage.get(k) || { from: s.cat, to: next, sum: 0, count: 0 };
            agg.sum += at - s.catSince;
            agg.count += 1;
            stage.set(k, agg);
        }
        if (next === 'in_progress' && s.startedAt === null) s.startedAt = at;
        if (next === 'done' && s.exists && !s.r.parent && inSprint(s)) {
            if (inRange) {
                const day = dayString(at);
                if (!completions.has(day)) completions.set(day, new Map());
                completions.get(day).set(s.r.id, { task_id: s.r.id, key: keyOf(s.r), title: s.r.title, points: pointsNow(s) });
                lastCompletion.set(s.r.id, { at, startedAt: s.startedAt, addedAt: s.addedAt, points: pointsNow(s) });
            }
        }
        s.cat = next;
        s.catSince = at;
    };

    const apply = (ev) => {
        const s = states.get(String(ev.task_id));
        if (!s) return;
        const at = ms(ev.at);
        if (ev.field === '_created' || ev.field === '_restored') {
            const wasIn = s.exists && inSprint(s);
            s.exists = true;
            if (ev.field === '_created') {
                s.addedAt = at;
                s.catSince = at;
                s.createdEventAt = at;
            }
            if (!wasIn && inSprint(s)) recordChurn(s, ev, 'added', pointsNow(s));
            return;
        }
        if (ev.field === '_removed') {
            if (s.exists && inSprint(s)) recordChurn(s, ev, 'removed', -pointsNow(s));
            s.exists = false;
            return;
        }
        if (!TRACKED_FIELDS.includes(ev.field)) return;
        const to = ev.to === undefined ? null : ev.to;
        if (ev.field === 'sprint') {
            // The closed sprint keeps its spillover in its own view (moved out on completion).
            if (sprintId && String(ev.from ?? '') === sprintId && ev.reason === SPRINT_COMPLETED_REASON) return;
            const wasIn = inSprint(s);
            s.values.sprint = to;
            const nowIn = inSprint(s);
            if (sprintId && !wasIn && nowIn) {
                s.addedAt = at;
                if (s.exists) recordChurn(s, ev, 'added', pointsNow(s));
            } else if (sprintId && wasIn && !nowIn && s.exists) {
                recordChurn(s, ev, 'removed', -pointsNow(s));
            }
            return;
        }
        if (ev.field === 'story_points') {
            const delta = toPoints(to) - toPoints(s.values.story_points);
            s.values.story_points = to;
            if (delta !== 0 && s.exists && inSprint(s)) recordChurn(s, ev, 'resized', delta);
            return;
        }
        s.values[ev.field] = to;
        const initial = (ev.from === null || ev.from === undefined) && s.createdEventAt === at;
        if (ev.field === 'status' || ev.field === 'blocked') updateCategory(s, at, initial);
    };

    let dayIdx = 0;
    const flushDaysBefore = (t) => {
        while (dayIdx < days.length && dayEndMs(days[dayIdx]) < t) {
            if (dayStartMs(days[dayIdx]) <= nowMs) snapshotDay(days[dayIdx]);
            dayIdx += 1;
        }
    };
    for (const ev of events) {
        const at = ms(ev.at);
        if (at === null) continue;
        flushDaysBefore(at);
        apply(ev);
    }
    flushDaysBefore(Infinity);

    // --- flow ------------------------------------------------------------------------------
    const cycleTimes = [];
    const leadTimes = [];
    for (const [id, c] of lastCompletion) {
        const r = registry.get(id);
        const key = keyOf(r);
        if (c.startedAt !== null && c.startedAt <= c.at) cycleTimes.push({ task_id: id, key, days: roundDays(c.at - c.startedAt) });
        const leadStart = sprintId ? c.addedAt : (r.createdAt ?? c.addedAt);
        if (leadStart !== null && leadStart <= c.at) leadTimes.push({ task_id: id, key, days: roundDays(c.at - leadStart) });
    }
    const stageTimes = [...stage.values()]
        .map((a) => ({ from: a.from, to: a.to, avg_days: roundDays(a.sum / a.count), count: a.count }))
        .sort((a, b) => CATEGORIES.indexOf(a.from) - CATEGORIES.indexOf(b.from) || CATEGORIES.indexOf(a.to) - CATEGORIES.indexOf(b.to));
    const throughput = daily.map((d) => ({
        date: d.date,
        points: d.completed.reduce((sum, c) => sum + c.points, 0),
        issues: d.completed.length,
    }));

    // --- velocity --------------------------------------------------------------------------
    const liveTasks = tasks.filter((t) => !t.parent_id);
    const velocity = sprints
        .filter((sp) => sp.status === 'closed' || sp.status === 'active')
        .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')) || (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0))
        .slice(-8)
        .map((sp) => {
            const committed = sp.committed || {};
            let completedPoints = 0;
            let completedIssues = 0;
            if (sp.status === 'closed' && sp.closed) {
                completedPoints = sp.closed.completed_points || 0;
                completedIssues = sp.closed.completed_issues || 0;
            } else {
                for (const t of liveTasks) {
                    const v = taskValues(t);
                    if (String(v.sprint ?? '') !== String(sp._id) || statusCategory(v.status) !== 'done') continue;
                    completedPoints += toPoints(v[pointsKey]);
                    completedIssues += 1;
                }
            }
            return {
                sprint_id: String(sp._id),
                name: sp.name,
                start_date: sp.start_date || null,
                end_date: sp.end_date || null,
                status: sp.status,
                committed_points: committed.points || 0,
                completed_points: completedPoints,
                committed_issues: committed.issues || 0,
                completed_issues: completedIssues,
            };
        });

    return {
        range: { from, to },
        days,
        sprint: sprint || null,
        statuses: statusOptions(fields),
        daily,
        churn,
        flow: { cycle_times: cycleTimes, lead_times: leadTimes, stage_times: stageTimes, throughput },
        velocity,
    };
};
