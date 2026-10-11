import { z } from 'zod';
import qs from 'qs';
import { getBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';
import { ensureBoardKey, backfillTaskNumbers, commentCounts, decorateTask, compareTasks } from '../utils/boardTasks.js';
import { ensureEventsBackfilled, decorateTaskTimestamps } from '../utils/taskEvents.js';

/**
 * Check if a document matches a filter condition.
 */
function matchesFilter(doc, { field, operator, value }) {
    const CORE_FIELDS = new Set(['title', 'user_id', 'createdAt', 'updatedAt', 'page_type', 'entity_type', 'task_number', 'task_key', 'sort_order']);
    const cellVal = CORE_FIELDS.has(field)
        ? doc[field]
        : doc.custom_meta?.values?.[field];
    const cell = cellVal !== undefined && cellVal !== null ? String(cellVal) : '';
    const val  = value !== undefined && value !== null ? String(value) : '';
    
    switch (operator) {
        case 'is':          return cell === val;
        case 'is_not':      return cell !== val;
        case 'contains':    return cell.toLowerCase().includes(val.toLowerCase());
        case 'is_empty':    return cell === '';
        case 'is_not_empty':return cell !== '';
        default:            return true;
    }
}

/**
 * Apply in-memory filters, sorts and search to a hierarchy of documents (with subtasks).
 * filters: Array<{ field, operator, value }>
 * sorts:   Array<{ field, direction: 'asc'|'desc' }>
 * search:  string  (matches title)
 * 
 * IMPORTANT: Each document (parent and subtask) is filtered independently.
 * Only show items that directly match the criteria.
 */
function applyView(topLevelDocs, { filters = [], sorts = [], search = '' } = {}) {
    const CORE_FIELDS = new Set(['title', 'user_id', 'createdAt', 'updatedAt', 'page_type', 'entity_type', 'task_number', 'task_key', 'sort_order']);
    
    // Helper: check if a document matches search
    function matchesSearch(doc) {
        if (!search || !search.trim()) return true;
        const q = search.toLowerCase();
        return (doc.title || '').toLowerCase().includes(q) ||
               (doc.summary || '').toLowerCase().includes(q);
    }

    // Helper: check if a document matches all filters
    function matchesAllFilters(doc) {
        if (filters.length === 0) return true;
        return filters.every(f => matchesFilter(doc, f));
    }

    let items = [];

    // Process each parent and its subtasks independently
    for (const parent of topLevelDocs) {
        const parentMatches = matchesSearch(parent) && matchesAllFilters(parent);
        const subtasks = parent.subtasks || [];
        const matchingSubtasks = subtasks.filter(sub => 
            matchesSearch(sub) && matchesAllFilters(sub)
        );

        // If parent matches, add it with filtered subtasks
        if (parentMatches) {
            items.push({
                ...parent,
                subtasks: matchingSubtasks
            });
        } else if (matchingSubtasks.length > 0) {
            // If only subtasks match, add them as independent items (not nested under parent)
            items.push(...matchingSubtasks);
        }
    }

    // Step 2: Sort
    if (sorts.length) {
        items.sort((a, b) => {
            for (const { field, direction } of sorts) {
                const av = CORE_FIELDS.has(field) ? a[field] : a.custom_meta?.values?.[field];
                const bv = CORE_FIELDS.has(field) ? b[field] : b.custom_meta?.values?.[field];
                const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
                if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
            }
            return 0;
        });
    }

    return items;
}

export default async (request, response) => {
    try {
        // HyperExpress exposes raw URL via request.url; extract query string from it
        // and re-parse with qs so we get proper nested-array support for filters/sorts.
        const rawUrl = request.url || '';
        const qsStart = rawUrl.indexOf('?');
        const rawQuery = qsStart !== -1 ? rawUrl.slice(qsStart + 1) : '';
        const parsed = qs.parse(rawQuery);

        const { id, user_id, filters, sorts, search } = parsed;
        const workspaceId = request.workspaceId;
        const userId = request.user.id;

        const validateQuery = getBoardSchema.parse({ _id: id, user_id });

        let result;
        if (validateQuery._id) {
            // 404 (not 403) when the board is missing, in another workspace, or not accessible,
            // so the response does not reveal whether the id exists.
            const board = await global.Board.findOne({ _id: validateQuery._id, workspace_id: workspaceId });
            if (!board || !(await canUserAccessEntity(board, userId, workspaceId))) {
                return response.status(404).json(formatErrorMessage('Board not found'));
            }
            result = [board];
        } else {
            const allBoards = await global.Board.find({ workspace_id: workspaceId });
            const accessible = await Promise.all(
                allBoards.map(async (board) => (await canUserAccessEntity(board, userId, workspaceId)) ? board : null)
            );
            result = accessible.filter(Boolean);
        }

        if (!result || (Array.isArray(result) && result.length === 0)) {
            const error = validateQuery._id && validateQuery.user_id ?
                'Board not found for the given _id and user_id' :
                validateQuery._id ?
                    'Board not found' :
                    validateQuery.user_id ?
                        'No boards found for the given user_id' :
                        'No boards found';
            return response.status(404).json(formatErrorMessage(error));
        }

        const viewParams = {
            filters: Array.isArray(filters) ? filters : (filters ? [filters] : []),
            sorts:   Array.isArray(sorts)   ? sorts   : (sorts   ? [sorts]   : []),
            search:  typeof search === 'string' ? search : '',
        };
        const hasView = viewParams.filters.length || viewParams.sorts.length || viewParams.search;

        for (const board of result) {
            const boardKey = await ensureBoardKey(board);
            // Lazy one-time task event backfill from page_history (single-board GET; also run by analytics).
            if (validateQuery._id) await ensureEventsBackfilled(board);

            // Trashed tasks are not in page_meta any more: trash moves the rows into a
            // trash_item snapshot (see utils/trash.js), so every row found here is live.
            let pageMetas = await global.PageMeta.find({ board_id: board._id });
            // Lazily number tasks created before task keys existed (persisted once).
            if (await backfillTaskNumbers(board._id, pageMetas)) {
                pageMetas = await global.PageMeta.find({ board_id: board._id });
                const fresh = await global.Board.findOne({ _id: board._id });
                if (fresh) board.task_seq = fresh.task_seq;
            }
            board.task_seq = typeof board.task_seq === 'number' ? board.task_seq : 0;

            const counts = await commentCounts(pageMetas.map((p) => p._id));
            pageMetas.forEach((p) => decorateTask(p, boardKey, counts));
            // completed_at / started_at / status_changed_at / blocked_at from the event log.
            await decorateTaskTimestamps(board, pageMetas);
            pageMetas.sort(compareTasks);

            // Separate top-level tasks from subtasks FIRST (before filtering)
            const topLevel = pageMetas.filter(p => !p.parent_id);
            const subtaskMap = {};
            pageMetas.filter(p => p.parent_id).forEach(sub => {
                if (!subtaskMap[sub.parent_id]) subtaskMap[sub.parent_id] = [];
                subtaskMap[sub.parent_id].push(sub);
            });
            topLevel.forEach(t => { t.subtasks = subtaskMap[t._id] || []; });

            // NOW apply filters/sorts/search to the organized hierarchy
            // This ensures parents whose subtasks match are kept
            let documents = topLevel;
            if (hasView) {
                documents = applyView(documents, viewParams);
            }
            board.documents = documents;
        }
        response.json(formatSuccessMessage("Boards fetched successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};