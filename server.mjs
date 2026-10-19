import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {validateTurn} from './core.mjs';
import {ProviderRegistry,listModels} from './providers.mjs';
import {MemoryStore} from './memory.mjs';
import {Internet} from './internet.mjs';
import {CodexBridge} from './codex-bridge.mjs';
import {generateTurn} from './chat-engine.mjs';
import {WorkspaceStore} from './workspace.mjs';
import {queryHistory,allRooms,acquireServerLock} from './history.mjs';
import {windowState} from './history-window.mjs';
import {BackgroundRunner} from './background.mjs';
import {purgeAgentInState,purgeRoomInState,validateWorkspace,commitReplyToState} from './workspace-state.mjs';
import {archiveAgentInState,restoreAgentInState} from './agent-state.mjs';
import {BackupService,recoverStorage,prepareBackup,backupSummary} from './backup.mjs';
import {RunTracker,sessionLimits,checkSession,summarizeRuns} from './metrics.mjs';
import {applyGroupAction} from './groups.mjs';
import {pendingObserverReply} from './attention.mjs';
import {prepareContext,clearContextCache} from './context.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||4318);
const dataDirectory=process.env.LOUNGE_DATA_DIR?path.resolve(process.env.LOUNGE_DATA_DIR):path.join(root,'data'),runtime=path.join(root,'work','chat-sandbox');
await mkdir(runtime,{recursive:true});await mkdir(dataDirectory,{recursive:true});const releaseLock=acquireServerLock(dataDirectory);process.once('exit',releaseLock);await recoverStorage(dataDirectory);
const registry=new ProviderRegistry(dataDirectory),memory=new MemoryStore(dataDirectory),internet=new Internet(path.join(dataDirectory,'media')),bridge=new CodexBridge(runtime),workspace=new WorkspaceStore(dataDirectory);
await Promise.all([registry.ready,memory.ready,workspace.ready]);
internet.provider=workspace.document.web?.provider||'auto';
const backups=new BackupService(dataDirectory,workspace,memory,registry);
let inFlight=false,activeAbort=null,activeSessionId=null,statusCache=null,administration=Promise.resolve();
function serial(fn,idle=true){const task=administration.then(()=>{if(idle&&inFlight)throw new Error('请先暂停正在生成的回复');return fn();});administration=task.catch(()=>{});return task;}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function readBody(req,limit=350000){let bytes=0,chunks=[];for await(const d of req){bytes+=d.length;if(bytes>limit)throw new Error('请求内容过大');chunks.push(d);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
async function stateResponse(revision,windowed=false){await workspace.ready;await workspace.queue;const d=workspace.document;return {revision:d.revision,epoch:d.restoreEpoch||null,busy:inFlight,...(Number(revision)===d.revision?{}:{state:windowed?windowState(d.state):d.state})};}
async function status(){let codex={installed:false,loggedIn:false,auth:'未连接'};if(statusCache&&Date.now()-statusCache.time<30000)codex=statusCache.codex;else{try{await bridge.start();const account=await bridge.rpc('account/read',{refreshToken:false},12000);codex={installed:true,loggedIn:!!account.account,auth:account.account?.type==='chatgpt'?'ChatGPT 订阅':account.account?'API Key':'未登录'};}catch(e){codex.error=e.message;}statusCache={time:Date.now(),codex};}return {local:true,version:'0.7.0',busy:inFlight,codex,providers:registry.list(),web:internet.status(),diagnostics:bridge.diagnostics};}
function structure(s){return JSON.stringify({agents:s.agents,deletedAgents:s.deletedAgents,deletedRooms:s.deletedRooms,settings:s.settings,rooms:s.rooms.map(({messages,events,turns,...r})=>r)});}
async function workspaceAction(b){
  const beforeMemory=await memory.snapshot();
  try{await workspace.transaction(async d=>{
    if(!d.state)throw new Error('先完成工作区迁移');const s=d.state,id=b.id;
    if(b.action==='archive-agent'){const a=s.agents.find(x=>x.id===id);if(!a)throw new Error('agent 不存在');const saved=await memory.archiveAgent(a);archiveAgentInState(s,id,saved.deletedAt);}
    else if(b.action==='restore-agent'){await memory.restoreAgent(id);restoreAgentInState(s,id);}
    else if(b.action==='purge-agent'){if(b.confirm!==true)throw new Error('需要确认永久删除');purgeAgentInState(s,id);await memory.purgeAgent(id);d.purgedAgents=[...new Set([...(d.purgedAgents||[]),id])];}
    else if(b.action==='archive-room'){const r=s.rooms.find(x=>x.id===id&&x.kind!=='dm');if(!r)throw new Error('聊天室不存在');s.rooms=s.rooms.filter(x=>x!==r);s.deletedRooms.unshift({room:r,deletedAt:new Date().toISOString()});if(!s.rooms.length){const a=s.agents[0];s.rooms=[a?{id:'dm_'+a.id,kind:'dm',name:a.name+' 的私聊',icon:'💬',topic:'独立私聊',members:[a.id],turns:0,messages:[],events:[]}:{id:'empty-lounge',name:'空白聊天室',icon:'🪴',topic:'添加两位 agent 后开始聊天',members:[],turns:0,messages:[],events:[]}];}}
    else if(b.action==='restore-room'){const entry=s.deletedRooms.find(x=>x.room.id===id);if(!entry)throw new Error('聊天室不在回收站');s.deletedRooms=s.deletedRooms.filter(x=>x!==entry);s.rooms.push(entry.room);}
    else if(b.action==='purge-room'){if(b.confirm!==true)throw new Error('需要确认永久删除');const deleted=purgeRoomInState(s,id);await memory.purgeRoomEvidence(id,deleted.messages.map(m=>m.id));d.purgedRooms=[...new Set([...(d.purgedRooms||[]),id])];}
    else throw new Error('操作无效');d.state=validateWorkspace(s);
  });}catch(e){await memory.replaceState(beforeMemory);throw e;}
  clearContextCache();if(b.action.includes('agent'))bridge.dropAgent(b.id);if(b.action.startsWith('purge'))await backups.garbageCollectMedia();return stateResponse();
}

async function performTurn(input,onEvent=()=>{},externalSignal){
      let b=input;if(![4,5].includes(b.clientVersion))throw new Error('页面已升级，请刷新所有窗口后再发送；旧记录仍保留在浏览器。');await administration;if(inFlight)throw new Error('还有一条回复正在生成，请稍后再试');
      const d=await workspace.snapshot();if(d.state){const r=d.state.rooms.find(r=>r.id===b.roomId),a=d.state.agents.find(a=>a.id===b.agent?.id);if(!r||!a||!r.members.includes(a.id))throw new Error('房间或 agent 已改变，请同步页面');const canonicalMembers=r.members.map(id=>d.state.agents.find(a=>a.id===id)),attention=r.kind==='dm'?null:pendingObserverReply(r,canonicalMembers);if(attention&&attention.targetId!==a.id){const error=new Error('有新的待回应消息，请同步后重试');error.status=409;error.code='ATTENTION_CHANGED';throw error;}b={...b,observerRequest:attention?.message||null,observerEpoch:r.messages.filter(m=>m.source==='observer').at(-1)?.id||'',agent:a,members:canonicalMembers,roomType:r.kind==='dm'?'dm':'group',topic:r.topic,sessionEpoch:r.sessionEpoch,messages:r.messages.filter(m=>!['example','demo'].includes(m.source)),settings:d.state.settings,autonomy:r.kind!=='dm'&&d.state.settings.autonomy};}
      b=validateTurn(b,['codex',...registry.providers.keys()]);checkSession(d.session,b.sessionId,b.roomId);if(inFlight)throw new Error('还有一条回复正在生成');inFlight=true;
      const ac=new AbortController();activeAbort=ac;activeSessionId=b.sessionId||null;const tracker=new RunTracker(b);let deadlineTimer=null;
      try{if(b.sessionId){await workspace.transaction(doc=>{checkSession(doc.session,b.sessionId,b.roomId);doc.session.calls++;});deadlineTimer=setTimeout(()=>ac.abort(new Error('已达到会话运行时长上限')),Math.max(1,d.session.deadline-Date.now()));}}catch(e){inFlight=false;activeAbort=null;activeSessionId=null;throw e;}

      const relay=()=>ac.abort(externalSignal.reason);externalSignal?.addEventListener('abort',relay,{once:true});if(externalSignal?.aborted)relay();
      const emit=(type,data)=>{tracker.event(type,data);if(type!=='metrics')try{onEvent(type,data);}catch{}};
      let result;const memoryBefore=await memory.snapshot();
      try{
        result=await generateTurn(b,{registry,bridge,memory,internet},ac.signal,emit);if(ac.signal.aborted)throw new DOMException('已取消','AbortError');
        result.replyTo=b.observerRequest?.id||null;const run=tracker.finish('success',result);result.timing={...result.timing,stages:run.stages};result.persisted=!!d.state;
        await workspace.transaction(doc=>{if(doc.state&&!result.listening)commitReplyToState(doc.state,b,result);if(result.listening){const room=doc.state?.rooms.find(r=>r.id===b.roomId);if(room){room.events.unshift({id:result.id,text:b.agent.name+' 正在倾听',time:new Date().toISOString()});room.events=room.events.slice(0,80);}}if(b.sessionId&&doc.session?.id===b.sessionId){doc.session.listeningStreak=result.listening?(doc.session.listeningStreak||0)+1:0;doc.session.recentActors=[...(doc.session.recentActors||[]),b.agent.id].slice(-16);}doc.runs.push(run);doc.runs=doc.runs.slice(-1000);if(b.sessionId&&doc.session?.id===b.sessionId){doc.session.tokens+=run.usageComplete?run.usage.totalTokens:Math.max(run.usage?.totalTokens||0,run.estimatedTokens);doc.session.estimated=doc.session.estimated||!run.usageComplete;}});emit('done',{result});
      }catch(e){try{await memory.replaceState(memoryBefore);}catch{}const status=ac.signal.aborted?'cancelled':'failed';try{const run=tracker.finish(status,result,e.message);await workspace.transaction(doc=>{doc.runs.push(run);doc.runs=doc.runs.slice(-1000);if(b.sessionId&&doc.session?.id===b.sessionId){doc.session.tokens+=run.usageComplete?run.usage.totalTokens:Math.max(run.usage?.totalTokens||0,run.estimatedTokens);doc.session.estimated=doc.session.estimated||!run.usageComplete;}});}catch{}throw new Error(ac.signal.reason?.message||e.message||'生成失败');}

      finally{clearTimeout(deadlineTimer);externalSignal?.removeEventListener('abort',relay);inFlight=false;activeAbort=null;activeSessionId=null;}
      return result;
}
const runner=new BackgroundRunner({snapshot:()=>workspace.snapshot(),update:fn=>workspace.transaction(fn),turn:performTurn,isBusy:()=>inFlight});
if(workspace.document.session?.background&&!workspace.document.session.stopped)await workspace.transaction(d=>{d.session.stopped=true;d.session.stopReason='本机服务已重启，请重新开始聊天';});

const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/settings-ui.js':'settings-ui.js','/mentions-ui.js':'mentions-ui.js','/context-ui.js':'context-ui.js','/usage-ui.js':'usage-ui.js','/state-sync.js':'state-sync.js','/platform-ui.js':'platform-ui.js','/style.css':'style.css','/brand/logo.svg':'brand/logo.svg','/brand/app-icon.svg':'brand/app-icon.svg','/brand/logo.png':'brand/logo.png'};
const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;if(!['127.0.0.1:'+port,'localhost:'+port].includes(host)){json(res,403,{error:'仅允许本机访问'});return;}
  const origin=req.headers.origin;if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin)){json(res,403,{error:'不接受外部网站请求'});return;}
  const url=new URL(req.url,'http://'+host),route=url.pathname;
  if(req.method==='POST'&&!req.headers['content-type']?.includes('application/json')){json(res,415,{error:'需要 JSON 请求'});return;}
  try{
    if(route==='/api/workspace'&&req.method==='GET'){json(res,200,await stateResponse(url.searchParams.get('revision')??undefined,url.searchParams.get('window')==='1'));return;}
    if(route==='/api/workspace'&&req.method==='POST'){const b=await readBody(req,100000000);await serial(async()=>{const current=await workspace.snapshot();if(inFlight&&current.state&&structure(current.state)!==structure(validateWorkspace(b.state))&&(!b.base||structure(validateWorkspace(b.base))!==structure(validateWorkspace(b.state))))throw new Error('生成期间不能修改角色或房间设置');await workspace.save(b);clearContextCache();},false);json(res,200,await stateResponse(undefined,b.windowed));return;}
    if(route==='/api/workspace/actions'&&req.method==='POST'){const b=await readBody(req);json(res,200,await serial(()=>workspaceAction(b)));return;}
    if(route==='/api/groups'&&req.method==='POST'){const b=await readBody(req);await serial(()=>workspace.transaction(d=>{if(!d.state)throw new Error('工作区尚未加载');applyGroupAction(d.state,b);}),false);json(res,200,await stateResponse());return;}
    if(route==='/api/backup'&&req.method==='GET'){json(res,200,await serial(()=>backups.snapshot()));return;}
    if(route==='/api/backup/restore-point'&&req.method==='GET'){json(res,200,JSON.parse(await readFile(backups.restorePoint,'utf8')));return;}
    if(route==='/api/backup/preview'&&req.method==='POST'){json(res,200,backupSummary(prepareBackup(await readBody(req,120000000))));return;}
    if(route==='/api/backup/restore'&&req.method==='POST'){const b=await readBody(req,120000000);if(b.confirm!==true)throw new Error('需要确认覆盖当前工作区');const summary=await serial(async()=>{const value=await backups.restore(b.backup);bridge.sessions.clear();clearContextCache();internet.provider=workspace.document.web?.provider||'auto';return value;});json(res,200,{summary,...await stateResponse()});return;}
    if(route==='/api/stats'&&req.method==='GET'){const d=await workspace.snapshot();json(res,200,{models:summarizeRuns(d.runs),runs:d.runs.slice(-100).reverse(),session:d.session});return;}
    if(route==='/api/session/start'&&req.method==='POST'){const b=await readBody(req);await serial(()=>workspace.transaction(d=>{if(!d.state?.rooms.some(r=>r.id===b.roomId))throw new Error('聊天室不存在');if(d.session&&!d.session.stopped&&Date.now()<d.session.deadline)throw new Error('已有运行会话，请先停止');const limits=sessionLimits(b);d.session={id:randomUUID(),roomId:b.roomId,...limits,startedAt:new Date().toISOString(),deadline:Date.now()+limits.maxMinutes*60000,calls:0,tokens:0,estimated:false,stopped:false,listeningStreak:0,background:b.background===true,natural:b.natural!==false};}));if(b.background)runner.wake(100);json(res,200,{session:(await workspace.snapshot()).session});return;}
    if(route==='/api/session/stop'&&req.method==='POST'){const b=await readBody(req);await serial(()=>workspace.transaction(d=>{if(d.session?.id===b.id){d.session.stopped=true;d.session.stopReason='已手动暂停';}}),false);if(activeSessionId===b.id)activeAbort?.abort(new Error('本次会话已停止'));json(res,200,{ok:true});return;}
    if(route==='/api/status'&&req.method==='GET'){json(res,200,await status());return;}
    if(route==='/api/context'&&req.method==='GET'){
      if(url.searchParams.get('rebuild')==='1')clearContextCache();
      const d=await workspace.snapshot(),r=d.state?.rooms.find(r=>r.id===url.searchParams.get('roomId')),agent=d.state?.agents.find(a=>a.id===url.searchParams.get('agentId'));if(!r||!agent||!r.members.includes(agent.id))throw new Error('聊天室或成员已不存在');
      const members=r.members.map(id=>d.state.agents.find(a=>a.id===id)),saved=await memory.get(agent.id),roomType=r.kind==='dm'?'dm':'group',attention=roomType==='group'?pendingObserverReply(r,members):null,observerRequest=attention?.targetId===agent.id?attention.message:null;
      const result=prepareContext({agent,members,messages:r.messages,roomId:r.id,roomType,topic:r.topic,soul:saved.soul||agent.soul||agent.personality,memoryContext:agent.memoryEnabled===false?[]:memory.context(agent.id,members,r.topic,r.messages,roomType),settings:d.state.settings,autonomy:roomType==='group'&&d.state.settings.autonomy,observerRequest});
      json(res,200,{...result.info,view:result.view});return;
    }
    if(route==='/api/providers'&&req.method==='GET'){json(res,200,{providers:registry.list()});return;}
    if(route==='/api/providers'&&req.method==='POST'){const b=await readBody(req);json(res,200,{providers:await serial(()=>registry.save(b))});return;}
    if(route==='/api/config'&&req.method==='POST'){const b=await readBody(req);await serial(async()=>{if(b.clearKeys)registry.clearKeys();for(const id of ['openai','anthropic'])if(typeof b[id]==='string')await registry.save({...registry.providers.get(id),key:b[id]});if(b.web){internet.configure(b.web);await workspace.transaction(d=>{d.web={provider:internet.provider};});}});json(res,200,{providers:registry.list(),web:internet.status()});return;}
    if(route==='/api/models'&&req.method==='GET'){const ac=new AbortController();res.on('close',()=>{if(!res.writableEnded)ac.abort();});const id=url.searchParams.get('provider'),models=id==='codex'?(await bridge.models()).map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,efforts:m.supportedReasoningEfforts})):await listModels(registry.get(id),ac.signal);json(res,200,{models});return;}
    if(route.startsWith('/api/agents/')&&req.method==='GET'){json(res,200,await memory.get(decodeURIComponent(route.slice(12))));return;}
    if(route==='/api/agents'&&req.method==='POST'){
      const b=await readBody(req,100000000);const result=await serial(async()=>{if(b.action)throw new Error('请使用新版回收站操作');const value=b.pin?await memory.pin(b.agent.id,b.pin.id,b.pin.value):b.restore?await memory.restore(b.agent.id,b.restore):b.forget?await memory.forget(b.agent.id,b.forget):await memory.setSoul(b.agent,b.soul,b.reason||'用户编辑初始人设');bridge.dropAgent(b.agent.id);await workspace.transaction(d=>{const a=d.state?.agents.find(a=>a.id===b.agent.id);if(a){a.soul=value.soul;a.personality=value.soul;a.memoryCount=value.memories.length;if(value.profile)Object.assign(a,value.profile);}});return value;});json(res,200,result);return;
    }
    if(route==='/api/session/live'&&req.method==='GET'){await workspace.queue;const d=workspace.document;json(res,200,{session:d.session,live:runner.live,busy:inFlight});return;}
    if(route==='/api/history'&&req.method==='GET'){await workspace.queue;const d=workspace.document,roomId=url.searchParams.get('roomId');if(roomId&&!allRooms(d.state).some(r=>r.id===roomId))throw new Error('聊天室不存在');json(res,200,queryHistory(dataDirectory,{roomId,anchor:url.searchParams.get('anchor'),before:url.searchParams.get('before'),query:url.searchParams.get('q')||'',limit:url.searchParams.get('limit'),activeRooms:roomId?null:d.state.rooms.map(r=>r.id)}));return;}
    if(route==='/api/room/export'&&req.method==='GET'){const d=await workspace.snapshot(),room=d.state.rooms.find(r=>r.id===url.searchParams.get('roomId'));if(!room)throw new Error('聊天室不存在');json(res,200,{room,members:room.members.map(id=>d.state.agents.find(a=>a.id===id)),settings:d.state.settings});return;}
    if(route==='/api/turn'&&req.method==='POST'){const input=await readBody(req,100000000),ac=new AbortController();res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive'});res.flushHeaders();const emit=(type,data)=>{if(!res.destroyed&&!res.writableEnded)res.write('data: '+JSON.stringify({type,...data})+'\n\n');};const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': alive\n\n');},10000);res.on('close',()=>{if(!res.writableEnded)ac.abort();});try{await performTurn(input,emit,ac.signal);}catch(e){emit('error',{error:e.message,...(e.code?{code:e.code}:{})});}finally{clearInterval(heartbeat);if(!res.destroyed)res.end();}return;}
    const modules={'/catalog.js':'provider-catalog.mjs','/agent-state.js':'agent-state.mjs','/workspace-state.js':'workspace-state.mjs','/attention.js':'attention.mjs'};
    if(modules[route]&&req.method==='GET'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-cache'});res.end(await readFile(path.join(root,modules[route])));return;}
    let file=staticFiles[route],base=path.join(root,'public');if(/^\/media\/[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(route)){file=route.slice(7);base=path.join(dataDirectory,'media');}
    if(file&&req.method==='GET'){const data=await readFile(path.join(base,file)),mime={'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}[path.extname(file)]||'text/html; charset=utf-8';res.writeHead(200,{'content-type':mime,'x-content-type-options':'nosniff','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});res.end(data);return;}
    json(res,404,{error:'没有这个地址'});
  }catch(e){if(!res.destroyed&&!res.headersSent)json(res,e.status|| (e.code==='ENOENT'?404:400),{error:e.message||'请求失败',...(e.code==='ATTENTION_CHANGED'?{code:e.code}:{})});else if(!res.destroyed)res.end();}
});
function stop(){runner.close();activeAbort?.abort();bridge.close();server.close();}
process.on('SIGINT',()=>{stop();process.exit(0);});process.on('SIGTERM',()=>{stop();process.exit(0);});
server.listen(port,'127.0.0.1',()=>console.log('Agent Lounge v0.7 ready: http://127.0.0.1:'+port));
server.on('error',e=>{runner.close();console.error(e.code==='EADDRINUSE'?'端口已占用。请关闭已有实例，或设置 PORT 后重试。':e.message);bridge.close();process.exitCode=1;});
