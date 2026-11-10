import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestsCurrentLocation} from '../src/lib/location-intent.ts';
test('map position statements and nearby questions share one location-intent rule',()=>{
 for(const q of ['I can see myself on the map','Where can I park near me?','Use my location','How far from here?','I see the blue dot','Where I’m standing','My position is on the map'])assert.equal(requestsCurrentLocation(q),true,q);
 for(const q of ['Show Coliseum West on the map','Which garage has the most spaces?','2pm class at Torgersen'])assert.equal(requestsCurrentLocation(q),false,q);
});
