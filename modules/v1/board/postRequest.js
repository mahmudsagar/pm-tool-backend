import { z } from 'zod';
import { postBoardSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = postBoardSchema.parse({
            name: body.name,
            description: body.description,
            shared_members: body.shared_members,
            shared_teams: body.shared_teams,
            user_id: body.user_id,
            pinned: body.pinned,
            folder_id: body.folder_id,
            space_id: body.space_id,
            group_id: body.group_id,
            custom_meta: body.custom_meta,
        });

        let result = await global.Board.create(validatedData).fetch();
        response.json(formatSuccessMessage("Board created successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
