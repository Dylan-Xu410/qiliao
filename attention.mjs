const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function mentionPosition(text,name){return new RegExp('(?<![A-Za-z0-9._%+\\-])@'+escapeRegex(name)+'(?=$|[\\s，。！？、,:：;；…（）()])','u').exec(text)?.index??-1;}
export function mentionIds(text,members,selected=[]){
  if(['所有人','全体成员'].some(name=>mentionPosition(text,name)>=0))return members.map(a=>a.id);
  const chosen=selected.filter(x=>members.some(a=>a.id===x.id)&&typeof x.name==='string'&&mentionPosition(text,x.name)>=0),matches=members.map(a=>{const pick=chosen.find(x=>x.id===a.id);if(!pick&&chosen.some(x=>x.name===a.name))return null;const index=mentionPosition(text,pick?.name||a.name);return index<0?null:{id:a.id,index};}).filter(Boolean);
  return matches.sort((a,b)=>a.index-b.index).map(x=>x.id);
}
export function normalSpeaker(room,members,mode='real'){
  const last=room.messages.filter(m=>mode==='demo'?m.source==='demo':m.source&&!['example','demo','observer'].includes(m.source)).at(-1);
  return members[last?(members.findIndex(a=>a.id===last.agentId)+1)%members.length:0];
}
export function pendingObserverReply(room,members,mode='real'){
  const active=new Set(members.map(a=>a.id));
  for(const message of room.messages){
    if(message.source!=='observer'||!Array.isArray(message.replyTargets))continue;
    const answered=new Set(room.messages.filter(m=>m.replyTo===message.id&&(mode==='demo'?m.source==='demo':m.source&&!['example','demo','observer'].includes(m.source))).map(m=>m.agentId));
    const targetId=message.replyTargets.find(id=>active.has(id)&&!answered.has(id));if(targetId)return {message,targetId};
  }
  return null;
}
