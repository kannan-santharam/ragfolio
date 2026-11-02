import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientAddress, uuidShaped } from '../src/lib/rateLimit';
import { mintVisitorId, ownerBudget, readVisitorId, trialCaps, VISITOR_COOKIE, visitorCookieHeader } from '../src/lib/trial';

test('visitor id is read from the cookie header and nothing else', () => {
  const id = mintVisitorId();
  assert.equal(readVisitorId(new Headers({ cookie: `theme=dark; ${VISITOR_COOKIE}=${id}; other=1` })), id);
  assert.equal(readVisitorId(new Headers({ cookie: `${VISITOR_COOKIE}=not-a-uuid` })), null);
  assert.equal(readVisitorId(new Headers({ cookie: `${VISITOR_COOKIE}=${id}; ${VISITOR_COOKIE}=${id}` })), id);
  assert.equal(readVisitorId(new Headers()), null);
  assert.equal(readVisitorId(new Headers({ 'x-visitor': id })), null);
});

test('visitor cookie is HttpOnly, scoped to the API and Secure over https', () => {
  const id = mintVisitorId();
  const secure = visitorCookieHeader(id, true);
  assert.match(secure, /HttpOnly/);
  assert.match(secure, /SameSite=Lax/);
  assert.match(secure, /Path=\/api/);
  assert.match(secure, /Secure/);
  assert.doesNotMatch(visitorCookieHeader(id, false), /Secure/);
});

test('caps come from the environment with conservative defaults', () => {
  const previous = { ...process.env };
  delete process.env.TRIAL_CHATS_PER_DAY;
  delete process.env.TRIAL_DOCS_PER_DAY;
  delete process.env.OWNER_DAILY_CHATS;
  assert.deepEqual(trialCaps(), { chatsPerDay: 10, docsPerDay: 1, maxChars: 20_000, visionPages: 0, maxTurns: 3 });
  assert.equal(ownerBudget().chatsPerDay, 200);

  process.env.TRIAL_CHATS_PER_DAY = '4';
  process.env.TRIAL_MAX_TURNS = '1';
  process.env.OWNER_DAILY_CHATS = 'lots';
  assert.equal(trialCaps().chatsPerDay, 4);
  assert.equal(trialCaps().maxTurns, 2, 'floored at 2 so the agent can still search once');
  assert.equal(ownerBudget().chatsPerDay, 200, 'garbage falls back to the default');
  process.env = previous;
});

test('counter identities are uuid-shaped and stable', () => {
  const a = uuidShaped('visitor:abc');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a, uuidShaped('visitor:abc'));
  assert.notEqual(a, uuidShaped('visitor:abd'));
});

test('addresses come from platform headers first, then the nearest proxy, never the client', () => {
  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as unknown as Parameters<typeof clientAddress>[0];
  assert.equal(clientAddress(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2', 'x-real-ip': '3.3.3.3' })), '3.3.3.3');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '2.2.2.2', 'rightmost entry: the proxy wrote it');
  assert.equal(clientAddress(req({ 'x-vercel-forwarded-for': '4.4.4.4', 'x-real-ip': '3.3.3.3' })), '4.4.4.4');
  assert.equal(clientAddress(req({ 'x-real-ip': '2001:db8:85a3:8d3:1319:8a2e:370:7348' })), '2001:db8:85a3:8d3::/64');
  assert.equal(clientAddress(req({ 'x-real-ip': '2001:db8::1' })), '2001:db8:0:0::/64');
  assert.equal(clientAddress(req({ 'x-real-ip': '[2001:db8::1]' })), '2001:db8:0:0::/64');
});
