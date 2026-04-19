import { formatErrorMessage } from '../../utils/error.js';
import { formatSuccessMessage } from '../../utils/success.js';

const ROLE_PRIORITY = { manager: 3, contributor: 2, viewer: 1 };

export default async (request, response) => {
    try {
        const { id } = request.query;
        const userId = request.user.id;
        const workspaceId = request.workspaceId;

        if (!id) {
            return response.status(400).json(formatErrorMessage('Space ID is required'));
        }

        const space = await global.Space.findOne({ _id: id });
        if (!space) {
            return response.status(404).json(formatErrorMessage('Space not found'));
        }

        // Build effective access list
        const effectiveAccess = {};

        // Owner always has full access
        const owner = await global.User.findOne({ _id: space.user_id });
        if (owner) {
            const { password: _, ...ownerInfo } = owner;
            effectiveAccess[space.user_id] = {
                user: ownerInfo,
                role: 'manager',
                source: 'owner',
                teams: [],
            };
        }

        // Process team-based access
        const teamDetails = [];
        for (const teamAccess of (space.shared_teams || [])) {
            const teamId = typeof teamAccess === 'string' ? teamAccess : teamAccess.team_id;
            const teamRole = typeof teamAccess === 'object' ? teamAccess.role : 'contributor';
            
            const team = await global.Team.findOne({ _id: teamId });
            if (!team) continue;

            teamDetails.push({ ...team, space_role: teamRole });

            const allTeamMemberIds = [...(team.shared_members || [])];
            if (team.user_id) allTeamMemberIds.push(team.user_id);

            for (const memberId of allTeamMemberIds) {
                if (!effectiveAccess[memberId]) {
                    const user = await global.User.findOne({ _id: memberId });
                    if (!user) continue;
                    const { password: _, ...userInfo } = user;
                    effectiveAccess[memberId] = {
                        user: userInfo,
                        role: teamRole,
                        source: 'team',
                        teams: [{ team_id: teamId, team_name: team.name, role: teamRole }],
                    };
                } else {
                    effectiveAccess[memberId].teams.push({ team_id: teamId, team_name: team.name, role: teamRole });
                    // Most permissive wins for team roles (unless individual override exists)
                    if (effectiveAccess[memberId].source === 'team') {
                        if (ROLE_PRIORITY[teamRole] > ROLE_PRIORITY[effectiveAccess[memberId].role]) {
                            effectiveAccess[memberId].role = teamRole;
                        }
                    }
                }
            }
        }

        // Process individual member access (overrides team access)
        for (const memberAccess of (space.shared_members || [])) {
            const memberId = typeof memberAccess === 'string' ? memberAccess : memberAccess.user_id;
            const memberRole = typeof memberAccess === 'object' ? memberAccess.role : 'contributor';

            if (effectiveAccess[memberId]) {
                // Individual override
                effectiveAccess[memberId].individual_role = memberRole;
                effectiveAccess[memberId].role = memberRole; // individual wins
                if (effectiveAccess[memberId].source === 'team') {
                    effectiveAccess[memberId].source = 'both';
                }
            } else {
                const user = await global.User.findOne({ _id: memberId });
                if (!user) continue;
                const { password: _, ...userInfo } = user;
                effectiveAccess[memberId] = {
                    user: userInfo,
                    role: memberRole,
                    individual_role: memberRole,
                    source: 'individual',
                    teams: [],
                };
            }
        }

        // Space lead info
        let spaceLeadInfo = null;
        if (space.space_lead) {
            const lead = await global.User.findOne({ _id: space.space_lead });
            if (lead) {
                const { password: _, ...leadInfo } = lead;
                const leadAccess = effectiveAccess[space.space_lead];
                const leadWarnings = [];
                if (leadAccess && leadAccess.role === 'viewer') {
                    leadWarnings.push('Space lead is a Viewer and cannot act on escalations');
                }
                spaceLeadInfo = { ...leadInfo, warnings: leadWarnings };
            }
        }

        response.json(formatSuccessMessage("Space access fetched successfully", {
            space_id: space._id,
            space_name: space.name,
            space_lead: spaceLeadInfo,
            teams: teamDetails,
            access_list: Object.values(effectiveAccess),
            settings: {
                color: space.color,
                icon: space.icon,
                default_view: space.default_view,
                working_start_date: space.working_start_date,
                working_end_date: space.working_end_date,
            },
        }));
    } catch (err) {
        response.status(400).json(formatErrorMessage(err.message));
    }
};
