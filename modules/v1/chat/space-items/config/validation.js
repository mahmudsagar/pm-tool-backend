import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getSpaceItemsSchema = z.object({
    space_id: z.string().nonempty().refine(isValidObjectId, { message: 'Invalid space ID' }),
    query: z.string().optional().default(''),
    limit: z.coerce.number().min(1).max(50).optional().default(20),
});
