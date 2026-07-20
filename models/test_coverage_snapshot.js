import Waterline from 'waterline';

const TestCoverageSnapshot = Waterline.Collection.extend({
    identity: 'test_coverage_snapshot',
    datastore: 'default',
    primaryKey: '_id',

    attributes: {
        _id: { type: 'string', columnName: '_id', autoMigrations: { autoIncrement: false } },
        board_id: { type: 'string', required: true },
        workspace_id: { type: 'string' },
        sprint_id: { type: 'string' },
        story_id: { type: 'string' },
        branch: { type: 'string', required: true },
        commit_sha: { type: 'string' },
        coverage_percent: { type: 'number', required: true },
        lines_covered: { type: 'number' },
        lines_total: { type: 'number' },
        file_coverage: { type: 'json', defaultsTo: {} },
        createdAt: { type: 'ref', autoCreatedAt: true },
        updatedAt: { type: 'ref', autoUpdatedAt: true },
    },
});

export default TestCoverageSnapshot;
