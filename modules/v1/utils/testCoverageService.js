const normalizeRef = (value) => String(value || '').trim().toLowerCase();

const stripBranchPrefix = (branch) => {
    const raw = String(branch || '').trim();
    return raw
        .replace(/^refs\/heads\//i, '')
        .replace(/^origin\//i, '');
};

export function branchMatchesRef(branch, ref) {
    const normalizedBranch = normalizeRef(stripBranchPrefix(branch));
    const normalizedRef = normalizeRef(ref);
    if (!normalizedBranch || !normalizedRef) return false;
    if (normalizedBranch === normalizedRef) return true;
    if (normalizedRef.startsWith('pr:')) {
        const pr = normalizedRef.slice(3);
        return normalizedBranch.includes(`pull/${pr}`) || normalizedBranch.endsWith(`/${pr}`);
    }
    if (/^#\d+$/.test(normalizedRef)) {
        const pr = normalizedRef.slice(1);
        return normalizedBranch.includes(`pull/${pr}`) || normalizedBranch.endsWith(`/${pr}`);
    }
    return normalizedBranch.endsWith(`/${normalizedRef}`) || normalizedRef.endsWith(`/${normalizedBranch}`);
}

export function getStoryCoverageRef(story) {
    return story?.custom_meta?.values?.test_coverage_ref
        || story?.test_coverage_ref
        || '';
}

export function findStoryForBranch(stories, branch) {
    if (!branch) return null;
    return stories.find((story) => {
        const ref = getStoryCoverageRef(story);
        return ref && branchMatchesRef(branch, ref);
    }) || null;
}

export function normalizeStoriesFromBoard(board, documents = []) {
    return documents.map((doc) => ({
        _id: doc._id,
        title: doc.title,
        sprint: doc.custom_meta?.values?.sprint || '',
        test_coverage_ref: getStoryCoverageRef(doc),
        custom_meta: doc.custom_meta,
    }));
}

export function resolveSprintId(board, story) {
    const storySprint = String(story?.sprint || story?.custom_meta?.values?.sprint || '').trim();
    if (storySprint) return storySprint;
    return String(board?.saved_view?.scrum?.sprint_management?.active_sprint || '').trim();
}

export function detectFileRegressions(previousSnapshot, currentSnapshot) {
    const previousFiles = previousSnapshot?.file_coverage || {};
    const currentFiles = currentSnapshot?.file_coverage || {};
    const dropped = [];

    Object.keys(currentFiles).forEach((path) => {
        const prev = previousFiles[path];
        const curr = currentFiles[path];
        if (!prev || !curr) return;
        const prevPct = Number(prev.coverage_percent ?? prev.percent ?? 0);
        const currPct = Number(curr.coverage_percent ?? curr.percent ?? 0);
        if (currPct < prevPct) {
            dropped.push({
                path,
                previous: prevPct,
                current: currPct,
            });
        }
    });

    return dropped;
}

export function buildSprintCoverageSummary(snapshots = []) {
    const bySprint = new Map();

    snapshots.forEach((snapshot) => {
        const sprintId = String(snapshot.sprint_id || '').trim() || 'Unassigned';
        const list = bySprint.get(sprintId) || [];
        list.push(snapshot);
        bySprint.set(sprintId, list);
    });

    const summary = {};
    bySprint.forEach((list, sprintId) => {
        const sorted = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const first = sorted[0];
        const latest = sorted[sorted.length - 1];
        const current = Number(latest?.coverage_percent ?? 0);
        const firstValue = Number(first?.coverage_percent ?? 0);
        let trend = 'flat';
        if (current > firstValue) trend = 'up';
        if (current < firstValue) trend = 'down';

        summary[sprintId] = {
            current: Math.round(current * 10) / 10,
            first: Math.round(firstValue * 10) / 10,
            trend,
            snapshot_count: sorted.length,
            latest_at: latest?.createdAt || null,
        };
    });

    return summary;
}

export function buildRegressionReport(stories, snapshots = []) {
    const storyMap = new Map(stories.map((story) => [String(story._id), story]));
    const byStory = new Map();

    snapshots.forEach((snapshot) => {
        if (!snapshot.story_id) return;
        const key = String(snapshot.story_id);
        const list = byStory.get(key) || [];
        list.push(snapshot);
        byStory.set(key, list);
    });

    const regressions = [];

    byStory.forEach((list, storyId) => {
        const sorted = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (sorted.length < 2) return;

        const current = sorted[0];
        const previous = sorted[1];
        const droppedFiles = detectFileRegressions(previous, current);
        const previousCoverage = Number(previous.coverage_percent ?? 0);
        const currentCoverage = Number(current.coverage_percent ?? 0);
        const story = storyMap.get(storyId);

        if (currentCoverage < previousCoverage || droppedFiles.length > 0) {
            regressions.push({
                story_id: storyId,
                story_title: story?.title || 'Untitled story',
                branch: current.branch,
                previous_coverage_percent: Math.round(previousCoverage * 10) / 10,
                current_coverage_percent: Math.round(currentCoverage * 10) / 10,
                dropped_files: droppedFiles,
            });
        }
    });

    return regressions.sort((a, b) => a.story_title.localeCompare(b.story_title));
}
