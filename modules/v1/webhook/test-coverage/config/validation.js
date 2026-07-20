import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const fileCoverageEntrySchema = z.object({
    lines_covered: z.number().nonnegative().optional(),
    lines_total: z.number().nonnegative().optional(),
    coverage_percent: z.number().min(0).max(100).optional(),
    percent: z.number().min(0).max(100).optional(),
}).refine((entry) => entry.coverage_percent !== undefined || entry.percent !== undefined, {
    message: 'Each file entry must include coverage_percent or percent',
});

export const postTestCoverageWebhookSchema = z.object({
    token: z.string().optional(),
    board_id: z.string().nonempty('board_id is required').refine(isValidObjectId, {
        message: 'Invalid board_id',
    }),
    branch: z.string().nonempty('branch is required'),
    commit_sha: z.string().optional(),
    coverage_percent: z.number().min(0).max(100),
    lines_covered: z.number().nonnegative().optional(),
    lines_total: z.number().nonnegative().optional(),
    file_coverage: z.record(fileCoverageEntrySchema).optional(),
});

export const getTestCoverageSchema = z.object({
    board_id: z.string().nonempty('board_id is required').refine(isValidObjectId, {
        message: 'Invalid board_id',
    }),
    sprint: z.string().optional(),
});
