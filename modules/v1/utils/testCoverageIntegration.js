import crypto from 'crypto';
import bcrypt from 'bcrypt';

const TOKEN_PREFIX = 'tcov_';

export function generateWebhookToken() {
    const random = crypto.randomBytes(24).toString('base64url');
    return `${TOKEN_PREFIX}${random}`;
}

export async function hashWebhookToken(token) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(token, salt);
}

export async function verifyWebhookToken(token, hash) {
    if (!token || !hash) return false;
    return bcrypt.compare(token, hash);
}

export function maskWebhookToken(token = '') {
    const raw = String(token || '');
    if (raw.length <= 8) return raw;
    return `••••${raw.slice(-6)}`;
}

export function getBoardIntegration(board) {
    return board?.saved_view?.scrum?.test_coverage?.integration || {};
}

export function buildWebhookUrl(request) {
    const host = request?.headers?.['x-forwarded-host'] || request?.get?.('host');
    const proto = request?.headers?.['x-forwarded-proto'] || request?.protocol || 'https';
    if (!host) return '/v1/webhook/test-coverage';
    return `${proto}://${host}/v1/webhook/test-coverage`;
}

export function extractWebhookToken(request, body = {}) {
    const authHeader = request?.headers?.authorization || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.slice(7).trim();
    }
    return request?.headers?.['x-test-coverage-token']
        || request?.headers?.['x-coverage-webhook-secret']
        || body?.token
        || body?.secret
        || '';
}

export async function updateBoardIntegration(board, integrationPatch) {
    const savedView = board.saved_view || {};
    const scrum = savedView.scrum || {};
    const testCoverage = scrum.test_coverage || {};

    const nextSavedView = {
        ...savedView,
        scrum: {
            ...scrum,
            test_coverage: {
                ...testCoverage,
                integration: {
                    ...(testCoverage.integration || {}),
                    ...integrationPatch,
                },
            },
        },
    };

    const updated = await global.Board.update({ _id: board._id }, { saved_view: nextSavedView }).fetch();
    return Array.isArray(updated) ? updated[0] : updated;
}

export function serializeIntegrationStatus(board, request) {
    const integration = getBoardIntegration(board);
    return {
        enabled: Boolean(integration.enabled),
        webhook_url: buildWebhookUrl(request),
        token_preview: integration.token_preview || '',
        enabled_at: integration.enabled_at || null,
        last_received_at: integration.last_received_at || null,
    };
}
