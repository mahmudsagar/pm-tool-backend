import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getTeamHealthSchema = z.object({
    board_id: z.string().nonempty('board_id is required').refine(isValidObjectId, {
        message: 'Invalid board_id',
    }),
});
