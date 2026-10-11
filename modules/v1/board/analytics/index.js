import { z } from 'zod';
import { getAnalyticsSchema, MAX_RANGE_DAYS } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { loadAccessibleBoard, ensureSprintsMigrated, listSprints, todayString } from '../../utils/sprints.js';
import { ensureEventsBackfilled, loadBoardEvents } from '../../utils/taskEvents.js';
import { buildAnalytics, daysBetween, addDays } from '../../utils/boardAnalytics.js';
import { collection } from '../../utils/boardTasks.js';

/**
 * GET /v1/board/analytics?board_id=&sprint_id=      (sprint mode: the sprint's start..end dates)
 * GET /v1/board/analytics?board_id=&from=&to=       (range mode, max 120 days; default last 30)
 * See utils/boardAnalytics.js buildAnalytics for the payload. The board's event log is backfilled
 * from page_history the first time this is called for a board.
 */
export default async (request, response) => {
    try {
        const q = getAnalyticsSchema.parse(request.query || {});
        const board = await loadAccessibleBoard(q.board_id, request);
        if (!board) return response.status(404).json(formatErrorMessage('Board not found'));

        await ensureSprintsMigrated(board);
        await ensureEventsBackfilled(board);

        const today = todayString();
        const sprints = await listSprints(board._id);
        let sprint = null;
        let from;
        let to;
        if (q.sprint_id) {
            sprint = sprints.find((s) => String(s._id) === q.sprint_id) || null;
            if (!sprint) return response.status(404).json(formatErrorMessage('Sprint not found'));
            const created = sprint.createdAt ? new Date(sprint.createdAt).toISOString().slice(0, 10) : today;
            from = sprint.start_date || created;
            to = sprint.end_date || (sprint.start_date ? addDays(sprint.start_date, 13) : today);
            if (to < from) to = from;
            if (daysBetween(from, to).length > MAX_RANGE_DAYS) to = addDays(from, MAX_RANGE_DAYS - 1);
        } else {
            to = q.to || (q.from ? addDays(q.from, 29) : today);
            from = q.from || addDays(to, -29);
            if (to < from) return response.status(400).json(formatErrorMessage('to must be on or after from'));
            if (daysBetween(from, to).length > MAX_RANGE_DAYS) {
                return response.status(400).json(formatErrorMessage(`The range may span at most ${MAX_RANGE_DAYS} days`));
            }
        }

        // One tasks query + one events query.
        const tasks = await collection('page_meta')
            .find({ board_id: String(board._id) }, { projection: { title: 1, task_number: 1, parent_id: 1, createdAt: 1, custom_meta: 1 } })
            .toArray();
        const events = await loadBoardEvents(board._id);

        const result = buildAnalytics({ board, tasks, events, sprint, sprints, from, to, today });
        const actorIds = [...new Set(result.churn.map((c) => c.actor).filter(Boolean))];
        if (actorIds.length) {
            const users = await global.User.find({ _id: { in: actorIds } }).select(['name']);
            const names = new Map(users.map((u) => [String(u._id), u.name || null]));
            result.churn.forEach((c) => { c.actor_name = c.actor ? (names.get(String(c.actor)) || null) : null; });
        }
        response.json(formatSuccessMessage('Board analytics', result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
