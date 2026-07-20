const DONE_KEYS = ['done', 'completed', 'complete', 'closed'];

const HEALTH_LEVELS = ['low', 'medium', 'high'];
const SIGNAL_WEIGHTS = { sentiment: 0.4, workload: 0.35, blocker: 0.25 };
const SUSTAINED_WEEKS_REQUIRED = 2;

const norm = (v) => String(v || '').trim().toLowerCase();
const asPoints = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function getIsoWeekKey(dateInput = new Date()) {
  const date = new Date(dateInput);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function levelToScore(level) {
  if (level === 'high') return 100;
  if (level === 'medium') return 50;
  return 0;
}

function scoreToLevel(weightedScore) {
  if (weightedScore >= 70) return 'high';
  if (weightedScore >= 40) return 'medium';
  return 'low';
}

function computeSprintPointsByAssignee(stories = [], sprintName) {
  const map = new Map();
  stories.forEach((story) => {
    if (String(story.sprint || '') !== String(sprintName || '')) return;
    const assigneeId = String(story.assignee || '').trim();
    if (!assigneeId) return;
    map.set(assigneeId, (map.get(assigneeId) || 0) + asPoints(story.story_points));
  });
  return map;
}

function buildOrderedSprintList(sprintCfg = {}, stories = []) {
  const names = new Set((sprintCfg.sprints || []).filter(Boolean));
  stories.forEach((story) => {
    if (story.sprint) names.add(String(story.sprint));
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

function computeTrailingSprintAverage(stories, sprintList, activeSprint, assigneeId, count = 3) {
  const activeIndex = sprintList.indexOf(activeSprint);
  if (activeIndex <= 0) return null;
  const previousSprints = sprintList.slice(0, activeIndex).slice(-count);
  if (!previousSprints.length) return null;

  const total = previousSprints.reduce((sum, sprintName) => {
    const sprintMap = computeSprintPointsByAssignee(stories, sprintName);
    return sum + (sprintMap.get(String(assigneeId)) || 0);
  }, 0);

  return total / previousSprints.length;
}

function scoreWorkloadSignal(currentPoints, trailingAvg) {
  if (trailingAvg == null || trailingAvg <= 0) {
    if (currentPoints >= 20) {
      return { level: 'high', reason: `${currentPoints} pts assigned (no trailing sprint baseline)` };
    }
    if (currentPoints >= 13) {
      return { level: 'medium', reason: `${currentPoints} pts assigned` };
    }
    return { level: 'low', reason: `${currentPoints} pts assigned` };
  }

  const ratio = currentPoints / trailingAvg;
  const avgLabel = trailingAvg.toFixed(1);
  if (ratio >= 1.25) {
    return {
      level: 'high',
      reason: `${currentPoints} pts vs ${avgLabel} trailing 3-sprint avg (+${Math.round((ratio - 1) * 100)}%)`,
      ratio,
      currentPoints,
      trailingAvg,
    };
  }
  if (ratio >= 1.1) {
    return {
      level: 'medium',
      reason: `${currentPoints} pts vs ${avgLabel} trailing 3-sprint avg`,
      ratio,
      currentPoints,
      trailingAvg,
    };
  }
  return {
    level: 'low',
    reason: `${currentPoints} pts vs ${avgLabel} trailing 3-sprint avg`,
    ratio,
    currentPoints,
    trailingAvg,
  };
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function scoreSentimentSignal(standups = [], userId, windowDays = 14) {
  const cutoff = Date.now() - windowDays * 86400000;
  const entries = standups.filter((entry) => {
    if (String(entry.user_id || '') !== String(userId)) return false;
    if (entry.sentiment_score == null || entry.sentiment_score === '') return false;
    const at = new Date(entry.at || entry.created_at || 0).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });

  if (!entries.length) {
    return { level: 'low', reason: 'No recent sentiment check-ins', score: null };
  }

  const avg = entries.reduce((sum, entry) => sum + Number(entry.sentiment_score), 0) / entries.length;
  if (avg <= 2.5) {
    return { level: 'high', reason: `Average mood ${avg.toFixed(1)}/5 over ${entries.length} check-in(s)`, score: avg };
  }
  if (avg <= 3.5) {
    return { level: 'medium', reason: `Average mood ${avg.toFixed(1)}/5 over ${entries.length} check-in(s)`, score: avg };
  }
  return { level: 'low', reason: `Average mood ${avg.toFixed(1)}/5 over ${entries.length} check-in(s)`, score: avg };
}

function scoreBlockerRecurrence(standups = [], userId) {
  const daysWithBlockers = new Set();
  standups.forEach((entry) => {
    if (String(entry.user_id || '') !== String(userId)) return;
    if (!String(entry.blocker || '').trim()) return;
    const key = dayKey(entry.at || entry.created_at);
    if (key) daysWithBlockers.add(key);
  });

  if (!daysWithBlockers.size) {
    return { level: 'low', reason: 'No blockers logged recently', streak: 0 };
  }

  const sortedDays = [...daysWithBlockers].sort();
  let maxStreak = 1;
  let streak = 1;
  for (let i = 1; i < sortedDays.length; i += 1) {
    const prev = new Date(sortedDays[i - 1]);
    const curr = new Date(sortedDays[i]);
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 1;
    }
  }

  if (maxStreak >= 3) {
    return {
      level: 'high',
      reason: `Blocker logged ${maxStreak} consecutive day(s)`,
      streak: maxStreak,
    };
  }
  if (maxStreak === 2) {
    return {
      level: 'medium',
      reason: 'Blocker logged 2 consecutive day(s)',
      streak: maxStreak,
    };
  }
  return {
    level: 'low',
    reason: 'Blocker logged on isolated day(s)',
    streak: maxStreak,
  };
}

function combineHealthScore(factors) {
  const weightedScore = (
    levelToScore(factors.sentiment.level) * SIGNAL_WEIGHTS.sentiment
    + levelToScore(factors.workload.level) * SIGNAL_WEIGHTS.workload
    + levelToScore(factors.blocker.level) * SIGNAL_WEIGHTS.blocker
  );

  return {
    overall: scoreToLevel(weightedScore),
    weightedScore: Math.round(weightedScore),
    factors,
    weights: SIGNAL_WEIGHTS,
  };
}

function buildPersonHealthProfile({
  userId,
  stories = [],
  standups = [],
  sprintList = [],
  activeSprint = '',
}) {
  const sprintPoints = computeSprintPointsByAssignee(stories, activeSprint);
  const currentPoints = sprintPoints.get(String(userId)) || 0;
  const trailingAvg = computeTrailingSprintAverage(stories, sprintList, activeSprint, userId, 3);

  const factors = {
    sentiment: scoreSentimentSignal(standups, userId),
    workload: scoreWorkloadSignal(currentPoints, trailingAvg),
    blocker: scoreBlockerRecurrence(standups, userId),
  };

  const combined = combineHealthScore(factors);

  return {
    userId: String(userId),
    person_sprint_load: {
      points_assigned: currentPoints,
      trailing_three_sprint_avg: trailingAvg,
    },
    ...combined,
  };
}

function hasSustainedElevatedRisk(weeklySnapshots = {}, userId, weeksRequired = SUSTAINED_WEEKS_REQUIRED) {
  const weekKeys = Object.keys(weeklySnapshots).sort();
  const recent = weekKeys.slice(-weeksRequired);
  if (recent.length < weeksRequired) return false;

  return recent.every((weekKey) => {
    const entry = weeklySnapshots[weekKey]?.[userId];
    return entry && (entry.overall === 'medium' || entry.overall === 'high');
  });
}

function upsertWeeklySnapshot(teamHealth = {}, profiles = []) {
  const weekKey = getIsoWeekKey();
  const weeklySnapshots = { ...(teamHealth.weekly_snapshots || {}) };
  const weekEntry = { ...(weeklySnapshots[weekKey] || {}) };

  profiles.forEach((profile) => {
    weekEntry[profile.userId] = {
      overall: profile.overall,
      weightedScore: profile.weightedScore,
      factors: profile.factors,
      person_sprint_load: profile.person_sprint_load,
      recorded_at: new Date().toISOString(),
    };
  });

  weeklySnapshots[weekKey] = weekEntry;
  return weeklySnapshots;
}

function normalizeTeamRecord(team) {
  return {
    _id: String(team?._id || team?.id || ''),
    name: team?.name || 'Team',
    team_lead: String(team?.team_lead || ''),
    shared_members: Array.isArray(team?.shared_members) ? team.shared_members.map(String) : [],
  };
}

function isWorkspaceManager(viewerId, workspace, teams = []) {
  const viewer = String(viewerId || '');
  if (!viewer) return false;
  if (String(workspace?.owner_id || '') === viewer) return true;

  const member = (workspace?.members || []).find((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.user_id;
    return String(id) === viewer;
  });
  if (member?.role === 'admin') return true;

  const leadTeams = teams.filter((team) => String(team.team_lead || '') === viewer);
  const managedLeadIds = new Set(
    leadTeams.flatMap((team) => team.shared_members).filter((id) => String(id) !== viewer)
  );
  return teams.some((team) => managedLeadIds.has(String(team.team_lead || '')));
}

function getTeamsLedBy(viewerId, teams = []) {
  return teams
    .map(normalizeTeamRecord)
    .filter((team) => String(team.team_lead || '') === String(viewerId || ''));
}

function getDirectReportIds(viewerId, teams = []) {
  const ledTeams = getTeamsLedBy(viewerId, teams);
  const ids = new Set();
  ledTeams.forEach((team) => {
    team.shared_members.forEach((memberId) => {
      if (String(memberId) !== String(viewerId)) ids.add(String(memberId));
    });
  });
  return [...ids];
}

function isEscalated(subjectId, escalations = []) {
  return escalations.some((entry) => String(entry.subject_id) === String(subjectId));
}

function resolveVisibleProfiles({
  viewerId,
  profiles = [],
  teams = [],
  workspace = null,
  escalations = [],
}) {
  const viewer = String(viewerId || '');
  if (!viewer) return { mode: 'none', profiles: [] };

  const selfProfile = profiles.find((profile) => profile.userId === viewer);
  const manager = isWorkspaceManager(viewer, workspace, teams);
  const directReportIds = getDirectReportIds(viewer, teams);
  const isLead = directReportIds.length > 0;

  if (manager) {
    const aggregate = {
      teamCount: teams.length,
      mediumHigh: profiles.filter((profile) => profile.overall !== 'low').length,
      surfaced: profiles.filter((profile) => profile.surfaced).length,
      profiles: profiles
        .filter((profile) => isEscalated(profile.userId, escalations))
        .map((profile) => ({ ...profile, visibility: 'escalated' })),
    };
    return { mode: 'manager', aggregate, selfProfile };
  }

  if (isLead) {
    const visible = profiles
      .filter((profile) => directReportIds.includes(profile.userId) || profile.userId === viewer)
      .map((profile) => ({
        ...profile,
        visibility: profile.userId === viewer ? 'self' : 'direct_report',
      }));
    return { mode: 'team_lead', profiles: visible, selfProfile };
  }

  if (selfProfile) {
    return { mode: 'self', profiles: [{ ...selfProfile, visibility: 'self' }], selfProfile };
  }

  return { mode: 'self', profiles: [], selfProfile: null };
}

function buildTeamHealthDigestPreview(profiles = [], assigneeMap = {}) {
  const trending = profiles
    .filter((profile) => profile.surfaced)
    .map((profile) => ({
      name: assigneeMap[profile.userId] || profile.userId,
      overall: profile.overall,
      why: [
        profile.factors.sentiment.reason,
        profile.factors.workload.reason,
        profile.factors.blocker.reason,
      ],
    }));

  return {
    generated_at: new Date().toISOString(),
    subject: trending.length
      ? `${trending.length} teammate(s) trending Medium/High for 2+ weeks`
      : 'No sustained Medium/High signals this week',
    trending,
  };
}

function collectBoardAssigneeIds(stories = [], assigneeOptions = []) {
  const ids = new Set(assigneeOptions.map((opt) => String(opt.value)));
  stories.forEach((story) => {
    const assigneeId = String(story.assignee || '').trim();
    if (assigneeId) ids.add(assigneeId);
  });
  return [...ids];
}

function buildBoardTeamHealth({
  stories = [],
  standups = [],
  sprintCfg = {},
  teamHealth = {},
  assigneeOptions = [],
  viewerId,
  teams = [],
  workspace = null,
}) {
  const sprintList = buildOrderedSprintList(sprintCfg, stories);
  const activeSprint = sprintCfg.active_sprint || sprintList[sprintList.length - 1] || '';
  const assigneeIds = collectBoardAssigneeIds(stories, assigneeOptions);
  const weeklySnapshots = { ...(teamHealth.weekly_snapshots || {}) };
  const escalations = teamHealth.escalations || [];

  const profiles = assigneeIds.map((userId) => {
    const profile = buildPersonHealthProfile({
      userId,
      stories,
      standups,
      sprintList,
      activeSprint,
    });
    return {
      ...profile,
      surfaced: hasSustainedElevatedRisk(weeklySnapshots, userId),
    };
  });

  const visibility = resolveVisibleProfiles({
    viewerId,
    profiles,
    teams,
    workspace,
    escalations,
  });

  const assigneeMap = Object.fromEntries(
    assigneeOptions.map((opt) => [String(opt.value), opt.label || String(opt.value)])
  );

  return {
    activeSprint,
    sprintList,
    profiles,
    visibility,
    weeklySnapshots,
    digest: buildTeamHealthDigestPreview(profiles, assigneeMap),
  };
}

export {
  buildBoardTeamHealth,
  buildPersonHealthProfile,
  getIsoWeekKey,
  upsertWeeklySnapshot,
  SIGNAL_WEIGHTS,
};
