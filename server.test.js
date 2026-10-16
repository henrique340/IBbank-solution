const test = require('node:test');
const assert = require('node:assert/strict');
const { server, validateCpf } = require('./server');

test('CPF verification checks both format and check digits', () => {
  assert.equal(validateCpf('123.456.789-09'), '12345678909');
  assert.equal(validateCpf('111.111.111-11'), null);
  assert.equal(validateCpf('123.456.789-00'), null);
});

test('existing lookup and urgent assistant routes retain their response contract', async () => {
  process.env.ASSISTANT_WEBHOOK_TOKEN = 'test-secret-not-for-deployment';
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const lookup = await fetch(`${origin}/customers/lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cpf: '123.456.789-09' }),
    });
    assert.deepEqual(await lookup.json(), { cpfValid: 'YES', registered: 'YES', name: 'Ana Demo', email: 'ana.demo@example.com' });
    const urgent = await fetch(`${origin}/assistant/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ib-demo-token': process.env.ASSISTANT_WEBHOOK_TOKEN },
      body: JSON.stringify({ question: 'I lost my card' }),
    });
    const answer = await urgent.json();
    assert.equal(answer.handoff, 'YES');
    assert.equal(answer.priority, 'URGENT');
    assert.equal(answer.offerVoice, 'NO');
    const disabled = await fetch(`${origin}/voice/start-conversation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ib-demo-token': process.env.ASSISTANT_WEBHOOK_TOKEN },
      body: JSON.stringify({ to: '5511999999999', consent: 'YES' }),
    });
    assert.equal(disabled.status, 400); // Not allowlisted; cannot dial accidentally.
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('answered test call creates one SIP dialog even if event is repeated', async () => {
  Object.assign(process.env, {
    ASSISTANT_WEBHOOK_TOKEN: 'demo-token', INFOBIP_EVENTS_USERNAME: 'demo-events', INFOBIP_EVENTS_TOKEN: 'callback-token',
    ENABLE_OUTBOUND_CALLS: 'true', INFOBIP_BASE_URL: 'https://example.api.infobip.com',
    INFOBIP_API_KEY: 'fake', INFOBIP_VOICE_FROM: '5511888888888',
    INFOBIP_CALLS_CONFIGURATION_ID: 'bank-ib-demo', INFOBIP_SIP_TRUNK_ID: 'trunk-test',
    OPENAI_PROJECT_ID: 'proj_test', OPENAI_API_KEY: 'fake', OPENAI_WEBHOOK_SECRET: 'fake',
    DEMO_ALLOWED_PHONE: '5511999999999',
  });
  const realFetch = global.fetch;
  const outgoing = [];
  global.fetch = async (url, options) => {
    if (String(url).startsWith(process.env.INFOBIP_BASE_URL)) {
      outgoing.push({ url: String(url), data: JSON.parse(options.body) });
      return new Response(JSON.stringify({ id: outgoing.length === 1 ? 'phone-leg-id' : 'dialog-id' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(url, options);
  };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = await realFetch(`${origin}/voice/start-conversation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ib-demo-token': 'demo-token' },
      body: JSON.stringify({ to: '5511999999999', consent: 'YES', caseSummary: 'Card question' }),
    });
    assert.equal(start.status, 202);
    assert.equal((await start.json()).callId, 'phone-leg-id');
    const event = { type: 'CALL_ESTABLISHED', callId: 'phone-leg-id' };
    const denied = await realFetch(`${origin}/webhooks/infobip/calls`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
    });
    assert.equal(denied.status, 401);
    for (let attempt = 0; attempt < 2; attempt++) {
      const delivered = await realFetch(`${origin}/webhooks/infobip/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from('demo-events:callback-token').toString('base64')}` },
        body: JSON.stringify(event),
      });
      assert.equal(delivered.status, 200);
    }
    assert.equal(outgoing.length, 2);
    assert.equal(outgoing[1].data.childCallRequest.endpoint.sipTrunkId, 'trunk-test');
    assert.equal(outgoing[1].data.childCallRequest.endpoint.username, 'proj_test');
  } finally {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
