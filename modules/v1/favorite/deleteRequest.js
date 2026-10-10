import { z } from 'zod';
import { favoriteEntitySchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

// DELETE /v1/favorite?entity_type=&entity_id= — idempotent unstar.
export default async (request, response) => {
    try {
        const { entity_type, entity_id } = favoriteEntitySchema.parse(request.query || {});
        await global.Favorite.destroy({ user_id: request.user.id, entity_type, entity_id });
        response.json(formatSuccessMessage('Favorite removed successfully', { entity_type, entity_id }));
    } catch (err) {
        if (err instanceof z.ZodError) {
            response.status(400).json(formatErrorMessage(formatZodErrors(err.errors)));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
