import { z } from 'zod';
import { getTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id, user_id, search } = request.query;

        let result;
        if (id && user_id) {
            result = await global.Team.findOne({ _id: id, user_id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found for the given _id and user_id'));
            }
        } else if (id) {
            result = await global.Team.findOne({ _id: id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found'));
            }
        } else if (user_id) {
            result = await global.Team.find({ user_id });
            if (result.length === 0) {
                return response.status(404).json(formatErrorMessage('No teams found for the given user_id'));
            }
        } else if (search) {
            const searchRegex = search;
        
            result = await global.Team.find({
                where: {
                    or: [
                        { name: { contains: searchRegex }, user_id: request.user.id },
                        { name: { contains: searchRegex }, shared_members: { contains: request.user.id } }
                    ]
                },
                select: ['_id', 'name', 'user_id']
            });
        
            if (!result || result.length === 0) {
                return response.status(404).json(formatErrorMessage('No teams found matching the search criteria'));
            }
        }

        response.json(formatSuccessMessage("Team fetched successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            // Handle Zod validation errors
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            // Handle other errors
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};