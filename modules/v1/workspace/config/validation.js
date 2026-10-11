import { z } from 'zod';

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const SLUG_REGEX = /^[a-z0-9-]{3,48}$/;

export const workspaceFeaturesSchema = z.object({
    sheets: z.boolean().optional(),
    whiteboards: z.boolean().optional(),
    databoards: z.boolean().optional(),
    scrum: z.boolean().optional(),
    chat: z.boolean().optional(),
});

export const spacePoliciesSchema = z.object({
    allow_member_public_create: z.boolean().optional(),
    default_space_id: z.string().refine(isValidObjectId, { message: 'Invalid MongoDB ObjectId' }).nullable().optional(),
});

export const WORKSPACE_DEFAULTS = {
    slug: '',
    language: 'en-US',
    sprint_cadence: '2w',
    issue_prefix: '',
    features: {},
    auto_archive_days: 0,
    space_policies: {},
    archived_at: null,
};

export const slugQuerySchema = z.object({
    slug: z.string().nonempty('slug is required'),
});

export const transferOwnerSchema = z.object({
    user_id: z.string().nonempty('User ID is required').refine(isValidObjectId, { message: 'Invalid MongoDB ObjectId' }),
});

export const archiveWorkspaceSchema = z.object({
    archived: z.boolean({ required_error: 'archived is required' }),
});

export const postWorkspaceSchema = z.object({
    name: z.string().nonempty("Name is required"),
    description: z.string().optional(),
});

export const putWorkspaceSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    name: z.string().optional(),
    description: z.string().optional(),
    logo: z.string().optional(),
    timezone: z.string().optional(),
    date_format: z.string().optional(),
    first_day_of_week: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).optional(),
    working_days: z.array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])).optional(),
    billing_plan: z.string().optional(),
    slug: z.string().regex(SLUG_REGEX, 'Slug must be 3-48 lowercase letters, digits or "-"').optional(),
    language: z.string().max(16).optional(),
    sprint_cadence: z.enum(['1w', '2w', '3w', '4w', 'monthly']).optional(),
    issue_prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'Issue prefix must be 1-8 uppercase letters/digits starting with a letter').optional(),
    features: workspaceFeaturesSchema.optional(),
    auto_archive_days: z.number().int().min(0).max(365).optional(),
    space_policies: spacePoliciesSchema.optional(),
});

export const getWorkspaceSchema = z.object({
    _id: z.string().optional().refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }).or(z.undefined()),
});

export const deleteWorkspaceSchema = z.object({
    _id: z.string().nonempty("ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});

export const postMemberSchema = z.object({
    email: z.string().email("Invalid email address").optional(),
    user_id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    role: z.enum(['admin', 'member', 'guest']).default('member'),
}).refine(data => data.email || data.user_id, {
    message: "Either email or user_id must be provided",
    path: ["email", "user_id"],
});

export const deleteMemberSchema = z.object({
    workspace_id: z.string().nonempty("Workspace ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
});

export const putMemberRoleSchema = z.object({
    user_id: z.string().nonempty("User ID is required").refine(isValidObjectId, {
        message: "Invalid MongoDB ObjectId",
    }),
    role: z.enum(['admin', 'member', 'guest'], { message: "Role must be admin, member, or guest" }).optional(),
    status: z.enum(['active', 'suspended'], { message: "Status must be active or suspended" }).optional(),
}).refine(data => data.role || data.status, {
    message: "Either role or status must be provided",
    path: ["role"],
});

export const bulkMemberSchema = z.object({
    user_ids: z.array(z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" })).min(1, 'user_ids must not be empty').max(500),
    role: z.enum(['admin', 'member', 'guest'], { message: "Role must be admin, member, or guest" }).optional(),
    status: z.enum(['active', 'suspended'], { message: "Status must be active or suspended" }).optional(),
}).refine(data => data.role || data.status, {
    message: "Either role or status must be provided",
    path: ["role"],
});

export const postInvitationSchema = z.object({
    emails: z.array(z.string().trim().toLowerCase().pipe(z.string().email('Invalid email address')))
        .min(1, 'At least one email is required').max(50, 'At most 50 emails per request'),
    role: z.enum(['admin', 'member', 'guest'], { message: "Role must be admin, member, or guest" }).default('member'),
    space_ids: z.array(z.string().refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" })).optional().default([]),
});

export const invitationIdSchema = z.object({
    id: z.string().nonempty('Invitation ID is required').refine(isValidObjectId, { message: "Invalid MongoDB ObjectId" }),
});
