import { z } from 'zod';
import { slugQuerySchema, SLUG_REGEX } from '../config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

// GET /v1/workspace/slug?slug= -> { available, valid } (the X-Workspace-ID workspace's own slug counts as available)
export default async (request, response) => {
    try {
        const { slug } = slugQuerySchema.parse(request.query);

        if (!SLUG_REGEX.test(slug)) {
            return response.json(formatSuccessMessage('Slug checked', { available: false, valid: false }));
        }

        const criteria = { slug };
        if (request.workspaceId) criteria._id = { '!=': request.workspaceId };
        const taken = await global.Workspace.findOne(criteria);
        response.json(formatSuccessMessage('Slug checked', { available: !taken, valid: true }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
