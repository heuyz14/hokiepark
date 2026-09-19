import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceBetween, formatDistance } from './distance.js';

test('computes the campus distance between Newman Library and Stadium Lot', () => {
  const meters = distanceBetween([37.2284, -80.4199], [37.2201, -80.4200]);

  assert.ok(meters > 915 && meters < 930);
});

test('formats campus distances in unambiguous US units', () => {
  assert.equal(formatDistance(924), '0.57 mi');
  assert.equal(formatDistance(178), '0.11 mi');
});
