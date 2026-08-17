const assert = require('node:assert/strict');
const test = require('node:test');

const { isUpdateAuthorized, secretsMatch } = require('../lib/update-auth');

function loadCheckFlights() {
    const modulePath = require.resolve('../api/check-flights');
    delete require.cache[modulePath];
    return require(modulePath);
}

function makeResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test('authorization fails closed when no secrets are configured', () => {
    delete process.env.UPDATE_TOKEN;
    delete process.env.CRON_SECRET;
    assert.equal(isUpdateAuthorized({ headers: {} }, { allowCronSecret: true }), false);
});

test('authorization accepts update and cron headers without accepting empty values', () => {
    process.env.UPDATE_TOKEN = 'update-secret';
    process.env.CRON_SECRET = 'cron-secret';

    assert.equal(secretsMatch('', ''), false);
    assert.equal(isUpdateAuthorized({ headers: { 'x-update-token': 'update-secret' } }), true);
    assert.equal(isUpdateAuthorized({ headers: { authorization: 'Bearer cron-secret' } }, { allowCronSecret: true }), true);
    assert.equal(isUpdateAuthorized({ headers: { authorization: 'Bearer cron-secret' } }), false);
});

test('flight check reports new data without launching a build', async (t) => {
    process.env.UPDATE_TOKEN = 'update-secret';
    process.env.GITHUB_REPO = 'example/repo';
    process.env.GITHUB_BRANCH = 'main';

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).startsWith('https://api.weglide.org/')) {
            return new Response(JSON.stringify([{ id: 200 }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (String(url).includes('canadian_flights_update_state.json')) {
            return new Response(JSON.stringify({ latestFlightId: 100 }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const handler = loadCheckFlights();
    const response = makeResponse();
    await handler({ method: 'GET', headers: { 'x-update-token': 'update-secret' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, 'new_data_available');
    assert.equal(response.body.buildTriggered, false);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(url => url.includes('/api/fetch-and-build')), false);
});

test('unauthorized flight checks do not call external services', async (t) => {
    process.env.UPDATE_TOKEN = 'update-secret';
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error('fetch should not be called');
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const handler = loadCheckFlights();
    const response = makeResponse();
    await handler({ method: 'GET', headers: {} }, response);

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: 'Unauthorized' });
});
