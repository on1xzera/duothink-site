import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInquiry, sendInquiry } from '../server/contact.js';

const inquiry = {
  name: 'Jane Smith',
  email: 'jane@example.com',
  service: 'SEO',
  project: 'Improve our organic visibility.',
};

test('contact fields are normalized and validated', () => {
  assert.deepEqual(validateInquiry({ ...inquiry, name: '  Jane Smith  ' }).fields, inquiry);
  for (const key of Object.keys(inquiry))
    assert.ok(validateInquiry({ ...inquiry, [key]: '' }).error);
  assert.ok(validateInquiry({ ...inquiry, email: 'invalid' }).error);
  assert.ok(
    validateInquiry({ ...inquiry, email: 'jane@example.com\nBcc:other@example.com' }).error,
  );
  assert.ok(validateInquiry({ ...inquiry, service: 'Unknown' }).error);
  assert.ok(validateInquiry({ ...inquiry, project: 'a'.repeat(6_001) }).error);
  assert.ok(validateInquiry(null).error);
});

test('the five DuoThink services can be submitted by the contact form', () => {
  const markup = readFileSync(new URL('../contact/index.html', import.meta.url), 'utf8');
  const choices = [...markup.matchAll(/<option\b[^>]*\bvalue="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(choices, ['Sites', 'Plataformas internas', 'Aplicativos', 'SEO', 'Design de marca']);
  for (const service of choices) {
    assert.equal(validateInquiry({ ...inquiry, service }).fields?.service, service);
  }
  for (const service of ['Paid Advertising', 'Packaging Design']) {
    assert.ok(validateInquiry({ ...inquiry, service }).error);
  }
});

test('unconfigured delivery never claims that mail was sent', async () => {
  const result = await sendInquiry(inquiry, {}, () => {
    throw new Error('Transport must not be invoked.');
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.composeEmail, true);
  assert.equal(result.body.ok, undefined);
});

test('configured delivery uses reply-to and the configured recipient', async () => {
  const result = await sendInquiry(
    inquiry,
    {
      RESEND_API_KEY: 'test-key',
      CONTACT_FROM_EMAIL: 'Website <website@example.com>',
      CONTACT_TO_EMAIL: 'owner@example.com',
    },
    async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      const body = JSON.parse(options.body);
      assert.equal(body.reply_to, inquiry.email);
      assert.deepEqual(body.to, ['owner@example.com']);
      assert.match(body.text, /Improve our organic visibility/u);
      return { ok: true };
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('mail provider errors remain errors', async () => {
  const result = await sendInquiry(
    inquiry,
    {
      RESEND_API_KEY: 'test-key',
      CONTACT_FROM_EMAIL: 'website@example.com',
      CONTACT_TO_EMAIL: 'owner@example.com',
    },
    async () => ({ ok: false }),
  );
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, undefined);
});
