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

test('flight check dispatches the serialized workflow without calling the build directly', async (t) => {
    process.env.UPDATE_TOKEN = 'update-secret';
    process.env.GITHUB_TOKEN = 'github-secret';
    process.env.GITHUB_REPO = 'example/repo';
    process.env.GITHUB_BRANCH = 'main';

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).startsWith('https://api.weglide.org/')) {
            return new Response(JSON.stringify([{ id: 200 }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (String(url).includes('canadian_flights_update_state.json')) {
            return new Response(JSON.stringify({ latestFlightId: 100 }), { status: 200 });
        }
        if (String(url).includes('/actions/workflows/update-on-flight.yml/dispatches')) {
            return new Response(null, { status: 204 });
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
    assert.equal(response.body.buildTriggered, true);
    assert.equal(response.body.trigger, 'github_workflow');
    assert.equal(calls.length, 3);
    assert.equal(calls.some(call => call.url.includes('/api/fetch-and-build')), false);
    assert.equal(calls[2].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[2].options.body), { ref: 'main' });
});

test('flight check does not dispatch when the latest flight is already processed', async (t) => {
    process.env.GITHUB_TOKEN = 'github-secret';
    process.env.GITHUB_REPO = 'example/repo';
    process.env.GITHUB_BRANCH = 'main';

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).startsWith('https://api.weglide.org/')) {
            return new Response(JSON.stringify([{ id: 200 }]), { status: 200 });
        }
        if (String(url).includes('canadian_flights_update_state.json')) {
            return new Response(JSON.stringify({ latestFlightId: 200 }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const handler = loadCheckFlights();
    const response = makeResponse();
    await handler({ method: 'GET', headers: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, 'no_changes');
    assert.equal(response.body.buildTriggered, false);
    assert.equal(calls.length, 2);
});

test('authenticated trigger forwards newOnly mode to the update pipeline', async (t) => {
    process.env.UPDATE_TOKEN = 'update-secret';

    const fetchAndBuildPath = require.resolve('../api/fetch-and-build');
    const triggerPath = require.resolve('../api/trigger-update');
    const originalFetchAndBuildModule = require.cache[fetchAndBuildPath];
    const originalTriggerModule = require.cache[triggerPath];
    let receivedOptions = null;

    require.cache[fetchAndBuildPath] = {
        id: fetchAndBuildPath,
        filename: fetchAndBuildPath,
        loaded: true,
        exports: {
            runFetchAndBuild: async (options) => {
                receivedOptions = options;
                return { status: 'no_changes' };
            }
        }
    };
    delete require.cache[triggerPath];
    t.after(() => {
        if (originalFetchAndBuildModule) {
            require.cache[fetchAndBuildPath] = originalFetchAndBuildModule;
        } else {
            delete require.cache[fetchAndBuildPath];
        }
        if (originalTriggerModule) {
            require.cache[triggerPath] = originalTriggerModule;
        } else {
            delete require.cache[triggerPath];
        }
    });

    const handler = require(triggerPath);
    const response = makeResponse();
    await handler({
        method: 'POST',
        headers: { 'x-update-token': 'update-secret' },
        query: { newOnly: 'true', source: 'new-flight' }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(receivedOptions.newOnly, true);
    assert.equal(receivedOptions.trigger, 'new-flight');
});
