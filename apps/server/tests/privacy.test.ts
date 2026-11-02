import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_PLACEHOLDER, redactApiKeys, redactApiKeysDeep, redactContactDetails } from '../src/lib/privacy';

test('redacts emails and dialable phone numbers', () => {
  const out = redactContactDetails('Reach Priya at priya.rao@example.org or +44 20 7946 0958.');
  assert.equal(out.includes('priya.rao@example.org'), false);
  assert.equal(out.includes('7946'), false);
  assert.equal(out.split(CONTACT_PLACEHOLDER).length - 1, 2);
});

test('leaves years, percentages and version strings alone', () => {
  const text = 'Shipped 232 specs in 2011 - 2015, 96% pass rate, 30,000 lines, v2.14.3.';
  assert.equal(redactContactDetails(text), text);
});

test('removes Google and OpenAI keys before indexing', () => {
  const text = 'key=AIzaSyA1234567890abcdefghijklmnopqrstuv and sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const out = redactApiKeys(text);
  assert.equal(out.includes('AIza'), false);
  assert.equal(out.includes('sk-proj'), false);
});

test('deep scrub walks plain objects and arrays but not class instances', () => {
  const date = new Date();
  const out = redactApiKeysDeep({ a: ['sk-abcdefghijklmnopqrstuvwxyz0123'], b: { when: date } });
  assert.equal((out.a[0] as string).includes('sk-'), false);
  assert.equal(out.b.when, date);
});
