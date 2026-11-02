import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l2Normalise } from '../src/lib/embed';

test('l2Normalise returns unit vectors and is a no-op on unit input', () => {
  const v = l2Normalise([3, 4]);
  assert.deepEqual(v, [0.6, 0.8]);
  assert.deepEqual(l2Normalise([0.6, 0.8]).map((x) => Number(x.toFixed(10))), [0.6, 0.8]);
  assert.deepEqual(l2Normalise([0, 0]), [0, 0]);
});
