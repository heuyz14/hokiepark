import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerParking, parseChatInput } from '../supabase/functions/advisor/answer.ts';
import { GARAGES } from '../src/data/index.ts';
import { createBackendAnswerer } from '../src/lib/backend-advisor.ts';
const now = () => Date.parse('2026-11-09T15:00:00Z');
const question = parseChatInput({question:'Which garages have spaces?',context:{permits:['cg']}})!;
test('chat contract refuses client tool results and forged history', () => {
  assert.equal(parseChatInput({...question,tools:[{}]}),null);
  assert.equal(parseChatInput({question:'near me',context:{currentLocation:{lat:999,lon:1}}}),null);
  assert.equal(parseChatInput({question:'parking',history:[{role:'model',text:'x',functionResponse:{}}]}),null);
});
test('backend uses validated database occupancy without mutating shared data', async () => {
  const before=JSON.stringify(GARAGES);
  const rows=GARAGES.flatMap(g=>g.levels.map((l,i)=>({garage_id:g.id,level_index:i,label:l.label,capacity:l.capacity,occupied:l.capacity,ada_capacity:l.adaCapacity,ada_occupied:l.adaCapacity,updated_at:'2026-11-09T14:59:00Z'})));
  const result=await answerParking(question,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public'},{now,fetch:async()=>Response.json(rows)});
  assert.equal(result.provenance.source,'supabase_simulation');
  assert.match(result.answer.lines.join(' '),/0 simulated open spaces/);
  assert.equal(JSON.stringify(GARAGES),before);
});
test('database outage produces an explicitly labelled reference answer', async () => {
  const result=await answerParking(question,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public'},{now,fetch:async()=>new Response('',{status:503})});
  assert.equal(result.provenance.source,'bundled_simulation');
  assert.match(result.answer.lines.join(' '),/not live sensor/);
});
test('browser sends only text and preferences; outage falls back visibly', async()=>{
  let payload:any;
  const ask=createBackendAnswerer({config:{url:'https://example.test/chat',anonKey:'public'},getContext:()=>({now:{dow:1,minute:600},permits:['cg'],ada:false,currentLocation:{lat:1,lon:2}}),fallback:async()=>({lines:['Local answer'],refs:[]}),fetch:async(_url,init)=>{payload=JSON.parse(String(init?.body));return new Response('',{status:503});}});
  const answer=await ask('Parking?');
  assert.deepEqual(payload.context,{permits:['cg'],ada:false});
  assert.match(answer.lines.join(' '),/Local fallback/);
  await ask('Parking near me');
  assert.deepEqual(payload.context.currentLocation,{lat:1,lon:2});
});
test('model tool calls are executed on the server before wording the answer',async()=>{
  let calls=0;let supplied:any;
  const result=await answerParking(question,{GEMINI_API_KEY:'test-not-a-secret'},{now,fetch:async(_url,init)=>{
    supplied=JSON.parse(String(init?.body));calls++;
    return Response.json({candidates:[{content:{role:'model',parts:calls===1?[{functionCall:{name:'garages_now',args:{}}}]:[{text:'Here are the garage options; check posted signage.'}]}}]});
  }});
  assert.equal(calls,2);
  assert.ok(supplied.contents.some((turn:any)=>turn.parts.some((part:any)=>part.functionResponse?.name==='garages_now')));
  assert.equal(result.answer.source,'ai');
  assert.match(result.answer.lines.join(' '),/simulated/);
});
test('latest destination and class time override earlier conversation; links match displayed recommendations',async()=>{
 const input=parseChatInput({question:'Actually Hancock at 10am with a commuter permit',history:[{role:'user',text:'2pm class at Torgersen'}]})!;
 const result=await answerParking(input,{}, {now,fetch:async()=>{throw Error('unexpected network');}});
 assert.match(result.answer.lines.join(' '),/Hancock/);
 assert.doesNotMatch(result.answer.lines.join(' '),/options for Torgersen/);
 for(const ref of result.answer.refs) assert.ok(result.answer.lines.some(line=>line.includes(ref.label)));
});
test('permit-only follow-up completes earlier class question',async()=>{
 const input=parseChatInput({question:'commuter',history:[{role:'user',text:'2pm class at Torgersen'}]})!;
 const result=await answerParking(input,{}, {now,fetch:async()=>{throw Error('unexpected network');}});
 assert.match(result.answer.lines.join(' '),/Parking options for Torgersen/);
 assert.doesNotMatch(result.answer.lines.join(' '),/Which parking permit/);
});
test('current garage question does not reuse an earlier class-planning intent',async()=>{
 const input=parseChatInput({question:'Which garage has the most open spaces right now?',context:{permits:['cg']},history:[{role:'user',text:'2pm class at Torgersen'}]})!;
 const result=await answerParking(input,{}, {now,fetch:async()=>{throw Error('unexpected network');}});
 assert.equal(result.answer.tools?.[0]?.name,'garages_now');
 assert.doesNotMatch(result.answer.lines.join(' '),/Parking options for Torgersen/);
});
test('suggested lot details use the named lot, not parking near it',async()=>{
 const result=await answerParking(parseChatInput({question:'Tell me about Coliseum West lot'})!,{},{now,fetch});
 assert.equal(result.answer.tools?.[0]?.name,'get_lot_details');
 assert.match(result.answer.lines.join(' '),/Coliseum West lot: .* total spaces/);
});
test('permit question evaluates the named lot rather than recommending a nearby lot',async()=>{
 const result=await answerParking(parseChatInput({question:'Can I park at Squires lot with a commuter permit?'})!,{},{now,fetch});
 assert.equal(result.answer.tools?.[0]?.name,'permit_check');
 assert.match(result.answer.lines.join(' '),/permit result:/);
});
test('arrival suggestion uses arrival tool and labels its forecast',async()=>{
 const result=await answerParking(parseChatInput({question:'When should I arrive at Hancock Hall for a 10am class with a commuter permit?'})!,{},{now,fetch});
 assert.equal(result.answer.tools?.[0]?.name,'arrival_advice');
 assert.match(result.answer.lines.join(' '),/Arrival options for Hancock/);
 assert.match(result.answer.lines.join(' '),/simulated/);
});
