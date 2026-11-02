import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { gemini } from '../src/lib/providers/gemini';
import { openai } from '../src/lib/providers/openai';
import { ProviderHttpError, type Credential } from '../src/lib/providers/types';
import { retryDelayMs } from '../src/lib/providers/sse';

const credential: Credential = { key: 'test-key-abcdefghijklmnopqrstuvwxyz', fingerprint: 'abc', provider: 'gemini' };
const realFetch = globalThis.fetch;

function sse(lines: string[], status = 200): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join('');
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('gemini: streams text, collects tool calls and echoes raw parts', async () => {
  let sentBody: any;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sentBody = JSON.parse(String(init.body));
    assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], credential.key);
    return sse([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'lo' }, { thought: true, text: 'hidden' }] } }] }),
      JSON.stringify({
        candidates: [{ content: { parts: [{ functionCall: { name: 'search_document', args: { query: 'x' } }, thoughtSignature: 'sig' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 17 },
      }),
    ]);
  }) as typeof fetch;

  const deltas: string[] = [];
  const result = await gemini.streamTurn({
    credential,
    model: 'gemini-test',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'search_document', description: 'd', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
    onText: (d) => deltas.push(d),
  });

  assert.equal(result.text, 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'search_document');
  assert.equal(result.usage?.output, 7);
  // Schema types upper-cased for Gemini.
  assert.equal(sentBody.tools[0].functionDeclarations[0].parameters.type, 'OBJECT');
  // thoughtSignature survives in raw for echo-back.
  const raw = result.assistant.raw as { parts: { thoughtSignature?: string }[] };
  assert.equal(raw.parts.some((p) => p.thoughtSignature === 'sig'), true);
});

test('openai: accumulates fragmented tool-call arguments by index', async () => {
  globalThis.fetch = (async () =>
    sse([
      JSON.stringify({ choices: [{ delta: { content: 'Sure' } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_document', arguments: '{"que' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"rspack"}' } }] } }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
      '[DONE]',
    ])) as typeof fetch;

  const result = await openai.streamTurn({
    credential,
    model: 'gpt-test',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'search_document', description: 'd', parameters: { type: 'object', properties: {} } }],
    onText: () => undefined,
  });

  assert.equal(result.text, 'Sure');
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'search_document', args: { query: 'rspack' } }]);
  assert.equal(result.usage?.total, 7);
  const raw = result.assistant.raw as { tool_calls: { id: string }[] };
  assert.equal(raw.tool_calls[0].id, 'call_1');
});

test('non-2xx becomes ProviderHttpError without forwarding the body', async () => {
  globalThis.fetch = (async () => new Response('{"error":{"message":"secret detail retry in 12s"}}', { status: 429 })) as typeof fetch;
  await assert.rejects(
    () => openai.streamTurn({ credential, model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], onText: () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderHttpError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 12_000);
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
});

test('embed requests pin 768 dimensions on both providers', async () => {
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ embedding: { values: [1, 0] }, data: [{ index: 0, embedding: [0, 1] }] }), { status: 200 });
  }) as typeof fetch;
  await gemini.embed(credential, 'a', 'document');
  await openai.embed(credential, 'a', 'document');
  assert.equal(bodies[0].outputDimensionality, 768);
  assert.equal(bodies[1].dimensions, 768);
});

test('retryDelayMs reads several hint shapes', () => {
  assert.equal(retryDelayMs('Please retry in 2.5s.'), 2500);
  assert.equal(retryDelayMs('"retryDelay": "30s"'), 30_000);
  assert.equal(retryDelayMs('nothing here'), null);
});
