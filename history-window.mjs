import {allRooms} from './history.mjs';
export function windowState(state,size=200){if(!state)return state;const window=r=>({...r,historyTotal:r.messages.length,messages:r.messages.slice(-size)});return structuredClone({...state,rooms:state.rooms.map(window),deletedRooms:state.deletedRooms.map(x=>({...x,room:window(x.room)})),deletedAgents:state.deletedAgents.map(x=>({...x,privateRooms:(x.privateRooms||[]).map(window)}))});}
export function expandWindow(base,next,current){
  if(!base)throw new Error('分页保存需要同步基线，请刷新页面');
  base=structuredClone(base);next=structuredClone(next);const canonical=new Map(allRooms(current).map(r=>[r.id,r])),following=new Map(allRooms(next).map(r=>[r.id,r]));
  for(const old of allRooms(base)){const room=canonical.get(old.id),updated=following.get(old.id);delete old.historyTotal;if(!room||!updated)continue;delete updated.historyTotal;
    if(old.sessionEpoch!==updated.sessionEpoch&&updated.messages.length===0){if(room.messages.at(-1)?.id!==old.messages.at(-1)?.id)throw new Error('另一窗口新增了消息，请同步后再清空');old.messages=structuredClone(room.messages);continue;}
    if(old.messages.length){const index=room.messages.findIndex(m=>m.id===old.messages[0].id);if(index<0)throw new Error('历史已清空或删除，请同步后重试');const prefix=room.messages.slice(0,index);old.messages=[...structuredClone(prefix),...old.messages];updated.messages=[...structuredClone(prefix),...updated.messages];}
  }
  for(const s of [base,next])for(const r of allRooms(s))delete r.historyTotal;return {base,next};
}
