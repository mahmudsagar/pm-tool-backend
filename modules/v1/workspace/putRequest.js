import { z } from 'zod';
import { putWorkspaceSchema } from './config/validation.js';
import { isWorkspaceAdmin, isUniqueViolation } from '../utils/workspaceAccess.js';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = request.body;

        const validatedData = putWorkspaceSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: validatedData._id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Allow admins to update workspace too
        if (!isWorkspaceAdmin(workspace, request.user.id)) {
            return response.status(403).json(formatErrorMessage('Only workspace owner or admins can update this workspace'));
        }

        const updateData = {};
        if (validatedData.name !== undefined) updateData.name = validatedData.name;
        if (validatedData.description !== undefined) updateData.description = validatedData.description;
        if (validatedData.logo !== undefined) updateData.logo = validatedData.logo;
        if (validatedData.timezone !== undefined) updateData.timezone = validatedData.timezone;
        if (validatedData.date_format !== undefined) updateData.date_format = validatedData.date_format;
        if (validatedData.first_day_of_week !== undefined) updateData.first_day_of_week = validatedData.first_day_of_week;
        if (validatedData.working_days !== undefined) updateData.working_days = validatedData.working_days;
        if (validatedData.billing_plan !== undefined) updateData.billing_plan = validatedData.billing_plan;
        if (validatedData.language !== undefined) updateData.language = validatedData.language;
        if (validatedData.sprint_cadence !== undefined) updateData.sprint_cadence = validatedData.sprint_cadence;
        if (validatedData.issue_prefix !== undefined) updateData.issue_prefix = validatedData.issue_prefix;
        if (validatedData.auto_archive_days !== undefined) updateData.auto_archive_days = validatedData.auto_archive_days;

        if (validatedData.slug !== undefined && validatedData.slug !== workspace.slug) {
            const taken = await global.Workspace.findOne({ slug: validatedData.slug, _id: { '!=': workspace._id } });
            if (taken) {
                return response.status(409).json(formatErrorMessage('Slug is taken'));
            }
            updateData.slug = validatedData.slug;
        }

        // JSON settings are merged (partial updates), not replaced
        if (validatedData.features !== undefined) {
            updateData.features = { ...(isPlainObject(workspace.features) ? workspace.features : {}), ...validatedData.features };
        }
        if (validatedData.space_policies !== undefined) {
            const policies = validatedData.space_policies;
            if (policies.default_space_id) {
                const space = await global.Space.findOne({ _id: policies.default_space_id, workspace_id: workspace._id });
                if (!space) {
                    return response.status(400).json(formatErrorMessage('default_space_id must be a space in this workspace'));
                }
            }
            updateData.space_policies = { ...(isPlainObject(workspace.space_policies) ? workspace.space_policies : {}), ...policies };
        }

        let result;
        try {
            result = await global.Workspace.updateOne({ _id: validatedData._id }).set(updateData);
        } catch (updateErr) {
            if (isUniqueViolation(updateErr)) {
                return response.status(409).json(formatErrorMessage('Slug is taken'));
            }
            throw updateErr;
        }

        response.json(formatSuccessMessage("Workspace updated successfully", result));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};
