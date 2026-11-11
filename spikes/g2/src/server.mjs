// Isolated G2 vertical-slice spike. NOT the FixIt product implementation.
// Intent: measure real Express, bcrypt, PostgreSQL, MongoDB, Socket.IO and JetStream.
// All credentials are synthetic; containers and databases are ephemeral.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import express from 'express';
import bcryptjs from 'bcryptjs';
import nativeBcrypt from 'bcrypt';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { connect, StringCodec, AckPolicy, DeliverPolicy, StorageType } from 'nats';
import { Server as SocketServer } from 'socket.io';

const role = process.env.G2_ROLE || 'auth';
const port = Number(process.env.PORT || 3000);
const secret = process.env.G2_INTERNAL_SECRET;
const password = process.env.G2_FIXTURE_PASSWORD;
const authUrl = process.env.G2_AUTH_URL;
const ticketsUrl = process.env.G2_TICKETS_URL;
const mongoUrl = process.env.G2_MONGO_URL;
const natsUrl = process.env.G2_NATS_URL;
const bcryptEngine = process.env.G2_BCRYPT_ENGINE || 'bcryptjs';
const bcryptCost = Number(process.env.G2_BCRYPT_COST || '9');
if (!['bcryptjs', 'native'].includes(bcryptEngine) ||
    !Number.isInteger(bcryptCost) || bcryptCost < 9 || bcryptCost > 13) {
  throw new Error('Invalid G2 bcrypt benchmark configuration');
}
const bcrypt = bcryptEngine === 'native' ? nativeBcrypt : bcryptjs;
if (!secret || !password) throw new Error('Missing ephemeral G2 environment secrets');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '24kb' }));
const server = createServer(app);
const pool = role === 'auth' || role === 'tickets' || role === 'core'
  ? new pg.Pool({ connectionString: process.env.G2_PG_URL, max: 8 })
  : null;
// An idle PG connection can emit an error while the database is down.
// Keep the spike process alive to measure reconnection, not an uncaught exception.
if (pool) pool.on('error', err => console.error('G2_PG_IDLE_ERROR', err.code || err.message));
const codec = StringCodec();
let nc;
let js;
let mongo;
let io;
let outboxPublished = 0;
let outboxErrors = 0;
let consumed = 0;
let retries = 0;

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function cookieToken(header) {
  const match = (header || '').match(/(?:^|;\s*)fixit_g2_sid=([a-f0-9]{64})/);
  return match?.[1] ?? null;
}
function error(res, code, status = 401) { return res.status(status).json({ error: code }); }
function sessionCookie(token) {
  // Intentionally non-Secure because this benchmark runs only on 127.0.0.1 HTTP.
  return `fixit_g2_sid=${token}; HttpOnly; SameSite=Lax; Path=/`;
}
async function pgTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}
async function callJson(url, token, body = null) {
  const response = await fetch(url, {
    method: body === null ? 'GET' : 'POST',
    headers: {
      'x-g2-service-token': secret,
      ...(token ? { 'x-g2-session': token } : {}),
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2400),
  });
  return { status: response.status, body: await response.json() };
}
async function introspect(token) {
  if (!token) return null;
  if (role === 'core' || role === 'auth') return localIntrospect(token);
  const response = await callJson(`${authUrl}/internal/session`, token);
  return response.status === 200 ? response.body.user : null;
}
async function localIntrospect(token) {
  const q = await pool.query(
    `SELECT u.id,u.email,u.role,u.state,s.kind
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW() AND s.revoked_at IS NULL`,
    [sha256(token)],
  );
  const row = q.rows[0];
  return row && row.state === 'ACTIVE' && row.kind === 'FULL'
    ? { id: row.id, email: row.email, role: row.role } : null;
}
function internalOnly(req, res, next) {
  if (req.get('x-g2-service-token') !== secret) return error(res, 'SERVICE_DENIED', 403);
  next();
}
function bearerCookie(req) { return cookieToken(req.get('cookie')); }
async function requireFull(req, res, next) {
  try {
    const user = await introspect(bearerCookie(req));
    if (!user) return error(res, 'AUTH_REQUIRED');
    req.actor = user;
    next();
  } catch { return error(res, 'DEPENDENCY_DOWN', 503); }
}
function appendTicketEvent(client, ticketId, version, type, actorId) {
  const eventId = randomUUID();
  const data = { eventId, ticketId, aggregateVersion: version, type, occurredAt: new Date().toISOString() };
  return Promise.all([
    client.query('INSERT INTO timeline(id,ticket_id,actor_id,kind,version) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), ticketId, actorId, type, version]),
    client.query('INSERT INTO outbox(event_id,ticket_id,aggregate_version,body) VALUES ($1,$2,$3,$4)',
      [eventId, ticketId, version, JSON.stringify(data)]),
  ]);
}

async function setupAuth() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
    state TEXT NOT NULL, password_hash TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    kind TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ)`);
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (count.rows[0].count === 0) {
    const hashed = await bcrypt.hash(password, bcryptCost);
    const users = [
      { id: 'admin', email: 'admin@g2.invalid', role: 'ADMIN' },
      { id: 'agent0', email: 'agent0@g2.invalid', role: 'AGENT' },
      { id: 'agent1', email: 'agent1@g2.invalid', role: 'AGENT' },
      ...Array.from({ length: 7 }, (_, i) => ({ id: `reporter${i}`, email: `reporter${i}@g2.invalid`, role: 'REPORTER' })),
    ];
    for (const u of users) {
      await pool.query('INSERT INTO users(id,email,role,state,password_hash) VALUES ($1,$2,$3,$4,$5)',
        [u.id, u.email, u.role, 'ACTIVE', hashed]);
    }
  }

  app.post('/api/auth/login', async (req, res) => {
    const { email, password: supplied } = req.body || {};
    if (typeof email !== 'string' || typeof supplied !== 'string') return error(res, 'INVALID_INPUT', 422);
    const q = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = q.rows[0];
    if (!user || !await bcrypt.compare(supplied, user.password_hash)) return error(res, 'INVALID_LOGIN');
    const token = randomBytes(32).toString('hex');
    const kind = user.state === 'PENDING_PASSWORD_CHANGE' ? 'TEMP' : 'FULL';
    await pool.query(`INSERT INTO sessions(token_hash,user_id,kind,expires_at)
      VALUES ($1,$2,$3,NOW()+INTERVAL '60 minutes')`, [sha256(token), user.id, kind]);
    res.set('set-cookie', sessionCookie(token));
    return res.json({ user: { id: user.id, role: user.role }, mustChangePassword: kind === 'TEMP' });
  });
  app.get('/api/auth/me', async (req, res) => {
    const token = bearerCookie(req);
    if (!token) return error(res, 'AUTH_REQUIRED');
    const q = await pool.query(
      `SELECT u.id,u.role,u.state FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW()`, [sha256(token)]);
    const user = q.rows[0];
    return user ? res.json({ user, mustChangePassword: user.state === 'PENDING_PASSWORD_CHANGE' })
      : error(res, 'AUTH_REQUIRED');
  });
  // G3 fixture: public logout revokes the opaque token, including an
  // already-connected socket that still holds the now-revoked cookie.
  app.post('/api/auth/logout', async (req, res) => {
    const token = bearerCookie(req);
    if (token) {
      await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL',
        [sha256(token)]);
    }
    res.set('set-cookie', 'fixit_g2_sid=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/');
    return res.status(204).end();
  });
  app.post('/api/auth/activate', async (req, res) => {
    const token = bearerCookie(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!token || typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12)
      return error(res, 'INVALID_ACTIVATION', 422);
    const q = await pool.query(
      `SELECT u.id,u.password_hash FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.kind='TEMP' AND s.expires_at>NOW() AND s.revoked_at IS NULL`,
      [sha256(token)]);
    const row = q.rows[0];
    if (!row || !await bcrypt.compare(currentPassword, row.password_hash))
      return error(res, 'INVALID_ACTIVATION', 403);
    const hashed = await bcrypt.hash(newPassword, bcryptCost);
    await pgTransaction(async tx => {
      await tx.query("UPDATE users SET state='ACTIVE',password_hash=$1 WHERE id=$2", [hashed, row.id]);
      await tx.query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [row.id]);
    });
    res.set('set-cookie', sessionCookie(''));
    return res.status(204).end();
  });
  app.post('/api/admin/users', requireFull, async (req, res) => {
    if (req.actor.role !== 'ADMIN') return error(res, 'FORBIDDEN', 403);
    const { email, role: newRole } = req.body || {};
    if (typeof email !== 'string' || !['REPORTER', 'AGENT'].includes(newRole))
      return error(res, 'INVALID_INPUT', 422);
    const temporaryPassword = randomBytes(16).toString('base64url');
    const hash = await bcrypt.hash(temporaryPassword, bcryptCost);
    const id = randomUUID();
    await pool.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5)',
      [id, email, newRole, 'PENDING_PASSWORD_CHANGE', hash]);
    res.set('cache-control', 'no-store');
    return res.status(201).json({ user: { id, email, role: newRole }, temporaryPassword });
  });
  app.get('/internal/session', internalOnly, async (req, res) => {
    const user = await localIntrospect(req.get('x-g2-session'));
    return user ? res.json({ user }) : error(res, 'INACTIVE');
  });
}

async function setupTickets() {
  await pool.query(`CREATE TABLE IF NOT EXISTS tickets(
    id UUID PRIMARY KEY, owner_id TEXT NOT NULL, assignee_id TEXT,
    title TEXT NOT NULL, status TEXT NOT NULL, version INT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS timeline(
    id UUID PRIMARY KEY, ticket_id UUID NOT NULL, actor_id TEXT NOT NULL,
    kind TEXT NOT NULL, version INT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS outbox(
    event_id UUID PRIMARY KEY, ticket_id UUID NOT NULL, aggregate_version INT NOT NULL,
    body JSONB NOT NULL, published_at TIMESTAMPTZ)`);
  app.post('/api/tickets', requireFull, async (req, res) => {
    if (req.actor.role !== 'REPORTER') return error(res, 'FORBIDDEN', 403);
    const title = req.body?.title;
    if (typeof title !== 'string' || title.length < 3 || title.length > 200)
      return error(res, 'INVALID_INPUT', 422);
    const id = randomUUID();
    await pgTransaction(async tx => {
      await tx.query("INSERT INTO tickets VALUES ($1,$2,NULL,$3,$4,1)",
        [id, req.actor.id, title, 'OPEN']);
      await appendTicketEvent(tx, id, 1, 'ticket.created.v1', req.actor.id);
    });
    return res.status(201).json({ ticket: { id, status: 'OPEN', version: 1 } });
  });
  app.post('/api/tickets/:id/claim', requireFull, async (req, res) => {
    if (req.actor.role !== 'AGENT') return error(res, 'FORBIDDEN', 403);
    const outcome = await pgTransaction(async tx => {
      const q = await tx.query(
        `UPDATE tickets SET assignee_id=$2,status='ASSIGNED',version=version+1
         WHERE id=$1 AND status='OPEN' AND assignee_id IS NULL
         RETURNING id,version`, [req.params.id, req.actor.id]);
      if (!q.rowCount) return null;
      await appendTicketEvent(tx, q.rows[0].id, q.rows[0].version, 'ticket.claimed.v1', req.actor.id);
      return q.rows[0];
    });
    return outcome ? res.json({ ticket: outcome }) : error(res, 'ALREADY_CLAIMED', 409);
  });
  app.patch('/api/tickets/:id/assignee', requireFull, async (req, res) => {
    if (req.actor.role !== 'ADMIN') return error(res, 'FORBIDDEN', 403);
    const newAgent = req.body?.assigneeId;
    if (!['agent0', 'agent1'].includes(newAgent)) return error(res, 'INVALID_AGENT', 422);
    const outcome = await pgTransaction(async tx => {
      const q = await tx.query(
        "UPDATE tickets SET assignee_id=$2,version=version+1 WHERE id=$1 AND status='ASSIGNED' RETURNING id,version",
        [req.params.id, newAgent]);
      if (!q.rowCount) return null;
      await appendTicketEvent(tx, q.rows[0].id, q.rows[0].version, 'ticket.reassigned.v1', req.actor.id);
      return q.rows[0];
    });
    return outcome ? res.json({ ticket: outcome }) : error(res, 'NOT_ASSIGNED', 409);
  });
  app.get('/api/tickets/:id', requireFull, async (req, res) => {
    const q = await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
    const row = q.rows[0];
    if (!row || (req.actor.role !== 'ADMIN' && row.owner_id !== req.actor.id && row.assignee_id !== req.actor.id))
      return error(res, 'NOT_FOUND', 404);
    return res.json({ ticket: row });
  });
  app.post('/internal/tickets/:id/authorize', internalOnly, async (req, res) => {
    const user = await introspect(req.get('x-g2-session'));
    if (!user) return error(res, 'INACTIVE');
    const q = await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
    const ticket = q.rows[0];
    if (!ticket) return error(res, 'NOT_FOUND', 404);
    const matched = user.role === 'ADMIN' || ticket.owner_id === user.id || ticket.assignee_id === user.id;
    const active = ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS';
    const can = matched && (req.body.action === 'read' || active);
    return can ? res.json({ user, ticketVersion: ticket.version }) : error(res, 'FORBIDDEN', 403);
  });
  app.get('/internal/tickets/:id/audience', internalOnly, async (req, res) => {
    const q = await pool.query('SELECT owner_id,assignee_id FROM tickets WHERE id=$1', [req.params.id]);
    return q.rows[0] ? res.json({ audience: [q.rows[0].owner_id, q.rows[0].assignee_id, 'admin'].filter(Boolean) })
      : error(res, 'NOT_FOUND', 404);
  });
  app.get('/internal/tickets/metrics', internalOnly, async (req, res) => {
    const q = await pool.query(`SELECT
     (SELECT COUNT(*)::int FROM tickets) AS tickets,
     (SELECT COUNT(*)::int FROM timeline) AS events,
     (SELECT COUNT(*)::int FROM outbox WHERE published_at IS NULL) AS pending`);
    return res.json({ ...q.rows[0], outboxPublished, outboxErrors });
  });

  // Durable publication is downstream of the PostgreSQL transaction.
  nc = await connect({ servers: natsUrl, timeout: 5000 });
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.add({ name: 'FIXIT_G2', subjects: ['fixit.ticket.>'], storage: StorageType.File });
  } catch (e) {
    if (!String(e.message).includes('already in use')) throw e;
  }
  js = nc.jetstream();
  let publishing = false;
  const poll = async () => {
    if (publishing) return;
    publishing = true;
    try {
      const q = await pool.query('SELECT event_id,ticket_id,body FROM outbox WHERE published_at IS NULL ORDER BY aggregate_version LIMIT 20');
      for (const row of q.rows) {
        await js.publish(`fixit.ticket.${row.ticket_id}.v1`, codec.encode(JSON.stringify(row.body)), { msgID: row.event_id });
        await pool.query('UPDATE outbox SET published_at=NOW() WHERE event_id=$1', [row.event_id]);
        outboxPublished++;
      }
    } catch (err) {
      outboxErrors++;
      if (outboxErrors <= 2) console.error('OUTBOX_RETRY', err.message);
    } finally { publishing = false; }
  };
  const timer = setInterval(poll, 300);
  timer.unref();
}

async function setupChat() {
  mongo = new MongoClient(mongoUrl, { maxPoolSize: 12, serverSelectionTimeoutMS: 4500 });
  await mongo.connect();
  const db = mongo.db('fixit_g2');
  const messages = db.collection('messages');
  const events = db.collection('events');
  await messages.createIndex({ ticketId: 1, senderId: 1, clientMessageId: 1 }, { unique: true });
  await messages.createIndex({ ticketId: 1, createdAt: 1 });
  await events.createIndex({ eventId: 1 }, { unique: true });

  async function ticketPermission(ticketId, token, action) {
    const result = await callJson(`${ticketsUrl}/internal/tickets/${ticketId}/authorize`, token, { action });
    if (result.status !== 200) throw Object.assign(new Error('NO_ACCESS'), { status: result.status });
    return result.body.user;
  }
  async function saveMessage(ticketId, token, body, clientMessageId) {
    const user = await ticketPermission(ticketId, token, 'write');
    if (typeof body !== 'string' || !body.length || body.length > 2048)
      throw Object.assign(new Error('INVALID_BODY'), { status: 422 });
    if (typeof clientMessageId !== 'string' || clientMessageId.length > 100)
      throw Object.assign(new Error('INVALID_ID'), { status: 422 });
    let message = { _id: randomUUID(), ticketId, senderId: user.id, clientMessageId, body, createdAt: new Date() };
    try {
      await messages.insertOne(message, { writeConcern: { w: 1 } });
    } catch (e) {
      if (e.code !== 11000) throw e;
      retries++;
      message = await messages.findOne({ ticketId, senderId: user.id, clientMessageId });
    }
    // A socket's handshake may be hours old. Revalidate every recipient's
    // CURRENT session and ticket permission before delivering message bodies.
    // Stale room membership or role metadata must never authorize a broadcast.
    const audience = await callJson(`${ticketsUrl}/internal/tickets/${ticketId}/audience`, null);
    if (audience.status === 200 && io) {
      const recipients = [...io.of('/').sockets.values()].filter(socket =>
        socket.rooms.has(ticketId) && audience.body.audience.includes(socket.data.user?.id));
      await Promise.all(recipients.map(async socket => {
        try {
          const currentActor = await ticketPermission(ticketId, socket.data.token, 'read');
          if (currentActor.id === socket.data.user?.id) {
            socket.emit('chat:message', message);
            return;
          }
        } catch {
          // Fail closed: loss of Auth/Tickets must not leak messages.
        }
        socket.leave(ticketId);
      }));
    }
    return message;
  }
  app.post('/api/chat/:id/messages', async (req, res) => {
    try {
      const m = await saveMessage(req.params.id, bearerCookie(req), req.body?.body, req.body?.clientMessageId);
      return res.status(201).json({ message: m });
    } catch (e) { return error(res, e.message === 'NO_ACCESS' ? 'NO_ACCESS' : 'MESSAGE_FAILED', e.status || 503); }
  });
  app.get('/api/chat/:id/messages', async (req, res) => {
    try {
      await ticketPermission(req.params.id, bearerCookie(req), 'read');
      const found = await messages.find({ ticketId: req.params.id }).sort({ createdAt: 1 }).limit(200).toArray();
      return res.json({ messages: found });
    } catch (e) { return error(res, 'NO_ACCESS', e.status || 503); }
  });
  app.get('/internal/chat/metrics', internalOnly, async (req, res) => {
    return res.json({
      messages: await messages.countDocuments(),
      events: await events.countDocuments(),
      consumed, retries,
    });
  });

  io = new SocketServer(server, { transports: ['websocket'] });
  io.use(async (socket, next) => {
    const tok = cookieToken(socket.handshake.headers.cookie);
    try {
      const result = await callJson(`${authUrl}/internal/session`, tok);
      if (result.status !== 200) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = result.body.user;
      socket.data.token = tok;
      next();
    } catch { next(new Error('AUTH_UNAVAILABLE')); }
  });
  io.on('connection', socket => {
    socket.on('ticket:join', async (ticketId, ack) => {
      try {
        await ticketPermission(ticketId, socket.data.token, 'read');
        socket.join(ticketId);
        ack({ ok: true });
      } catch { ack({ ok: false }); }
    });
    socket.on('chat:send', async (payload, ack) => {
      try {
        const m = await saveMessage(payload.ticketId, socket.data.token, payload.body, payload.clientMessageId);
        ack({ ok: true, message: m });
      } catch (e) { ack({ ok: false, code: e.message }); }
    });
  });

  nc = await connect({ servers: natsUrl, timeout: 5000 });
  js = nc.jetstream();
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.consumers.add('FIXIT_G2', {
      durable_name: 'fixit-g2-chat', ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All, filter_subject: 'fixit.ticket.>',
    });
  } catch (e) {
    if (!String(e.message).includes('already in use')) throw e;
  }
  // A restarted Chat consumer catches up using the durable JetStream cursor.
  (async () => {
    const consumer = await js.consumers.get('FIXIT_G2', 'fixit-g2-chat');
    for (;;) {
      try {
        const batch = await consumer.fetch({ max_messages: 30, expires: 1300 });
        for await (const msg of batch) {
          const event = JSON.parse(codec.decode(msg.data));
          await events.updateOne({ eventId: event.eventId }, { $setOnInsert: event }, { upsert: true });
          consumed++;
          msg.ack();
        }
      } catch (e) {
        if (!String(e.message).includes('timeout')) console.error('NATS_CONSUMER_RETRY', e.message);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  })().catch(e => console.error('NATS_CONSUMER_STOP', e.message));
}

app.get('/internal/ready', (_, res) => res.json({ role, ready: true }));
app.use((err, _req, res, _next) => {
  // Fail closed; only bounded diagnostic text in terminal.
  console.error('G2_REQUEST_ERROR', err.code || err.message);
  error(res, 'G2_INTERNAL_ERROR', 503);
});

async function main() {
  if (role === 'auth' || role === 'core') await setupAuth();
  if (role === 'tickets' || role === 'core') await setupTickets();
  if (role === 'chat') await setupChat();
  server.listen(port, '0.0.0.0', () => console.log(`G2_SERVICE_READY ${role} ${port}`));
}
main().catch(e => { console.error('G2_START_FAILED', role, e.message); process.exit(1); });
