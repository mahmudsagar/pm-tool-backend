import { z } from 'zod';
import { deleteTeamSchema } from './config/validation.js';
import { formatZodErrors, formatErrorMessage } from '../utils/error.js';
import { formatSuccessMessage } from '../utils/success.js';

export default async (request, response) => {
    try {
        const { id: _id, user_id } = request.query;

        // Validate the request params using Zod
        const validatedParams = deleteTeamSchema.parse({ _id, user_id });

        let result;
        if (validatedParams._id) {
            const team = await global.Team.findOne({ _id: validatedParams._id });
            if (!team) {
                return response.status(404).json(formatErrorMessage('Team not found'));
            }

            // Find spaces that share access with this team and collect affected info
            const affectedSpaces = [];
            if (team.workspace_id) {
                const spaces = await global.Space.find({ workspace_id: team.workspace_id });
                for (const space of spaces) {
                    const sharedTeams = space.shared_teams || [];
                    const hasTeam = sharedTeams.some(t => 
                        (typeof t === 'string' ? t : t.team_id) === validatedParams._id
                    );
                    if (hasTeam) {
                        // Find members who will lose access (only via this team, not individually)
                        const teamMembers = team.shared_members || [];
                        const spaceIndividualMembers = (space.shared_members || []).map(m => 
                            typeof m === 'string' ? m : m.user_id
                        );
                        const membersLosingAccess = teamMembers.filter(m => !spaceIndividualMembers.includes(m));
                        
                        // Remove team from space
                        const updatedSharedTeams = sharedTeams.filter(t => 
                            (typeof t === 'string' ? t : t.team_id) !== validatedParams._id
                        );
                        await global.Space.updateOne({ _id: space._id }).set({ shared_teams: updatedSharedTeams });

                        affectedSpaces.push({
                            space_id: space._id,
                            space_name: space.name,
                            members_losing_access: membersLosingAccess,
                        });
                    }
                }
            }

            // Delete the team
            result = await global.Team.destroyOne({ _id: validatedParams._id });
            if (!result) {
                return response.status(404).json(formatErrorMessage('Team not found'));
            }

            return response.json(formatSuccessMessage('Team deleted successfully', { affected_spaces: affectedSpaces }));
        } else if (validatedParams.user_id) {
            result = await global.Team.destroy({ user_id: validatedParams.user_id });
            if (result?.length === 0) {
                return response.status(404).json(formatErrorMessage('No teams found for the given user_id'));
            }
        } else {
            return response.status(400).json(formatErrorMessage('Either _id or user_id must be provided'));
        }

        response.json(formatSuccessMessage('Team deleted successfully', null));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const formattedErrors = formatZodErrors(err.errors);
            response.status(400).json(formatErrorMessage(formattedErrors));
        } else {
            response.status(400).json(formatErrorMessage(err.message));
        }
    }
};