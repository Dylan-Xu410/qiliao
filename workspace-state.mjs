
const missing=Symbol('missing');
const equal=(a,b)=>a===missing||b===missing?a===b:JSON.stringify(a)===JSON.stringify(b);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const identity=x=>object(x)?x.id||x.agent?.id||x.room?.id:null;
export function safeJSON(value,depth=0){if(depth>40)throw new Error('数据嵌套过深');if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new Error('无效字段');safeJSON(v,depth+1);}}
export class StateConflict extends Error{constructor(location){super('另一窗口修改了同一项：'+location+'。未覆盖任何数据，请同步后重试。');this.status=409;}}
export function mergeWorkspace(base,current,next,location='workspace'){
  if(equal(base,next))return current===missing?missing:structuredClone(current);
  if(equal(base,current)||equal(current,next))return next===missing?missing:structuredClone(next);
  if(object(base)&&object(current)&&object(next)){
    const result={};for(const key of new Set([...Object.keys(base),...Object.keys(current),...Object.keys(next)])){
      if(['__proto__','prototype','constructor'].includes(key))throw new Error('无效字段');
      const value=mergeWorkspace(Object.hasOwn(base,key)?base[key]:missing,Object.hasOwn(current,key)?current[key]:missing,Object.hasOwn(next,key)?next[key]:missing,location+'.'+key);if(value!==missing)result[key]=value;
    }return result;
  }
  if(Array.isArray(base)&&Array.isArray(current)&&Array.isArray(next)&&[base,current,next].every(a=>a.every(x=>typeof identity(x)==='string'))){
    const maps=[base,current,next].map(a=>new Map(a.map(x=>[identity(x),x])));
    if([base,current,next].some((a,i)=>maps[i].size!==a.length))throw new Error('重复记录 ID');
    const result=[];for(const id of new Set([...current.map(identity),...next.map(identity),...base.map(identity)])){
      const value=mergeWorkspace(...maps.map(m=>m.has(id)?m.get(id):missing),location+'['+id+']');if(value!==missing)result.push(value);
    }
    // A clear/delete cannot silently erase messages added by another window.
    if(/\.(messages|events)$/.test(location)&&base.some(x=>!maps[2].has(identity(x)))&&current.some(x=>!maps[0].has(identity(x))))throw new StateConflict(location);
    if(/\.events$/.test(location))result.sort((a,b)=>String(b.time).localeCompare(String(a.time)));
    else if(/\.messages$/.test(location))result.sort((a,b)=>String(a.time).localeCompare(String(b.time)));
    return result;
  }
  throw new StateConflict(location);
}
export function reconcileInPlace(target,next){
  if(Array.isArray(target)&&Array.isArray(next)){
    const keyed=new Map(target.filter(x=>identity(x)).map(x=>[identity(x),x]));
    const values=next.map(x=>{const old=keyed.get(identity(x));return old&&object(old)&&object(x)?reconcileInPlace(old,x):structuredClone(x);});target.splice(0,target.length,...values);return target;
  }
  if(object(target)&&object(next)){for(const key of Object.keys(target))if(!Object.hasOwn(next,key))delete target[key];for(const [key,value]of Object.entries(next)){if((Array.isArray(value)&&Array.isArray(target[key]))||(object(value)&&object(target[key])))reconcileInPlace(target[key],value);else target[key]=structuredClone(value);}return target;}
  return structuredClone(next);
}
export function validateWorkspace(input){
  safeJSON(input);
  if(!object(input)||input.version!==1||!Array.isArray(input.agents)||!Array.isArray(input.rooms)||!input.rooms.length||!object(input.settings))throw new Error('聊天工作区格式无效');
  if(input.agents.length>8||input.rooms.length>500)throw new Error('工作区数量超过上限');
  const state=structuredClone(input);delete state.activeRoom;state.deletedAgents=state.deletedAgents||[];state.deletedRooms=state.deletedRooms||[];
  const ids=new Set();for(const a of [...state.agents,...state.deletedAgents.map(x=>x.agent)]){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(a?.id||'')||['observer','self','user','human','world','__proto__','constructor','prototype'].includes(a.id)||ids.has(a.id))throw new Error('角色 ID 重复或无效');ids.add(a.id);}
  const active=new Set(state.agents.map(a=>a.id)),roomIds=new Set();
  const rooms=[...state.rooms,...state.deletedRooms.map(x=>x.room),...state.deletedAgents.flatMap(x=>x.privateRooms||[])];
  for(const r of rooms){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(r?.id||'')||roomIds.has(r.id)||!Array.isArray(r.members)||!Array.isArray(r.messages)||!Array.isArray(r.events))throw new Error('聊天室或聊天记录格式无效');roomIds.add(r.id);if(r.members.length>8||new Set(r.members).size!==r.members.length||r.members.some(id=>!ids.has(id)))throw new Error('聊天室成员无效');if(r.kind==='dm'&&r.members.length!==1)throw new Error('私聊成员无效');for(const m of r.messages){if(typeof m.id!=='string'||typeof m.text!=='string'||m.text.length>10000)throw new Error('消息格式无效');}if(new Set(r.messages.map(m=>m.id)).size!==r.messages.length)throw new Error('消息 ID 重复');r.events=r.events.slice(0,80).map((e,i)=>({...e,id:e.id||'legacy_'+i+'_'+String(e.time)}));}
  for(const r of state.rooms)if(r.members.some(id=>!active.has(id)))throw new Error('活动房间不能包含已删除角色');
  return validateGroups(state);
}
export function purgeRoomInState(state,id){
  const item=state.deletedRooms.find(x=>x.room.id===id);if(!item)throw new Error('聊天室不在回收站');state.deletedRooms=state.deletedRooms.filter(x=>x!==item);for(const a of state.deletedAgents)a.memberships=a.memberships.filter(x=>x.roomId!==id);return item.room;
}
export function purgeAgentInState(state,id){
  const item=state.deletedAgents.find(x=>x.agent.id===id);if(!item)throw new Error('agent 不在回收站');state.deletedAgents=state.deletedAgents.filter(x=>x!==item);state.agentOrder=(state.agentOrder||[]).filter(x=>x!==id);
  for(const r of [...state.rooms,...state.deletedRooms.map(x=>x.room),...state.deletedAgents.flatMap(x=>x.privateRooms||[])]){r.members=r.members.filter(x=>x!==id);r.messages=r.messages.filter(m=>m.agentId!==id);}
  for(const a of state.deletedAgents)for(const membership of a.memberships)membership.order=(membership.order||[]).filter(x=>x!==id);return item;
}
export function commitReplyToState(state,body,result){
  const room=state.rooms.find(r=>r.id===body.roomId),agent=state.agents.find(a=>a.id===body.agent.id);if(!room||!agent)throw new Error('房间或角色已不存在');if(room.messages.some(m=>m.id===result.id))return;

  const oldName=agent.name,changes=['name','signature','avatar','status'].filter(key=>agent[key]!==result.profile[key]);const profileChange=changes.length?oldName+' 自己更新了'+changes.map(key=>({name:'昵称',signature:'签名',avatar:'头像',status:'状态'}[key])).join('、'):'';
  if(agent.avatar!==result.profile.avatar&&!result.profile.avatarSource)delete agent.avatarSource;Object.assign(agent,result.profile,{soul:result.memory.soul,personality:result.memory.soul,memoryCount:result.memory.memoryCount});const time=new Date().toISOString();
  room.messages.push({id:result.id,agentId:agent.id,name:agent.name,avatar:agent.avatar,color:agent.color,text:result.message,time,source:result.source,model:result.model,usage:result.usage,context:result.context,sources:result.sources,timing:result.timing,avatarFeedback:result.avatarFeedback,profileChange,...(result.replyTo?{replyTo:result.replyTo}:{})});room.turns=(room.turns||0)+1;
  room.events.unshift({id:result.id+'_event',text:agent.name+' 发了一条消息',time});if(profileChange)room.events.unshift({id:result.id+'_profile',text:profileChange,time});room.events=room.events.slice(0,80);
}

const kinds=['rooms','agents'];
function collection(state,kind){if(!kinds.includes(kind))throw new Error('分组类型无效');state.groups??={rooms:[],agents:[]};return state.groups[kind];}
function allItems(state,kind){return kind==='agents'?[...state.agents,...(state.deletedAgents||[]).map(x=>x.agent)]:[...state.rooms,...(state.deletedRooms||[]).map(x=>x.room)].filter(r=>r.kind!=='dm');}
export function validateGroups(state){
  state.groups??={rooms:[],agents:[]};
  if(!state.groups||typeof state.groups!=='object'||Array.isArray(state.groups))throw new Error('分组配置无效');
  for(const kind of kinds){
    const groups=state.groups[kind]??=[];if(!Array.isArray(groups)||groups.length>100)throw new Error('分组数量或格式无效');
    const ids=new Set(),names=new Set();for(const g of groups){
      if(!g||!/^[a-zA-Z0-9_-]{1,80}$/.test(g.id||'')||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.trim().length>40||names.has(g.name.trim())||typeof g.collapsed!=='boolean'||!Number.isFinite(g.position))throw new Error('分组名称、ID 或设置无效');
      ids.add(g.id);names.add(g.name.trim());g.name=g.name.trim();
    }
    for(const item of allItems(state,kind))if(item.groupId!==undefined&&item.groupId!==null&&item.groupId!==''&&!ids.has(item.groupId))throw new Error('所属分组已不存在，请同步后重试');
  }
  return state;
}
export function sortedGroups(state,kind){return [...(state.groups?.[kind]||[])].sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));}
export function groupBuckets(state,kind){
  const items=(kind==='agents'?state.agents:state.rooms.filter(r=>r.kind!=='dm')),groups=sortedGroups(state,kind);
  if(!groups.length)return [{id:null,name:'未分组',collapsed:false,items}];
  return [...groups.map(g=>({...g,items:items.filter(x=>x.groupId===g.id)})),{id:null,name:'未分组',collapsed:false,items:items.filter(x=>!x.groupId)}];
}
export function applyGroupAction(state,body){
  const kind=body.kind,groups=collection(state,kind),group=groups.find(g=>g.id===body.id);
  if(body.action==='create'){
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name||name.length>40)throw new Error('分组名称应为 1–40 字');if(groups.some(g=>g.name===name))throw new Error('已有同名分组');
    if(groups.length>=100)throw new Error('最多支持 100 个分组');if(!/^[a-zA-Z0-9_-]{1,80}$/.test(body.id||'')||group)throw new Error('分组 ID 无效或重复');
    groups.push({id:body.id,name,collapsed:false,position:Math.max(-1,...groups.map(g=>g.position))+1});
  }else if(body.action==='move'){
    const item=(kind==='agents'?state.agents:state.rooms.filter(r=>r.kind!=='dm')).find(x=>x.id===body.itemId);if(!item)throw new Error('聊天室或 agent 已不存在');
    if(body.groupId&&!groups.some(g=>g.id===body.groupId))throw new Error('目标分组已不存在，请同步后重试');if(body.groupId)item.groupId=body.groupId;else delete item.groupId;
  }else{
    if(!group)throw new Error('分组已不存在，请同步后重试');
    if(body.action==='rename'){
      const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>40)throw new Error('分组名称应为 1–40 字');if(groups.some(g=>g!==group&&g.name===name))throw new Error('已有同名分组');
      if(body.expectedName!==undefined&&body.expectedName!==group.name)throw new Error('另一窗口已重命名这个分组，请同步后重试');group.name=name;
    }else if(body.action==='collapse'){
      if(typeof body.collapsed!=='boolean')throw new Error('展开设置无效');group.collapsed=body.collapsed;
    }else if(body.action==='delete'){
      state.groups[kind]=groups.filter(g=>g!==group);for(const item of allItems(state,kind))if(item.groupId===group.id)delete item.groupId;
    }else if(body.action==='reorder'){
      const sorted=sortedGroups(state,kind),index=sorted.findIndex(g=>g===group),to=index+(body.direction==='up'?-1:body.direction==='down'?1:0);
      if(to<0||to>=sorted.length||to===index)throw new Error('分组已经在边界');[sorted[index],sorted[to]]=[sorted[to],sorted[index]];sorted.forEach((g,i)=>g.position=i);
    }else throw new Error('分组操作无效');
  }
  validateGroups(state);return state;
}
