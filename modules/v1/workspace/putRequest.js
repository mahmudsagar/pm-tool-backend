import { z } from 'zod';
import { putWorkspaceSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const body = await request.json();

        const validatedData = putWorkspaceSchema.parse(body);

        const workspace = await global.Workspace.findOne({ _id: validatedData._id });
        if (!workspace) {
            return response.status(404).json(formatErrorMessage('Workspace not found'));
        }

        // Allow admins to update workspace too
        const memberRole = (workspace.member_roles || []).find(r => r.user_id === request.user.id);
        const isAdmin = workspace.owner_id === request.user.id || (memberRole && memberRole.role === 'admin');
        if (!isAdmin) {
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

        const result = await global.Workspace.updateOne({ _id: validatedData._id }).set(updateData);

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
