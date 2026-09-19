import test from 'node:test';
import assert from 'node:assert/strict';
import { lots, places } from './data.js';

test('places the Stadium Lot south of Lane Stadium at the official lot', () => {
  const stadiumLot = lots.find(lot => lot.id === 'stadium');
  const laneStadium = places['Lane Stadium'];

  assert.ok(stadiumLot.point[0] < laneStadium[0]);
  assert.ok(stadiumLot.point[0] >= 37.2175 && stadiumLot.point[0] <= 37.2183);
  assert.ok(stadiumLot.point[1] >= -80.4185 && stadiumLot.point[1] <= -80.4165);
});
