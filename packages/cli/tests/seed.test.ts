import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandOrigins, parseArgs, parseEnvFile, retrySeconds, stripExcluded } from '../src/util.ts';

test('stripExcluded removes fenced sections and counts them', () => {
  const input = [
    '# Title',
    '',
    'Kept paragraph.',
    '',
    '<!-- seed:exclude -->',
    '## Secret',
    'Hidden text.',
    '<!-- /seed:exclude -->',
    '',
    'Also kept.',
    '',
    '  <!--seed:exclude-->',
    'Second hidden block.',
    '  <!-- /seed:exclude -->   ',
    'Tail.',
    '',
  ].join('\n');

  const { text, removed } = stripExcluded(input);
  assert.equal(removed, 2);
  assert.ok(!text.includes('Hidden text.'));
  assert.ok(!text.includes('Second hidden block.'));
  assert.ok(!text.includes('seed:exclude'));
  assert.ok(text.includes('Kept paragraph.'));
  assert.ok(text.includes('Also kept.'));
  assert.ok(text.includes('Tail.'));
});

test('stripExcluded leaves text without markers untouched', () => {
  const input = '# Plain\n\nNothing fenced here.\n';
  assert.deepEqual(stripExcluded(input), { text: input, removed: 0 });
});

test('stripExcluded ignores an unterminated marker', () => {
  const input = '<!-- seed:exclude -->\nno closing tag\n';
  assert.deepEqual(stripExcluded(input), { text: input, removed: 0 });
});

test('parseEnvFile handles comments, quotes, export and trailing comments', () => {
  const env = parseEnvFile([
    '# comment',
    '',
    'SEED_TOKEN=abc123',
    'QUOTED="hello world # not a comment"',
    "SINGLE='x y'",
    'export EXPORTED=yes',
    'TRAILING=value # a comment',
    'EMPTY=',
    'not a valid line',
    'SEED_TOKEN=later-wins',
  ].join('\n'));

  assert.equal(env.SEED_TOKEN, 'later-wins');
  assert.equal(env.QUOTED, 'hello world # not a comment');
  assert.equal(env.SINGLE, 'x y');
  assert.equal(env.EXPORTED, 'yes');
  assert.equal(env.TRAILING, 'value');
  assert.equal(env.EMPTY, '');
  assert.equal(Object.keys(env).length, 6);
});

test('retrySeconds reads a hint or falls back', () => {
  assert.equal(retrySeconds('Wait about 42s and try again'), 42);
  assert.equal(retrySeconds('frees up in about 12.4 seconds'), 13);
  assert.equal(retrySeconds('no hint here'), 65);
  assert.equal(retrySeconds(undefined, 30), 30);
});

test('expandOrigins adds apex/www pairs and keeps localhost as-is', () => {
  const origins = expandOrigins(['https://jane.dev/', 'www.example.com', 'http://localhost:5173']);
  assert.deepEqual(origins, [
    'https://jane.dev',
    'https://www.jane.dev',
    'https://www.example.com',
    'https://example.com',
    'http://localhost:5173',
  ]);
});

test('parseArgs separates flags and positionals', () => {
  const parsed = parseArgs(['./docs', '--url', 'https://a.dev', '--inline', '--theme=dark']);
  assert.deepEqual(parsed.positional, ['./docs']);
  assert.deepEqual(parsed.flags, { url: 'https://a.dev', inline: true, theme: 'dark' });
});
