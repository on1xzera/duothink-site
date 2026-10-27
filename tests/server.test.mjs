import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSiteServer } from '../tools/serve.mjs';

const server = createSiteServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('every original navigation route serves a complete document', async () => {
  for (const route of [
    '/',
    '/about',
    '/contact',
    '/projects/paulo-padilha',
    '/projects/bloom-co.',
    '/projects/pulse-fitness',
    '/legal/privacy-policy',
    '/legal/terms-of-service',
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/u);
    assert.match(await response.text(), /<title>/u);
  }
});

test('source code, environment files and missing pages are not exposed', async () => {
  for (const route of ['/.env', '/server/contact.js', '/tools/serve.mjs', '/missing'])
    assert.equal((await fetch(origin + route)).status, 404, route);
});

test('video byte ranges are served without downloading the whole video', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'dtk-byte-ranges-'));
  await mkdir(path.join(fixture, 'assets'), { recursive: true });
  for (const extension of ['mp4', 'webm'])
    await writeFile(path.join(fixture, 'assets', `sample.${extension}`), Buffer.alloc(256, 7));
  const rangeServer = createSiteServer(fixture);
  await new Promise((resolve) => rangeServer.listen(0, '127.0.0.1', resolve));
  try {
  for (const extension of ['mp4', 'webm']) {
    const resource = `http://127.0.0.1:${rangeServer.address().port}/assets/sample.${extension}`;
    const response = await fetch(resource, { headers: { Range: 'bytes=0-99' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'video/' + extension);
    assert.equal((await response.arrayBuffer()).byteLength, 100);
    assert.match(response.headers.get('content-range'), /^bytes 0-99\//u);
    assert.equal((await fetch(resource, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  }
  } finally {
    await new Promise((resolve) => rangeServer.close(resolve));
    await rm(fixture, { recursive: true, force: true });
  }
});

test('contact endpoint rejects invalid input before sending', async () => {
  assert.equal((await fetch(origin + '/api/contact')).status, 405);
  assert.equal(
    (
      await fetch(origin + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{broken',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(origin + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(origin + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
        body: '{}',
      })
    ).status,
    403,
  );
});

test('the original project URL redirects to its portable folder name', async () => {
  const response = await fetch(origin + '/projects/bloom-co.?ref=example', { redirect: 'manual' });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/projects/bloom-co?ref=example');
});
