export function archiveAgentInState(state,id,deletedAt=new Date().toISOString()){
  const position=state.agents.findIndex(a=>a.id===id);if(position<0)return null;
  state.agentOrder=state.agentOrder||state.agents.map(a=>a.id);for(const a of state.agents)if(!state.agentOrder.includes(a.id))state.agentOrder.push(a.id);
  const agent=state.agents[position],allRooms=[...state.rooms,...(state.deletedRooms||[]).map(x=>x.room)];
  const item={agent:structuredClone(agent),position:state.agentOrder.indexOf(id),deletedAt,memberships:allRooms.filter(r=>r.kind!=='dm'&&r.members.includes(id)).map(r=>({roomId:r.id,index:r.members.indexOf(id),order:(state.deletedAgents||[]).flatMap(x=>x.memberships).find(x=>x.roomId===r.id&&x.order)?.order||[...r.members]})),privateRooms:allRooms.filter(r=>r.kind==='dm'&&r.members.includes(id))};
  state.deletedAgents=state.deletedAgents||[];if(!state.deletedAgents.some(x=>x.agent.id===id))state.deletedAgents.push(item);
  state.agents=state.agents.filter(a=>a.id!==id);
  for(const r of allRooms)r.members=r.members.filter(memberId=>memberId!==id);
  // Keep the private room snapshot intact for restoration.
  for(const r of item.privateRooms)r.members=[id];
  state.rooms=state.rooms.filter(r=>!(r.kind==='dm'&&item.privateRooms.includes(r)));
  state.deletedRooms=(state.deletedRooms||[]).filter(x=>!(x.room.kind==='dm'&&item.privateRooms.includes(x.room)));
  if(!state.rooms.length)state.rooms=[{id:'empty-lounge',name:'空白聊天室',icon:'🪴',topic:'添加 agent，开始观察他们的聊天。',members:[],messages:[],events:[],turns:0}];
  if(!state.rooms.some(r=>r.id===state.activeRoom))state.activeRoom=(state.rooms.find(r=>r.kind!=='dm')||state.rooms[0]).id;
  return item;
}
export function restoreAgentInState(state,id){
  const item=(state.deletedAgents||[]).find(x=>x.agent.id===id);if(!item)throw new Error('回收站中没有这个 agent');
  if(state.agents.some(a=>a.id===id))throw new Error('这个 agent 已存在');if(state.agents.length>=8)throw new Error('最多支持 8 个 agent');
  const agent=structuredClone(item.agent);state.agents.splice(Math.min(item.position,state.agents.length),0,agent);
  if(state.agentOrder)state.agents.sort((a,b)=>state.agentOrder.indexOf(a.id)-state.agentOrder.indexOf(b.id));
  for(const {roomId,index,order} of item.memberships){const r=[...state.rooms,...(state.deletedRooms||[]).map(x=>x.room)].find(r=>r.id===roomId);if(r&&!r.members.includes(id)){r.members.splice(Math.min(index,r.members.length),0,id);if(order)r.members.sort((a,b)=>(order.includes(a)?order.indexOf(a):Infinity)-(order.includes(b)?order.indexOf(b):Infinity));}}
  for(const r of item.privateRooms)if(!state.rooms.some(x=>x.id===r.id))state.rooms.push(r);
  state.deletedAgents=state.deletedAgents.filter(x=>x!==item);return agent;
}
