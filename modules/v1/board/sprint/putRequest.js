import { z } from 'zod';
import { putSprintSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';
import { loadAccessibleSprint } from '../../utils/sprints.js';

/**
 * PUT /v1/board/sprint { id, name?, goal?, start_date?, end_date? }
 * end_date must be on or after start_date (checked against the stored value when only one is sent).
 * → data: sprint
 */
export default async (request, response) => {
    try {
        const { id, ...patch } = putSprintSchema.parse(request.body || {});
        const found = await loadAccessibleSprint(id, request);
        if (!found) return response.status(404).json(formatErrorMessage('Sprint not found'));

        const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const start = changes.start_date !== undefined ? changes.start_date : found.sprint.start_date;
        const end = changes.end_date !== undefined ? changes.end_date : found.sprint.end_date;
        if (start && end && end < start) {
            return response.status(400).json(formatErrorMessage('end_date must be on or after start_date'));
        }
        if (Object.keys(changes).length === 0) {
            return response.json(formatSuccessMessage('Sprint updated successfully', found.sprint));
        }
        const [sprint] = await global.Sprint.update({ _id: id }, changes).fetch();
        response.json(formatSuccessMessage('Sprint updated successfully', sprint));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
