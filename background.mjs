import {normalSpeaker,pendingObserverReply} from './attention.mjs';
import {checkSession} from './metrics.mjs';
export function chooseSpeaker(room,members,session){
  const attention=pendingObserverReply(room,members);if(attention)return {agent:members.find(a=>a.id===attention.targetId),attention};
  const fallback=normalSpeaker(room,members);if(!session.natural)return {agent:fallback};
  const recent=room.messages.filter(m=>m.agentId!=='observer'&&!['demo','example'].includes(m.source)).slice(-8),last=recent.at(-1),actors=session.recentActors||recent.map(m=>m.agentId);
  const candidates=members.filter(a=>a.id!==actors.at(-1));if(!candidates.length)return {agent:fallback};
  const score=a=>{const index=actors.lastIndexOf(a.id),wait=index<0?10:actors.length-index;return wait+(last?.text.includes('@'+a.name)?12:0)-(a.status==='away'?3:0);};
  return {agent:candidates.sort((a,b)=>score(b)-score(a))[0]};
}
// The server owns this timer. Browser connections are observers and never start
// another loop or abort it when they disconnect. Restarting the server pauses it.
export class BackgroundRunner{
  constructor({snapshot,update,turn,isBusy}){Object.assign(this,{snapshot,update,turn,isBusy});this.timer=null;this.closed=false;this.active=false;this.live=null;}
  wake(delay=0){if(this.closed||this.active)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.tick(),delay);}
  async stop(id,reason='已手动暂停'){await this.update(d=>{if(d.session?.id===id){d.session.stopped=true;d.session.stopReason=reason;}});clearTimeout(this.timer);}
  async tick(){if(this.closed||this.active)return;this.active=true;let delay=null;
    try{const d=await this.snapshot(),s=d.session;if(!s?.background||s.stopped)return;
      if(this.isBusy()){delay=400;return;}checkSession(s,s.id,s.roomId);
      const r=d.state.rooms.find(r=>r.id===s.roomId);if(!r||r.kind==='dm')throw new Error('聊天室已不存在');
      const members=r.members.map(id=>d.state.agents.find(a=>a.id===id)).filter(Boolean);if(members.length<2)throw new Error('聊天室需要至少两位 agent');
      if((s.listeningStreak||0)>=members.length)throw new Error('成员暂时都选择倾听，聊天已暂停，可换个话题再开始');
      const completed=r.messages.filter(m=>m.source&&!['observer','example','demo'].includes(m.source)).length;
      if(completed>=(Number(d.state.settings.maxRounds)||6)*members.length)throw new Error('已达到房间轮数上限');
      const {agent}=chooseSpeaker(r,members,s);if(!agent)throw new Error('没有可发言的成员');
      this.live={roomId:r.id,agentId:agent.id,text:'',phase:'正在准备回复…',startedAt:Date.now(),key:crypto.randomUUID()};
      await this.turn({clientVersion:5,roomId:r.id,agent:{id:agent.id},sessionId:s.id,natural:s.natural},(type,data)=>{if(type==='text')this.live.text=data.text;if(type==='phase')this.live.phase=data.text;});
      delay=Math.max(250,(Number(d.state.settings.delay)||0)*1000);
    }catch(e){if(e.code==='ATTENTION_CHANGED'){delay=100;}else{const d=await this.snapshot();if(d.session?.background&&!d.session.stopped)await this.stop(d.session.id,e.message||'生成未完成，请检查连接后重新开始');}}
    finally{this.live=null;this.active=false;if(delay!==null)this.wake(delay);}
  }
  close(){this.closed=true;clearTimeout(this.timer);}
}
