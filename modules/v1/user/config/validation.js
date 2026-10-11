import { z } from 'zod';

// Custom validation function for MongoDB ObjectId
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

export const getUserSchema = z.object({
    _id: z.string().optional().refine(value => !value || isValidObjectId(value), {
        message: "Invalid MongoDB ObjectId",
    }),
    search: z.string().optional()
}).refine(data => data._id || data.search, {
    message: "Either _id or search query must be provided",
    path: ["_id", "search"]
});

export const HANDLE_REGEX = /^[a-z0-9._-]+$/;

export const handleSchema = z.string().min(2, 'Handle must be at least 2 characters')
    .max(32, 'Handle must be at most 32 characters')
    .regex(HANDLE_REGEX, 'Handle may only contain lowercase letters, digits, ".", "_" and "-"');

const isValidTimezone = (tz) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

export const preferencesSchema = z.object({
    accent: z.enum(['indigo', 'emerald', 'violet', 'cyan', 'amber', 'slate']).optional(),
    density: z.enum(['compact', 'comfortable']).optional(),
});

export const notificationPrefsSchema = z.object({
    mentions: z.boolean().optional(),
    assignments: z.boolean().optional(),
    updates: z.boolean().optional(),
    digest: z.enum(['daily', 'instant', 'off']).optional(),
    snooze_until: z.string().datetime({ offset: true, message: 'snooze_until must be an ISO date string' }).nullable().optional(),
});

export const putUserSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).optional(),
    avatar: z.string().optional(),
    handle: handleSchema.optional(),
    title: z.string().max(100).optional(),
    pronouns: z.string().max(40).optional(),
    timezone: z.string().max(64).refine((tz) => tz === '' || isValidTimezone(tz), {
        message: 'Invalid IANA timezone',
    }).optional(),
    preferences: preferencesSchema.optional(),
    notification_prefs: notificationPrefsSchema.optional(),
});

export const handleQuerySchema = z.object({
    handle: z.string().nonempty('handle is required'),
});

export const changePasswordSchema = z.object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "New password must be at least 8 characters"),
});