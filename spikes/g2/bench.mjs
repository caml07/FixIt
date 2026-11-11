// G2 synthetic-fixture workload against REAL databases, broker and Express processes.
// All users, accounts and messages are disposable. Do not mistake this for production E2E.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const base = process.env.G2_BASE_URL;
const prefix = process.env.G2_PREFIX;
const mode = process.env.G2_MODE;
const pass = process.env.G2_FIXTURE_PASSWORD;
const profile = process.env.G2_PROFILE || 'legacy';
const bcryptEngine = process.env.G2_BCRYPT_ENGINE || 'bcryptjs';
const bcryptCost = Number(process.env.G2_BCRYPT_COST || '9');
if (!base || !prefix || !mode || !pass) throw new Error('G2 benchmark environment missing');

const latencies = {};
const checks = [];
const startAt = performance.now();
function timing(key, ms) { (latencies[key] ??= []).push(ms); }
function percentile(values, q) {
  const arr = [...values].sort((a, b) => a - b);
  return Math.round(arr[Math.ceil(q * arr.length) - 1] * 10) / 10;
}
async function request(method, path, actor, body, label = method) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  const elapsed = performance.now() - started;
  timing(label, elapsed);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], elapsed };
}
function ok(result, expected = 200, context = '') {
  assert.equal(result.status, expected, `${context} expected ${expected}, got ${result.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, timeoutMs = 13000) {
  const until = performance.now() + timeoutMs;
  let latest;
  while (performance.now() < until) {
    try { latest = await fn(); if (latest) return latest; } catch {}
    await sleep(350);
  }
  throw new Error('eventually timed out; last state=' + JSON.stringify(latest));
}
function podman(...args) {
  return execFileSync('podman', args, { encoding: 'utf-8', timeout: 25000 }).trim();
}
function serviceName(area) {
  return prefix + '-' + (mode === 'two' && (area === 'auth' || area === 'tickets') ? 'core' : area);
}
function metrics(area) {
  const path = area === 'tickets' ? '/internal/tickets/metrics' : '/internal/chat/metrics';
  const source = `fetch('http://127.0.0.1:3000${path}',{headers:{'x-g2-service-token':process.env.G2_INTERNAL_SECRET}}).then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))`;
  return JSON.parse(podman('exec', serviceName(area), 'node', '-e', source));
}
function check(name) { checks.push(name); }

const people = [
  { id: 'admin', role: 'ADMIN' },
  { id: 'agent0', role: 'AGENT' },
  { id: 'agent1', role: 'AGENT' },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `reporter${i}`, role: 'REPORTER' })),
];

try {
  // Ten independent authenticated users, including real bcrypt verification.
  await Promise.all(people.map(async person => {
    const r = await request('POST', '/api/auth/login', null,
      { email: `${person.id}@g2.invalid`, password: pass }, 'login_burst_10');
    const data = ok(r, 200, 'login ' + person.id);
    assert.equal(data.user.role, person.role);
    assert.ok(r.cookie?.startsWith('fixit_g2_sid='));
    person.cookie = r.cookie;
  }));
  check('10 sessions / bcrypt logins');

  // Warm, non-overlapping logins approximate a single person's experience.
  // Keep these separate from the 10 concurrent requests.
  for (let i = 0; i < 3; i++) {
    const r = await request('POST', '/api/auth/login', null,
      { email: 'admin@g2.invalid', password: pass }, 'login_single');
    ok(r, 200, 'sequential login');
  }
  check('3 sequential warm login measurements');

  // Test admin-only creation and forced first-password change.
  const invalidAdmin = await request('POST', '/api/admin/users', people[3], {
    email: 'attacker@g2.invalid', role: 'REPORTER',
  });
  ok(invalidAdmin, 403, 'admin-only');
  const created = await request('POST', '/api/admin/users', people[0], {
    email: 'newuser@g2.invalid', role: 'REPORTER',
  });
  const newAccount = ok(created, 201, 'admin create');
  assert.ok(newAccount.temporaryPassword.length >= 20);
  const provisional = await request('POST', '/api/auth/login', null, {
    email: 'newuser@g2.invalid', password: newAccount.temporaryPassword,
  }, 'login_followup');
  assert.equal(ok(provisional).mustChangePassword, true);
  ok(await request('POST', '/api/tickets', { cookie: provisional.cookie },
    { title: 'should be denied' }), 401, 'provisional denied');
  const activatedPassword = randomBytes(24).toString('base64url');
  ok(await request('POST', '/api/auth/activate', { cookie: provisional.cookie },
    { currentPassword: newAccount.temporaryPassword, newPassword: activatedPassword }), 204, 'activate');
  const full = await request('POST', '/api/auth/login', null, {
    email: 'newuser@g2.invalid', password: activatedPassword,
  }, 'login_followup');
  assert.equal(ok(full).mustChangePassword, false);
  check('Admin-only account / temporary password rotation');

  const reporters = people.slice(3);
  const agents = people.slice(1, 3);
  const admin = people[0];
  const ticketRows = await Promise.all(reporters.map(async (user, i) => {
    const r = await request('POST', '/api/tickets', user, {
      title: `Synthetic benchmark incident ${i}`,
    }, 'create_ticket');
    return { ticket: ok(r, 201, 'create ticket').ticket, owner: user };
  }));
  check('7 real ticket transactions with outbox');

  const first = ticketRows[0].ticket.id;
  const claims = await Promise.all(agents.map(actor =>
    request('POST', `/api/tickets/${first}/claim`, actor, {}, 'claim')));
  assert.deepEqual(claims.map(c => c.status).sort(), [200, 409]);
  const winner = agents[claims[0].status === 200 ? 0 : 1];
  const other = agents[claims[0].status === 200 ? 1 : 0];
  await Promise.all(ticketRows.slice(1).map(async row => {
    ok(await request('POST', `/api/tickets/${row.ticket.id}/claim`, winner, {}, 'claim'));
  }));
  check('Concurrent claim has exactly one winner and one 409');

  ok(await request('GET', `/api/tickets/${first}`, people[4]), 404, 'foreign ticket denied');
  ok(await request('GET', `/api/chat/${first}/messages`, people[4]), 403, 'foreign chat denied');
  check('Ticket ownership and chat deny third-party');

  const stored = await Promise.all(ticketRows.flatMap(({ ticket, owner }, i) =>
    Array.from({ length: 3 }, (_, j) => request('POST', `/api/chat/${ticket.id}/messages`,
      j === 0 ? winner : owner,
      { body: `Benchmark ${i}-${j}`, clientMessageId: randomUUID() }, 'chat_send'))));
  for (const s of stored) ok(s, 201, 'persist message');
  const history = await Promise.all(ticketRows.map(({ ticket, owner }) =>
    request('GET', `/api/chat/${ticket.id}/messages`, owner, undefined, 'chat_history')));
  history.forEach(row => assert.equal(ok(row).messages.length, 3));
  check('MongoDB persisted 21 messages; authorized history recovery');

  const dupeId = randomUUID();
  const repeat = await Promise.all([0, 1].map(() => request('POST', `/api/chat/${first}/messages`,
    reporters[0], { body: 'Replay test', clientMessageId: dupeId }, 'chat_send')));
  assert.equal(ok(repeat[0], 201).message._id, ok(repeat[1], 201).message._id);
  check('Duplicate clientMessageId persisted once');

  const socket = io(base, {
    transports: ['websocket'],
    extraHeaders: { cookie: reporters[0].cookie },
    timeout: 6000,
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 7000).unref();
  });
  assert.equal((await socket.timeout(5500).emitWithAck('ticket:join', first)).ok, true);
  const socketAck = await socket.timeout(5500).emitWithAck('chat:send', {
    ticketId: first, body: 'WebSocket transport persisted', clientMessageId: randomUUID(),
  });
  assert.equal(socketAck.ok, true);
  socket.disconnect();
  check('Socket.io handshake, join, ACK after Mongo insert');

  // Same ten authenticated users send concurrent traffic.
  await Promise.all(Array.from({ length: 6 }, () =>
    Promise.all(people.map(person =>
      request('GET', '/api/auth/me', person, undefined, '10_users_get_me')
        .then(r => ok(r, 200, '10-user request'))))));
  check('60 overlapping authenticated HTTP reads by 10 users');

  ok(await request('PATCH', `/api/tickets/${first}/assignee`, admin,
    { assigneeId: other.id }, 'reassignment'));
  ok(await request('POST', `/api/chat/${first}/messages`, winner,
    { body: 'not authorized after reassign', clientMessageId: randomUUID() }), 403);
  ok(await request('GET', `/api/chat/${first}/messages`, other), 200);
  check('Reassignment blocks former agent and allows new agent');

  const before = await eventually(() => {
    const t = metrics('tickets');
    const c = metrics('chat');
    return t.pending === 0 && c.events === t.events ? { ticket: t, chat: c } : null;
  }, 18000);
  check('Outbox drained and JetStream durable consumer caught up');

  // Stop only the named Chat container, create an event while it is offline,
  // and restart the same container. MongoDB and NATS remain available.
  podman('stop', '-t', '2', serviceName('chat'));
  const whileChatDown = await request('POST', '/api/tickets', reporters[0],
    { title: 'Incident created with Chat offline' }, 'create_ticket');
  ok(whileChatDown, 201, 'tickets independent of Chat');
  await eventually(() => metrics('tickets').pending === 0);
  podman('start', serviceName('chat'));
  await eventually(() => {
    try { return metrics('chat').events >= before.chat.events + 1; }
    catch { return false; }
  }, 20000);
  const recovered = await request('GET', `/api/chat/${ticketRows[1].ticket.id}/messages`,
    reporters[1], undefined, 'chat_history');
  assert.equal(ok(recovered).messages.length, 3);
  check('JetStream catch-up after Chat container restart; Mongo history survives');

  const ticketMetrics = metrics('tickets');
  const chatMetrics = metrics('chat');
  assert.equal(ticketMetrics.pending, 0);
  assert.equal(ticketMetrics.events, chatMetrics.events);
  assert.ok(chatMetrics.messages >= 23);
  check('Event counts reconcile; no pending outbox');

  const summary = Object.fromEntries(Object.entries(latencies).map(([key, values]) => [
    key, { count: values.length, p50_ms: percentile(values, 0.50), p95_ms: percentile(values, 0.95),
      max_ms: Math.round(Math.max(...values) * 10) / 10 },
  ]));
  const output = {
    mode, profile, bcryptEngine, bcryptCost,
    status: 'PASS_SPIKE', timestamp: new Date().toISOString(),
    total_seconds: Math.round((performance.now() - startAt) / 100) / 10,
    concurrent_actors: 10, checks, request_latency: summary,
    ticket_metrics: ticketMetrics, chat_metrics: chatMetrics,
    limitations: [
      'Fixture-only security: HTTP loopback, shared synthetic credentials, bcrypt cost 9, no CSRF/TLS',
      'Socket.io is exercised but ten concurrent browser sockets are not',
      'No deployment to EC2 and no AWS price/elegibility validation',
      'Real infrastructure and service routes; partial domain workload, not finished FixIt',
      'Reassignment in-flight serialization and backup/restore are not proven',
    ],
  };
  console.log('G2_RESULT_JSON=' + JSON.stringify(output));
} catch (err) {
  console.error('G2_BENCH_FAILED', err.stack || err.message);
  process.exitCode = 1;
}
