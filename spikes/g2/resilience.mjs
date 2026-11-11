// G2 resilience/soak suite: synthetic accounts, real storage + event broker.
// This is an experimental benchmark only, never the shipping FixIt API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const base = process.env.G2_BASE_URL;
const prefix = process.env.G2_PREFIX;
const mode = process.env.G2_MODE;
const fixturePassword = process.env.G2_FIXTURE_PASSWORD;
const seconds = Number(process.env.G2_SOAK_SECONDS || 25);
if (!base || !prefix || !mode || !fixturePassword
    || !Number.isInteger(seconds) || seconds < 10 || seconds > 90) {
  throw new Error('Invalid G2 resilience configuration');
}

const sockets = [];
const checks = [];
const samples = { socket_send_ms: [], http_read_ms: [], socket_connect_ms: [] };
const start = performance.now();
const pause = ms => new Promise(r => setTimeout(r, ms));
const serviceName = area => prefix + '-'
  + (mode === 'two' && ['auth', 'tickets'].includes(area) ? 'core' : area);
const podman = (...args) => execFileSync('podman', args,
  { encoding: 'utf8', timeout: 18000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function quantile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return null;
  return Number(ordered[Math.ceil(ordered.length * fraction) - 1].toFixed(1));
}
function metrics(name) {
  const path = name === 'tickets' ? 'tickets/metrics' : 'chat/metrics';
  const js = `fetch('http://127.0.0.1:3000/internal/${path}',{headers:{'x-g2-service-token':process.env.G2_INTERNAL_SECRET}}).then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))`;
  return JSON.parse(podman('exec', serviceName(name), 'node', '-e', js));
}
async function waitFor(test, ms = 18000) {
  const deadline = performance.now() + ms;
  let last;
  while (performance.now() < deadline) {
    try {
      last = await test();
      if (last) return last;
    } catch {}
    await pause(350);
  }
  throw new Error(`Timeout in recovery wait: ${JSON.stringify(last)}`);
}
async function request(method, path, actor, data) {
  const t = performance.now();
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(data === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(7500),
  });
  const ms = performance.now() - t;
  const body = await response.json().catch(() => null);
  return {
    status: response.status, body, ms,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
function expectStatus(r, expected, context) {
  assert.equal(r.status, expected,
    `${context}: expected ${expected}, got ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function socketFor(person, ticketId) {
  const started = performance.now();
  const sock = io(base, {
    transports: ['websocket'], extraHeaders: { cookie: person.cookie },
    timeout: 7500, reconnection: false,
  });
  sockets.push(sock);
  await Promise.race([
    new Promise((resolve, reject) => {
      sock.once('connect', resolve);
      sock.once('connect_error', reject);
    }),
    pause(8000).then(() => { throw new Error('socket connect timeout'); }),
  ]);
  samples.socket_connect_ms.push(performance.now() - started);
  const joined = await sock.timeout(7500).emitWithAck('ticket:join', ticketId);
  assert.equal(joined.ok, true);
  return { person, socket: sock, ticketId };
}
async function send(sock, ticketId, number) {
  const begin = performance.now();
  const response = await sock.timeout(7500).emitWithAck('chat:send', {
    ticketId, body: `G2 soak ${number} ${randomUUID()}`,
    clientMessageId: randomUUID(),
  });
  const elapsed = performance.now() - begin;
  samples.socket_send_ms.push(elapsed);
  return response;
}

try {
  const people = [
    { id: 'admin', role: 'ADMIN' }, { id: 'agent0', role: 'AGENT' },
    { id: 'agent1', role: 'AGENT' },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `reporter${i}`, role: 'REPORTER' })),
  ];
  await Promise.all(people.map(async user => {
    const r = await request('POST', '/api/auth/login', null,
      { email: `${user.id}@g2.invalid`, password: fixturePassword });
    const data = expectStatus(r, 200, 'fixture login');
    assert.equal(data.user.role, user.role);
    assert.ok(r.cookie?.startsWith('fixit_g2_sid='));
    user.cookie = r.cookie;
  }));
  checks.push('Ten real bcrypt logins');

  const tickets = await Promise.all(people.slice(3).map(async (user, i) => {
    const r = await request('POST', '/api/tickets', user,
      { title: `Synthetic soak ticket ${i}` });
    return { id: expectStatus(r, 201, 'ticket fixture').ticket.id, owner: user };
  }));
  await Promise.all(tickets.map(async (ticket, i) => {
    const agent = people[i === 6 ? 2 : 1];
    expectStatus(await request('POST', `/api/tickets/${ticket.id}/claim`,
      agent, {}), 200, 'fixture claim');
  }));
  checks.push('Seven tickets and assigned agents');

  const connectionSpecs = [
    { person: people[0], ticketId: tickets[0].id },
    { person: people[1], ticketId: tickets[0].id },
    { person: people[2], ticketId: tickets[6].id },
    ...tickets.map(ticket => ({ person: ticket.owner, ticketId: ticket.id })),
  ];
  const connections = await Promise.all(connectionSpecs.map(({person, ticketId}) =>
    socketFor(person, ticketId)));
  assert.equal(connections.length, 10);
  assert.equal(connections.filter(c => c.socket.connected).length, 10);
  checks.push('Ten simultaneous authenticated WebSocket connections and authorized joins');

  // One concurrent message per user per second for a bounded window.
  let sent = 0;
  let failures = 0;
  const startedAt = performance.now();
  let rounds = 0;
  for (let i = 0; i < seconds; i++) {
    const tick = startedAt + i * 1000;
    if (performance.now() - tick > 1500) {
      // Overloaded service: skip rather than silently converting to an unbounded burst.
      continue;
    }
    const results = await Promise.allSettled(connections.map(({socket, ticketId}, ix) =>
      send(socket, ticketId, `${i}-${ix}`)));
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) sent++;
      else failures++;
    }
    rounds++;
    await pause(Math.max(0, tick + 1000 - performance.now()));
  }
  const elapsed = (performance.now() - startedAt) / 1000;
  assert.equal(failures, 0, `Socket ACK failures during soak: ${failures}`);
  assert.ok(sent >= 10 * Math.max(10, Math.floor(seconds * 0.6)),
    `Throughput collapsed: ${sent} successful sends over ${elapsed}s`);
  const chatBeforeFaults = metrics('chat');
  assert.equal(chatBeforeFaults.messages, sent,
    'Every successful Socket ACK must correspond to a persisted message');
  // Freeze the workload cohort: later failure-injection requests must not
  // inflate normal-operation p95/p99 latency or throughput metrics.
  const soakSendDurations = [...samples.socket_send_ms];
  const sendsDuringSoak = sent;
  checks.push(`Sustained ${seconds}s: ${sent} socket ACKs and ${chatBeforeFaults.messages} Mongo messages`);

  // Confirm access through public HTTP, not internal database shortcuts.
  await Promise.all(tickets.map(async ticket => {
    const r = await request('GET', `/api/chat/${ticket.id}/messages`, ticket.owner);
    expectStatus(r, 200, 'history after soak');
    assert.ok(r.body.messages.length > 0);
    samples.http_read_ms.push(r.ms);
  }));
  checks.push('Authorized Mongo history after sustained load');

  // A disconnected Auth must not allow new writes via an existing Socket.
  const validClient = connections[3]; // reporter0; existing joined socket.
  if (mode === 'three') {
    podman('stop', '-t', '1', serviceName('auth'));
    const denied = await send(validClient.socket, validClient.ticketId, 'auth-down');
    assert.equal(denied.ok, false, 'Fail-closed under Auth outage');
    podman('start', serviceName('auth'));
    await waitFor(async () => {
      const r = await request('GET', '/api/auth/me', validClient.person);
      return r.status === 200;
    });
    assert.equal((await send(validClient.socket, validClient.ticketId, 'auth-restored')).ok, true);
    sent++;
    checks.push('Auth outage denies send; restored Auth allows send');
  }

  // Tickets outage also prevents writes, even with a previously joined room.
  podman('stop', '-t', '1', serviceName('tickets'));
  const deniedTicket = await send(validClient.socket, validClient.ticketId, 'tickets-down');
  assert.equal(deniedTicket.ok, false);
  podman('start', serviceName('tickets'));
  await waitFor(async () => {
    try { return (await send(validClient.socket, validClient.ticketId, 'tickets-restored')).ok; }
    catch { return false; }
  });
  sent++;
  checks.push('Tickets outage denies send; restoring Tickets restores permission checks');

  // Storage failures differ from API failures. No ACK while Mongo is down,
  // and the previously persisted history should survive a container restart.
  podman('stop', '-t', '1', serviceName('mongo'));
  const deniedMongo = await send(validClient.socket, validClient.ticketId, 'mongo-down');
  assert.equal(deniedMongo.ok, false, 'Mongo outage must not return a successful ACK');
  podman('start', serviceName('mongo'));
  await waitFor(async () => {
    const r = await request('GET', `/api/chat/${validClient.ticketId}/messages`, validClient.person);
    return r.status === 200 && r.body.messages?.length > 0;
  }, 20000);
  assert.equal((await send(validClient.socket, validClient.ticketId, 'mongo-restored')).ok, true);
  sent++;
  checks.push('Mongo outage denies ACK; previous messages survive storage restart');

  // Loss of PostgreSQL must deny authentication/permission checks rather than
  // guessing from stale room membership. The test preserves the PG container.
  podman('stop', '-t', '1', serviceName('pg'));
  const deniedPostgres = await send(validClient.socket, validClient.ticketId, 'pg-down');
  assert.equal(deniedPostgres.ok, false, 'PG outage must fail closed');
  podman('start', serviceName('pg'));
  await waitFor(async () => {
    const r = await request('GET', '/api/auth/me', validClient.person);
    return r.status === 200;
  }, 20000);
  assert.equal((await send(validClient.socket, validClient.ticketId, 'pg-restored')).ok, true);
  sent++;
  checks.push('PostgreSQL outage denies send; sessions and tickets survive storage restart');

  // JetStream outage: Tickets commit/outbox remains authoritative.
  const originalEvents = metrics('tickets').events;
  podman('stop', '-t', '1', serviceName('nats'));
  const createdOffline = await request('POST', '/api/tickets', people[3],
    { title: 'Ticket during NATS outage' });
  expectStatus(createdOffline, 201, 'NATS outage should not block ticket transaction');
  await waitFor(() => metrics('tickets').pending >= 1, 6500);
  podman('start', serviceName('nats'));
  await waitFor(() => {
    const t = metrics('tickets');
    const c = metrics('chat');
    return t.pending === 0 && c.events === t.events ? { t, c } : null;
  }, 22000);
  assert.equal(metrics('tickets').events, originalEvents + 1);
  checks.push('NATS outage leaves transactional outbox pending; consumer catches up on recovery');

  const finalChat = metrics('chat');
  assert.equal(finalChat.messages, sent);
  checks.push('No phantom ACKs; final Mongo count matches all successful socket sends');

  const finalTickets = metrics('tickets');
  const summary = {
    mode, profile: process.env.G2_PROFILE,
    bcrypt: process.env.G2_BCRYPT_ENGINE,
    cost: Number(process.env.G2_BCRYPT_COST),
    status: 'PASS_RESILIENCE_SPIKE',
    UTC: new Date().toISOString(),
    users: 10, connectedSockets: connections.length,
    durationTargetSeconds: seconds,
    actualSoakSeconds: Number(elapsed.toFixed(1)),
    rounds, successfulSends: sent, soakSuccessfulSends: sendsDuringSoak,
    soakErrors: failures,
    socketSend: { count: soakSendDurations.length,
      p50Ms: quantile(soakSendDurations, 0.5),
      p95Ms: quantile(soakSendDurations, 0.95),
      p99Ms: quantile(soakSendDurations, 0.99) },
    injectedFaultSends: samples.socket_send_ms.length - soakSendDurations.length,
    connect: { count: samples.socket_connect_ms.length,
      p95Ms: quantile(samples.socket_connect_ms, 0.95) },
    reads: { count: samples.http_read_ms.length,
      p95Ms: quantile(samples.http_read_ms, 0.95) },
    checks, ticketMetrics: finalTickets, chatMetrics: finalChat,
    limitations: [
      'Synthetic fixtures, no production FixIt implementation',
      'Only 10 users and a short load window; local laptop physical cores != AWS vCPU',
      'NATS restart is the same container/volume, not a disaster recovery scenario',
      'Socket middleware only authenticates on connection; writes revalidate via Tickets/Auth',
      'No TLS, CSRF, real backups, multi-node/availability zones, or T3 CPU-credit behavior',
    ],
  };
  console.log('G2_RESULT_JSON=' + JSON.stringify(summary));
} catch (err) {
  console.error('G2_RESILIENCE_FAIL', err.stack || err);
  process.exitCode = 1;
} finally {
  for (const sock of sockets) sock.disconnect();
}
