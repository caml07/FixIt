import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { createServer } from 'node:http';
import { manageShutdown } from '../dist/server.js';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'node:net';

test('health is public and independent of database availability', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['data', 'requestId']);
    assert.deepEqual(body.data, { status: 'ok' });
    assert.match(body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('shutdown stops accepting connections, drains a request, and closes the pool once', async () => {
  let release;
  let entered;
  const enteredRequest = new Promise((resolve) => { entered = resolve; });
  const server = createServer((_req, res) => {
    entered();
    release = () => res.end('done');
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const responsePromise = fetch(`http://127.0.0.1:${port}/`, { headers: { connection: 'close' } });
  await enteredRequest;
  let closed = 0;
  const shutdown = manageShutdown(server, { async end() { closed++; } }, 2000);
  const stopping = shutdown();
  assert.equal(shutdown(), stopping);
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
  release();
  assert.equal(await (await responsePromise).text(), 'done');
  await stopping;
  assert.equal(closed, 1);
});

test('shutdown forces a stalled request to end within its deadline', async () => {
  let entered;
  const enteredRequest = new Promise((resolve) => { entered = resolve; });
  const server = createServer(() => entered());
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = fetch(`http://127.0.0.1:${server.address().port}/`).catch(() => {});
  await enteredRequest;
  let closed = 0;
  await assert.rejects(manageShutdown(server, { async end() { closed++; } }, 100)(), /timed out/);
  await request;
  assert.equal(closed, 1);
});

test('server process starts and serves the health contract', { timeout: 15000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await new Promise((resolve) => reservation.once('listening', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: String(port), TICKETS_BIND_HOST: '127.0.0.1' }, stdio: 'ignore'
  });
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); break; }
      catch { await delay(50); }
    }
    assert.equal(response?.status, 200);
    assert.deepEqual((await response.json()).data, { status: 'ok' });
    assert.equal(child.exitCode, null);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('draining returns the contracted error envelope', async () => {
  const server = createApp(() => true).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.ok(body.error.message);
    assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
