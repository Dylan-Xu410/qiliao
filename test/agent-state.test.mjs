import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveAgentInState,restoreAgentInState} from '../agent-state.mjs';
function fixture(){return {agents:[{id:'a',name:'甲',soul:'# 甲'},{id:'b',name:'乙',soul:'# 乙'}],activeRoom:'dm_a',rooms:[{id:'g',members:['a','b'],messages:[{id:'old',agentId:'a',text:'旧发言'}]},{id:'dm_a',kind:'dm',members:['a'],messages:[{id:'private',text:'私聊记录'}]}],deletedRooms:[{room:{id:'old_g',members:['b','a'],messages:[]}}],deletedAgents:[]};}
test('deleting an agent removes room memberships and private window; restoring preserves history and order',()=>{
  const s=fixture();archiveAgentInState(s,'a','fixture-date');assert.deepEqual(s.agents.map(a=>a.id),['b']);assert.deepEqual(s.rooms[0].members,['b']);assert.deepEqual(s.deletedRooms[0].room.members,['b']);assert.equal(s.rooms.some(r=>r.id==='dm_a'),false);assert.equal(s.activeRoom,'g');assert.equal(s.rooms[0].messages[0].text,'旧发言');
  const roundtrip=JSON.parse(JSON.stringify(s));restoreAgentInState(roundtrip,'a');assert.deepEqual(roundtrip.agents.map(a=>a.id),['a','b']);assert.deepEqual(roundtrip.rooms[0].members,['a','b']);assert.deepEqual(roundtrip.deletedRooms[0].room.members,['b','a']);assert.equal(roundtrip.rooms.find(r=>r.id==='dm_a').messages[0].text,'私聊记录');assert.equal(roundtrip.deletedAgents.length,0);
});
test('all agents can be deleted and restored; deleting the only private-room agent leaves a valid empty view',()=>{
  const s=fixture();s.rooms=s.rooms.filter(r=>r.kind==='dm');archiveAgentInState(s,'a');archiveAgentInState(s,'b');assert.equal(s.agents.length,0);assert.equal(s.rooms.length,1);assert.equal(s.rooms[0].members.length,0);assert.equal(s.activeRoom,s.rooms[0].id);const reloaded=JSON.parse(JSON.stringify(s));restoreAgentInState(reloaded,'a');restoreAgentInState(reloaded,'b');assert.equal(reloaded.agents.length,2);assert.equal(reloaded.rooms.find(r=>r.id==='dm_a').members[0],'a');
});
test('deleting multiple agents preserves original roster and room order regardless of restore order',()=>{
  const s=fixture();archiveAgentInState(s,'a');archiveAgentInState(s,'b');const reloaded=JSON.parse(JSON.stringify(s));restoreAgentInState(reloaded,'b');restoreAgentInState(reloaded,'a');assert.deepEqual(reloaded.agents.map(a=>a.id),['a','b']);assert.deepEqual(reloaded.rooms.find(r=>r.id==='g').members,['a','b']);assert.deepEqual(reloaded.deletedRooms[0].room.members,['b','a']);
});
