// G3 executable negative tests over the public REST and Socket.IO seams.
// Synthetic accounts / disposable services only; NOT a full security audit.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const base = process.env.G2_BASE_URL;
const password = process.env.G2_FIXTURE_PASSWORD;
if (!base || !password) throw new Error('G3 fixture configuration missing');
const activeSockets = [];
const checks = [];
const start = performance.now();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function http(method, path, actor, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
function expectCode(result, status, context) {
  assert.equal(result.status, status, `${context}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
async function login(id) {
  const result = await http('POST', '/api/auth/login', null,
    { email: `${id}@g2.invalid`, password });
  expectCode(result, 200, 'login ' + id);
  return { id, cookie: result.cookie };
}
async function connectSocket(actor, ticketId, allowed) {
  const s = io(base, {
    transports: ['websocket'], extraHeaders: { cookie: actor.cookie },
    reconnection: false, timeout: 6500,
  });
  activeSockets.push(s);
  await Promise.race([
    new Promise((resolve, reject) => {
      s.once('connect', resolve);
      s.once('connect_error', reject);
    }),
    sleep(7500).then(() => { throw new Error('Socket connection timed out'); }),
  ]);
  const reply = await s.timeout(6000).emitWithAck('ticket:join', ticketId);
  assert.equal(reply.ok, allowed, 'join policy ' + actor.id);
  return s;
}
async function send(s, ticketId, body) {
  return s.timeout(7000).emitWithAck('chat:send', {
    ticketId, clientMessageId: randomUUID(), body,
  });
}

try {
  const [admin, reporter, outsider, agent0, agent1] = await Promise.all(
    ['admin', 'reporter0', 'reporter1', 'agent0', 'agent1'].map(login),
  );
  checks.push('Five authenticated fixture principals');

  const newTicket = await http('POST', '/api/tickets', reporter,
    { title: 'G3 session revocation ticket' });
  const ticketId = expectCode(newTicket, 201, 'create ticket').ticket.id;
  expectCode(await http('POST', `/api/tickets/${ticketId}/claim`, agent0, {}), 200, 'agent claim');

  const reporterSocket = await connectSocket(reporter, ticketId, true);
  const agentSocket = await connectSocket(agent0, ticketId, true);
  const strangerSocket = await connectSocket(outsider, ticketId, false);
  const agent1Socket = await connectSocket(agent1, ticketId, false);
  checks.push('Ticket subscription rejects unrelated principals');

  const deliveredTo = { reporter: [], agent: [], stranger: [], agent1: [] };
  reporterSocket.on('chat:message', msg => deliveredTo.reporter.push(msg));
  agentSocket.on('chat:message', msg => deliveredTo.agent.push(msg));
  strangerSocket.on('chat:message', msg => deliveredTo.stranger.push(msg));
  agent1Socket.on('chat:message', msg => deliveredTo.agent1.push(msg));

  assert.equal((await send(agentSocket, ticketId, 'Before revocation')).ok, true);
  await sleep(350);
  assert.equal(deliveredTo.reporter.length, 1, 'active reporter should receive message');
  assert.equal(deliveredTo.stranger.length, 0, 'stranger must never receive message');
  checks.push('Authorized broadcast reaches reporter but not third party');

  // Revocation is observable via public HTTP, not by direct SQL mutations.
  const logout = await http('POST', '/api/auth/logout', reporter, {});
  expectCode(logout, 204, 'public logout');
  expectCode(await http('GET', '/api/auth/me', reporter), 401, 'revoked session');
  expectCode(await http('GET', `/api/chat/${ticketId}/messages`, reporter), 401,
    'revoked reporter cannot read');
  const deniedSend = await send(reporterSocket, ticketId, 'After revocation');
  assert.equal(deniedSend.ok, false, 'revoked socket must not write');
  checks.push('Logout revokes REST and socket write permissions');

  // This is the regression: the now-invalid websocket must NOT receive.
  assert.equal((await send(agentSocket, ticketId, 'Message after logout')).ok, true);
  await sleep(700);
  assert.equal(deliveredTo.reporter.length, 1,
    'SECURITY FAILURE: revoked socket still receives confidential ticket messages');
  assert.equal(deliveredTo.stranger.length, 0);
  checks.push('Revoked socket does not receive subsequent broadcasts');

  expectCode(await http('PATCH', `/api/tickets/${ticketId}/assignee`, admin,
    { assigneeId: 'agent1' }), 200, 'reassignment');
  assert.equal((await agent1Socket.timeout(6000).emitWithAck('ticket:join', ticketId)).ok, true);
  assert.equal((await send(agentSocket, ticketId, 'Former agent')).ok, false,
    'reassigned agent must be denied');
  const oldAgentMessages = deliveredTo.agent.length;
  assert.equal((await send(agent1Socket, ticketId, 'New agent')).ok, true);
  await sleep(500);
  assert.equal(deliveredTo.agent.length, oldAgentMessages, 'former agent received message');
  assert.equal(deliveredTo.agent1.at(-1)?.body, 'New agent');
  checks.push('Reassignment denies old agent write and excludes from new broadcasts');

  expectCode(await http('GET', `/api/chat/${ticketId}/messages`, agent0), 403,
    'old agent denied history');
  const history = expectCode(await http('GET', `/api/chat/${ticketId}/messages`, agent1), 200,
    'new agent history');
  assert.equal(history.messages.length, 3, 'Messages retained across revocation/reassignment');
  checks.push('History remains available to new assignee, never old agent');

  console.log('G2_RESULT_JSON=' + JSON.stringify({
    status: 'PASS_G3_SPIKE',
    seconds: Math.round((performance.now() - start) / 100) / 10,
    checks, runtime: process.env.G2_MODE, architecture: 'G3 negative session + reassignment',
    limitations: ['Disposable loopback HTTP spike, not the production FixIt implementation',
      'No CSRF, TLS, origin allowlist, browser cookie policy, or real RBAC admin roles lifecycle tested',
      'Does not prove linearizable in-flight reassignment race or JetStream redelivery attack tests'],
  }));
} catch (error) {
  console.error('G3_TEST_FAILED', error.stack || error.message);
  process.exitCode = 1;
} finally {
  for (const s of activeSockets) s.disconnect();
}
