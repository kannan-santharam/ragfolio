import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkDocument } from '../src/lib/chunk';

const para = (n: number, words = 60) => Array.from({ length: words }, (_, i) => `word${n}_${i}`).join(' ') + '.';

test('splits on headings and keeps heading metadata', () => {
  const text = ['# Experience', para(1), para(2), '# Education', para(3)].join('\n\n');
  const { chunks, outline } = chunkDocument(text, { hasPages: false });
  assert.ok(chunks.length >= 2);
  assert.deepEqual(outline.map((o) => o.heading), ['Experience', 'Education']);
  assert.equal(chunks[chunks.length - 1].heading, 'Education');
});

test('tracks page numbers across form-feed breaks', () => {
  const text = [para(1), para(2)].join('\n\n') + '\f' + [para(3), para(4)].join('\n\n');
  const { chunks } = chunkDocument(text, { hasPages: true });
  assert.equal(chunks[0].pageFrom, 1);
  assert.equal(chunks[chunks.length - 1].pageTo, 2);
});

test('never emits a chunk over the hard maximum', () => {
  const huge = Array.from({ length: 40 }, (_, i) => para(i, 120)).join(' ');
  const { chunks } = chunkDocument(huge, { hasPages: false });
  for (const chunk of chunks) assert.ok(chunk.content.length <= 1800 + 200, `chunk of ${chunk.content.length}`);
  assert.ok(chunks.length > 3);
});
