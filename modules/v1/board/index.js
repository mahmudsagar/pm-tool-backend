import { z } from 'zod';
import qs from 'qs';
import { getBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';
import { canUserAccessEntity } from '../utils/helper.js';

/**
 * Apply in-memory filters, sorts and search to an array of PageMeta documents.
 * filters: Array<{ field, operator, value }>
 * sorts:   Array<{ field, direction: 'asc'|'desc' }>
 * search:  string  (matches title)
 */
function applyView(docs, { filters = [], sorts = [], search = '' } = {}) {
    let items = [...docs];

    // Search
    if (search && search.trim()) {
        const q = search.toLowerCase();
        items = items.filter(doc =>
            (doc.title || '').toLowerCase().includes(q) ||
            (doc.summary || '').toLowerCase().includes(q)
        );
    }

    // Filters — custom_meta values live in doc.custom_meta.values[field]
    // Core fields (title, user_id …) are top-level
    const CORE_FIELDS = new Set(['title', 'user_id', 'createdAt', 'updatedAt', 'page_type', 'entity_type']);
    filters.forEach(({ field, operator, value }) => {
        items = items.filter(doc => {
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
        });
    });

    // Sorts
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
            result = await global.Board.find({ _id: validateQuery._id, workspace_id: workspaceId });
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
            let pageMetas = await global.PageMeta.find({ board_id: board._id }).sort('createdAt ASC');
            if (hasView) {
                pageMetas = applyView(pageMetas, viewParams);
            }
            board.documents = pageMetas;
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