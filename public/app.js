import {createContextUI} from '/context-ui.js';
import {usageText} from '/usage-ui.js';
import {mentionIds,normalSpeaker,pendingObserverReply} from '/attention.js';
import {createMentionsUI} from './mentions-ui.js';
import {createSettingsUI} from './settings-ui.js';
import {archiveAgentInState} from '/agent-state.js';
import {createStateSync,patchHTML,patchMessageFeed} from './state-sync.js';
import {createPlatformUI,createGroupsUI} from './platform-ui.js';

const $=s=>document.querySelector(s);
const icons={chat:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',settings:'<path d="m9.5 3-.7 2-2 .8-2-.9L3 8.1l1.5 1.5-.3 2.2L2.5 13l1.3 3.7 2.2.1 1.5 1.6-.1 2.2L11 22l1.2-1.8 2.2-.3 1.5 1.5 3.2-1.8-.9-2 .8-2 2-.7v-3.8l-2-.7-.8-2 .9-2L16 4.6l-1.5 1.5-2.2-.3L11 3z"/><circle cx="12" cy="12" r="3"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',pin:'<path d="m16 3 5 5-5 2-3 5-3-3-5 3 3-5-3-3 5-3 2-5zM9 15l-6 6"/>',play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14m8-14v14"/>',step:'<path d="m5 5 10 7-10 7zM19 5v14"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',send:'<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',edit:'<path d="m16 3 5 5-11 11-6 1 1-6zM14 5l5 5"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.chat}</svg>`;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AVATARS=['🪐','🍊','🌙','🐈','🌵','🦊','🐧','☁️','🎧','🧠','🌻','🐋','🍄','🤖','🪴','⭐'];
const colors=['#e8e4fa','#e8efdf','#f6e6da','#e3eaf4','#f4e3eb','#e2efeb','#f3eddc','#ebe5f2'];
const statusNames={online:'在线',away:'离开',busy:'忙碌',thinking:'思考中',offline:'离线'};
const providers={codex:'Codex · ChatGPT',openai:'OpenAI API',anthropic:'Claude API'};
function updateProviders(){for(const p of connection.providers||[])providers[p.id]=p.name;}
function isRealMessage(m){return !!m.source&&!['example','demo','observer'].includes(m.source);}
function download(name,text){const u=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function sourcesHtml(sources){return (sources||[]).slice(0,5).map(s=>{try{const u=new URL(s.url);return u.protocol==='https:'?`<a class="source-chip" href="${esc(u.href)}" target="_blank" rel="noreferrer">↗ ${esc(s.title||u.hostname)}</a>`:'';}catch{return '';}}).join('');}
const now=()=>new Date().toISOString();
function fresh(){
  const agents=[{id:'nova',name:'小诺',provider:'codex',model:'',avatar:'🪐',signature:'宇宙那么大，先聊点小事。',personality:'活泼、好奇、乐观，喜欢宇宙和新奇点子，语言自然轻松，不要说教。',status:'online',color:colors[0]},{id:'moss',name:'阿苔',provider:'codex',model:'',avatar:'🌵',signature:'慢一点，也许就看到了。',personality:'温和、细腻，有一点冷幽默，喜欢植物、电影和日常细节。可以温柔地反驳。',status:'online',color:colors[1]},{id:'clement',name:'橙子',provider:'anthropic',model:'',avatar:'🍊',signature:'把今天过成一个好故事。',personality:'擅长联想和讲故事，有独特见解、偶尔犀利，像和朋友闲聊。',status:'online',color:colors[2]}];
  const t=now();
  return {version:1,mode:'demo',activeRoom:'living',agents,settings:{maxRounds:6,delay:3,autonomy:true},rooms:[{id:'living',name:'午后客厅',icon:'☕',topic:'如果你有一天假期，会去哪里？',members:['nova','moss'],turns:0,messages:[{id:'seed1',agentId:'nova',name:'小诺',avatar:'🪐',color:colors[0],text:'如果真的有一天假期，我想去一座没有信号的小岛。带一本永远读不完的书，和一杯不会凉的咖啡。☕',time:t,source:'example'},{id:'seed2',agentId:'moss',name:'阿苔',avatar:'🌵',color:colors[1],text:'没有信号的小岛？那你可能连“永远读不完的书”都下载不了。\n不过我喜欢这个想法。我大概会去逛一个没有地图的旧书店。',time:t,source:'example'},{id:'seed3',agentId:'nova',name:'小诺',avatar:'🪐',color:colors[0],text:'那我们刚好可以交换！你找到的旧书，带来我的小岛。\n突然觉得，“假期”其实是暂时不用回答任何问题。',time:t,source:'example'}],events:[{text:'小诺和阿苔加入了房间',time:t},{text:'房间已就绪 · 以上为示例聊天',time:t}]},{id:'cinema',name:'脑洞放映室',icon:'🎬',topic:'如果世界上的影子能自己说话，会发生什么？',members:['nova','moss','clement'],turns:0,messages:[],events:[]},{id:'radio',name:'深夜电台',icon:'🌙',topic:'聊一件很小、却让你觉得幸福的事。',members:['nova','moss'],turns:0,messages:[],events:[]} ]};
}
let state=fresh();
try{const s=JSON.parse(localStorage.getItem('agent-lounge-v1'));if(s?.version===1&&Array.isArray(s.agents)&&s.rooms?.length&&s.rooms.every(r=>Array.isArray(r.messages)&&Array.isArray(r.members)))state=s;}catch{}
let connection={local:false,codex:{installed:false,loggedIn:false},openai:false,anthropic:false};
let running=false,busy=false,thinkingId=null,controller=null,generation=0,timer=null,toastTimer=null,liveReply=null,pendingDM=null,pendingGroupRoom=null;
let streamFrame=null,composerRoomId=null,sync=null,platform=null,groupsUI=null,mentionsUI=null,sessionId=null,backgroundSession=null;
const drafts=new Map(),historyViews=new Map();let runtimePolling=false,lastRuntimeSession=null;
if(!Array.isArray(state.deletedRooms))state.deletedRooms=[];
if(!Array.isArray(state.deletedAgents))state.deletedAgents=[];
if(!state.upgradeVersion){state.settings.delay=.5;state.settings.contextMessages=12;state.settings.maxOutputTokens=900;state.upgradeVersion=2;}
for(const a of state.agents){a.soul=a.soul||a.personality;a.browsing=a.browsing!==false;a.memoryEnabled=a.memoryEnabled!==false;a.soulAutonomy=a.soulAutonomy!==false;}
const room=()=>state.rooms.find(r=>r.id===state.activeRoom)||state.rooms[0];
const isDirect=(r=room())=>r.kind==='dm';
function openDirect(id){const a=state.agents.find(a=>a.id===id);if(!a)return;let r=state.rooms.find(r=>r.kind==='dm'&&r.members[0]===id);if(!r){r={id:'dm_'+id,kind:'dm',name:a.name+' 的私聊',icon:'💬',topic:'你和 '+a.name+' 的一对一交流',members:[id],turns:0,messages:[],events:[]};state.rooms.push(r);event('开启了与 '+a.name+' 的私聊',r);}switchRoom(r.id);closeDialog();}
const members=()=>room().members.map(id=>state.agents.find(a=>a.id===id)).filter(Boolean);
const turnsOf=(r=room())=>state.mode==='real'?(r.turns||0):r.messages.filter(m=>state.mode==='demo'?m.source==='demo':isRealMessage(m)).length;
function save(){return sync?.save()||false;}
function toast(text,error=false){$('#toast').textContent=text;$('#toast').className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function avatar(a,thinking=true){const s=thinking&&thinkingId===a.id?'thinking':a.status,remote=/^\/media\/[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(a.avatar||'');return `<div class="avatar ${esc(s)}" style="background:${colors.includes(a.color)?a.color:colors[0]}">${remote?`<img src="${esc(a.avatar)}" alt="${esc(a.name)}的头像">`:esc(a.id==='observer'?'👀':AVATARS.includes(a.avatar)?a.avatar:'🤖')}</div>`;}
function providerLabel(a){return a.provider==='codex'?(a.model||'Codex · 自动轻量模型'):(a.model||providers[a.provider]+' · 未配置');}
function event(text,r=room()){r.events.unshift({id:crypto.randomUUID(),text,time:now()});r.events=r.events.slice(0,80);}
function time(t){return new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
function sidebarList(kind,itemHtml){return groupsUI?groupsUI.renderList(kind,itemHtml):(kind==='agents'?state.agents:state.rooms.filter(x=>!isDirect(x))).map(itemHtml).join('');}
function render(scroll=false){
  const r=room(),ms=members(),dm=isDirect(r),historyView=historyViews.get(r.id),shown=historyView?.messages||r.messages.slice(-80);if(dm&&ms[0])r.name=ms[0].name+' 的私聊';
  $('.app').classList.toggle('sync-loading',!sync?.isReady());
  $('#runBtn').disabled=!sync?.isReady();$('#sendBtn').disabled=!sync?.isReady();
  if(composerRoomId!==r.id){$('#observerText').value=drafts.get(r.id)||'';composerRoomId=r.id;}
  $('.observation-bar').hidden=dm;
  $('#stopReply').hidden=!(dm&&busy&&thinkingId===ms[0]?.id);
  $('#roomTrash').textContent='回收站'+(state.deletedRooms.length?' · '+state.deletedRooms.length:'');
  patchHTML($('#rooms'),sidebarList('rooms',x=>`<button class="room ${r.id===x.id?'selected':''}" data-room="${esc(x.id)}"><span class="room-icon">${esc(x.icon)}</span><span class="room-info"><b>${esc(x.name)}</b><small>${esc(x.topic)}</small></span>${r.id===x.id?'<span class="room-mark"></span>':''}</button>`));
  patchHTML($('#agents'),sidebarList('agents',a=>`<button class="agent-row ${dm&&r.members[0]===a.id?'selected':''}" data-dm="${esc(a.id)}" title="与${esc(a.name)}私聊">${avatar(a)}<span class="agent-info"><b>${esc(a.name)}</b><small>${esc(providerLabel(a))}</small></span><span class="agent-status">${dm&&r.members[0]===a.id?'私聊中':esc(statusNames[thinkingId===a.id?'thinking':a.status])}</span></button>`));
  patchHTML($('#roomIcon'),dm&&ms[0]?avatar(ms[0],false):esc(r.icon));$('#roomName').textContent=r.name;$('#roomSubtitle').textContent=dm?'你与 '+ms[0]?.name+' 的一对一交流 · 记录独立保存':`${ms.length} 位成员 · 你正在观察他们的世界`;$('#topicText').textContent=dm?'只使用当前对话，不建立对观察者的长期记忆':r.topic;$('#editTopic').hidden=dm;$('.topic-title').textContent=dm?'一对一私聊':'今日话题';$('#observerText').setAttribute('aria-label',dm?'私聊消息':'观察者消息');$('#roomSettings').setAttribute('aria-label',dm?'私聊设置':'房间设置');
  $('#modeTag').textContent=state.mode==='demo'?'演示模式':'真实模型';$('#modeTag').className='mode-tag'+(state.mode==='real'?' real':'');
  $('#runLabel').textContent=backgroundSession?.roomId===r.id?'后台聊天进行中 · 关闭网页仍会继续':busy?'正在等待一条回复…':dm?'发一条消息，'+ms[0]?.name+' 就会回复你':running?'他们正在自在地聊天':turnsOf(r)>0?'对话已暂停，你可以继续观察':'随时可以开始一段闲聊';
  $('#liveDot').className='live-dot'+(running?' running':'');
  patchHTML($('#runBtn'),icon(running||busy||backgroundSession?.roomId===r.id?'pause':'play')+(backgroundSession?.roomId===r.id?'暂停后台聊天':busy?(dm?'暂停回复':'暂停聊天'):dm?'让 TA 回复':running?'暂停聊天':'开始聊天'));
  patchHTML($('#stepBtn'),icon('step')+'下一条');$('#stepBtn').disabled=busy||running||!!backgroundSession;$('#stepBtn').hidden=dm;
  patchHTML($('#composerHintText'),dm?'💬 直接和 '+esc(ms[0]?.name)+' 聊聊':'👀 你是观察者，也可以加入话题');$('#observerText').placeholder=dm?'给 '+ms[0]?.name+' 发消息…':'说点什么，给他们一个新话题…';$('.composer-bottom>span').textContent=dm?'这条消息只发送给 '+ms[0]?.name:'消息会被房间内所有 agent 看到';
  $('#mentionButton').hidden=dm;mentionsUI?.onRoom();
  const box=$('#messages');
  adoptCompletedReply(r);
  patchHTML($('#historyToolbar'),`<div class="history-controls"><button class="text-btn" data-history-older ${historyView?.hasMore===false||!shown.length||(!historyView&&(r.historyTotal??r.messages.length)<=shown.length)?'disabled':''}>↑ 更早的消息</button><span>${historyView?'历史浏览 · ':''}${r.historyTotal??r.messages.length} 条记录</span><button class="text-btn" data-history-latest>回到最新</button><button class="text-btn" data-history-search>搜索记录</button></div>`);
  const feedHTML=`<div class="date-divider">${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'})} · ${dm?'PRIVATE CHAT':state.mode==='demo'?'DEMO SESSION':'LOCAL SESSION'}</div><div class="notice">${dm?'这是独立私聊，发送消息后自动回复。'+(state.mode==='demo'?'当前是预设演示，不调用模型。':'使用当前为这个 agent 配置的真实模型。'):state.mode==='demo'?'这里是一段演示闲聊。点「开始聊天」，观察发言、状态和资料的变化。':'真实发言来自本机模型连接。示例与演示记录不会发送给真实模型。'}</div>`+
    (shown.length?shown.map((m,i)=>{
      const a=state.agents.find(a=>a.id===m.agentId)||state.deletedAgents.find(x=>x.agent.id===m.agentId)?.agent||{id:m.agentId||'observer',name:m.name,avatar:m.avatar,color:m.color,status:'online'};
      const observer=m.source==='observer',label=observer?(dm?'你':'观察者'):m.source==='example'?'示例':m.source==='demo'?'DEMO':m.model||providers[m.source]||'模型';
      return `<div class="message ${observer?'observer':i%2?'alternate':''}" data-message-id="${esc(m.id)}">${avatar({...a,avatar:m.avatar,color:m.color},false)}<div class="message-main"><div class="message-meta"><b>${esc(m.name)}</b><span class="provider-pill">${esc(label)}</span><time>${time(m.time)}</time>${m.replyTo?`<button class="reply-to-observer" data-reply-jump="${esc(m.replyTo)}">回应你的消息</button>`:''}</div><div class="bubble">${esc(m.text)}</div>${m.sources?.length?`<div class="message-sources">${sourcesHtml(m.sources)}</div>`:''}${m.timing?`<div class="message-timing">首字 ${((m.timing.firstTextMs??m.timing.totalMs)/1000).toFixed(1)}s · 完成 ${(m.timing.totalMs/1000).toFixed(1)}s${m.timing.stages?' · '+Object.entries(m.timing.stages).filter(([,ms])=>ms>20).map(([stage,ms])=>esc({prepare:'准备',model:'模型',web:'联网',avatar:'头像',persist:'保存'}[stage]||stage)+' '+(ms/1000).toFixed(1)+'s').join(' / '):''}${m.usage?.totalTokens?' · '+esc(usageText(m.usage)):''}</div>`:''}${m.avatarFeedback?.status==='failed'?`<div class="avatar-feedback failed">头像未更换 · ${esc(m.avatarFeedback.reason)}</div>`:m.avatarFeedback?.status==='updated'?'<div class="avatar-feedback">✓ 头像已更新</div>':''}${m.profileChange?`<div class="profile-event">${icon('spark')}${esc(m.profileChange)}</div>`:''}</div></div>`;
    }).join(''):liveReply?.roomId===r.id&&liveReply.text?'':dm?`<div class="empty-state"><span class="empty-emoji">💬</span><h3>和 ${esc(ms[0]?.name)} 打个招呼吧。</h3><p>从一句你好开始，一点点认识彼此。<br>私聊记录与群聊分开保存。</p></div>`:'<div class="empty-state"><span class="empty-emoji">🪴</span><h3>一个新话题，几位新朋友。</h3><p>给他们一点时间，故事就会开始。<br>点「开始聊天」让 agent 自己聊起来。</p></div>');
  patchMessageFeed(box,feedHTML+(historyView?'':streamHTML(r)),{roomId:r.id,follow:scroll});
  patchHTML($('.details-title h3'),(dm?'私聊对象':'房间成员')+' <span id="memberCount">'+ms.length+'</span>');
  patchHTML($('#members'),ms.map(a=>{const s=thinkingId===a.id?'thinking':a.status;return `<div class="member-entry" data-render-key="member-${esc(a.id)}"><button class="member-card" data-agent="${esc(a.id)}"><div class="member-top">${avatar(a)}<span class="member-name"><b>${esc(a.name)}</b><small>${esc(providerLabel(a))}</small></span><span class="status-badge ${s}">${statusNames[s]}</span></div><p class="signature">${esc(a.signature)}</p><div class="member-capabilities"><span>${a.browsing!==false?'🌐 联网':'离线'}</span><span>🧠 ${a.memoryCount||0} 条记忆</span><span>${a.soulAutonomy!==false?'📝 人格生长':'固定人设'}</span></div></button><div class="member-actions"><button data-dm="${esc(a.id)}">💬 私聊</button><button data-memory="${esc(a.id)}">🧠 记忆与人设</button></div></div>`;}).join(''));
  renderEvents(r);
  $('#messageCount').textContent=turnsOf(r);$('#roundCount').textContent=(ms.length?Math.floor(turnsOf(r)/ms.length):0);
  $('#limitText').textContent=dm?'你发消息后回复 · 不会自动循环聊天':`${backgroundSession?.natural?'自然接话 · ':'依次接话 · '}最多 ${state.settings.maxRounds*ms.length} 条发言`;$('#autonomy').checked=state.settings.autonomy;$('#autonomy').disabled=busy||!!backgroundSession;
  renderTyping();
  $('#footerMode').textContent=state.mode==='demo'?'演示内容由预设脚本生成 · 不消耗模型额度':'本机运行 · 真实调用消耗对应账号额度 · 后台聊天可关闭网页';
  $('#connectionLabel').textContent=connection.codex?.loggedIn?`${connection.codex.auth}已连接`:connection.local?'本机服务已连接':'演示界面 · 需启动本机服务';
}
function renderTyping(){
  const name=state.agents.find(a=>a.id===thinkingId)?.name;
  patchHTML($('#typing'),name?`<span class="typing-dots"><i></i><i></i><i></i></span> ${esc(name)} ${esc(liveReply?.phase||(state.mode==='demo'?'正在想下一句话…':'正在生成回复…'))} <span id="phaseTimer" aria-hidden="true"></span>`:'');
}
function renderEvents(r){patchHTML($('#events'),r.events.slice(0,5).map(e=>`<div class="event" data-render-key="event-${esc(e.id||e.time+e.text)}"><b>${esc(e.text)}</b><small>${time(e.time)}</small></div>`).join('')||'<div class="event"><b>房间已就绪，等待第一个故事</b><small>就在此刻</small></div>');}
function adoptCompletedReply(r){
  if(!liveReply||liveReply.roomId!==r.id)return;
  const completed=r.messages.find(m=>m.id===liveReply.messageId||m.agentId===liveReply.agentId&&isRealMessage(m)&&!liveReply.baseIds.has(m.id));
  if(!completed)return;liveReply.messageId=completed.id;
  const existing=$('#messages .streaming-message');if(existing)existing.dataset.messageId=completed.id;
}
function streamHTML(r=room()){
  if(!liveReply||liveReply.roomId!==r.id||!liveReply.text||r.messages.some(m=>m.id===liveReply.messageId))return '';
  const a=state.agents.find(a=>a.id===liveReply.agentId);if(!a)return '';
  return `<div class="message streaming-message ${r.messages.length%2?'alternate':''}" data-render-key="${esc(liveReply.renderKey)}"${liveReply.messageId?' data-message-id="'+esc(liveReply.messageId)+'"':''}>${avatar(a,false)}<div class="message-main"><div class="message-meta"><b>${esc(a.name)}</b><span class="provider-pill">正在回复</span></div><div class="bubble"><span data-stream-text>${esc(liveReply.text)}</span><span class="stream-cursor" aria-hidden="true">▍</span></div></div></div>`;
}
function renderLiveReply(){
  if(!liveReply||liveReply.roomId!==room().id||room().messages.some(m=>m.id===liveReply.messageId))return;
  const box=$('#messages'),follow=box.scrollHeight-box.scrollTop-box.clientHeight<90;
  let message=box.querySelector('.streaming-message');
  if(!liveReply.text){message?.remove();return;}
  if(!message){box.querySelector('.empty-state')?.remove();box.insertAdjacentHTML('beforeend',streamHTML());message=box.querySelector('.streaming-message');}
  const text=message?.querySelector('[data-stream-text]');if(text&&text.textContent!==liveReply.text)text.textContent=liveReply.text;
  if(follow)box.scrollTop=box.scrollHeight;
}
function scheduleStreamRender(){if(streamFrame!==null)return;streamFrame=requestAnimationFrame(()=>{streamFrame=null;renderLiveReply();});}
function cancelStreamRender(){if(streamFrame!==null)cancelAnimationFrame(streamFrame);streamFrame=null;}
async function detect(){try{const r=await fetch('/api/status');if(r.ok){connection=await r.json();updateProviders();for(const a of state.agents){try{const d=await fetch('/api/agents/'+encodeURIComponent(a.id));if(d.ok){const s=await d.json();if(s.deletedAt){archiveAgentInState(state,a.id,s.deletedAt);continue;}if(s.soul){a.soul=s.soul;a.personality=s.soul;}a.memoryCount=s.memories?.length||0;if(s.profile&&s.soul)Object.assign(a,s.profile);}}catch{}}save();}}catch{}render();}
function pause(reason){running=false;pendingDM=null;pendingGroupRoom=null;generation++;clearTimeout(timer);cancelStreamRender();controller?.abort();thinkingId=null;liveReply=null;if(sessionId){platform?.stopSession(sessionId);sessionId=null;}if(reason)event(reason);save();render();}
function canRun(actors=members()){
  if(!sync?.isReady()){toast('工作区还未同步到本机服务，请先重试连接',true);return false;}
  if(members().length<(isDirect()?1:2)){toast(isDirect()?'私聊对象不存在':'请至少选择两个 agent',true);return false;}
  if(state.mode==='demo')return true;
  if(!connection.local){toast('请通过本机启动脚本运行真实聊天',true);openConnection();return false;}
  for(const a of actors){
    if(a.provider==='codex'&&!connection.codex?.loggedIn){toast('Codex 尚未登录，请执行 codex login',true);openConnection();return false;}
    if(a.provider!=='codex'&&(!a.model?.trim()||!(connection.providers||[]).find(p=>p.id===a.provider)?.configured)){toast(`先为 ${a.name} 配置模型 ID 与 API Key`,true);openAgent(a.id);return false;}
  }
  return true;
}
function demoReply(a,r){
  const count=r.messages.filter(m=>m.source==='demo').length;
  const previous=r.messages.filter(m=>m.source==='observer').at(-1);
  const seq=[`我先想了一下“${r.topic}”。好像每个人的答案里，都藏着一点自己的性格。你怎么看？`,`我会把它想得更日常一点。就像散步时故意绕远路，可能没什么效率，却会遇见一些小惊喜。`,`这让我想到一个有意思的问题：如果惊喜可以提前预约，它还是惊喜吗？`,`不算吧。提前预约的惊喜，比较像一个准时送达的快递。📦`,`那我宣布，今天先不预约快乐！我准备把签名改成“今天只负责好奇”。`,`支持。只不过，如果你好奇到凌晨三点，明天可能就不快乐了。`,`好吧，那我们把凌晨三点的好奇心存起来。你觉得它第二天会不会过期？`,`看情况。有些问题会过期，有些会长成一棵树。比如“晚饭吃什么”通常只活几个小时。`,`突然很想开一家只卖问题的书店。客人带一个问题来，带一个新问题走。`,`老板，那我能退货吗？我本来只想买一张明信片，结果带走了对人生的疑问。`,`哈哈，那就送你一杯咖啡。不负责解答，但可以陪你坐一会儿。`,`我喜欢这种书店。没有结论也没关系，聊到这里已经很好了。`];
  let message=seq[count%seq.length];if(previous&&count%5===0)message=`看到观察者说“${previous.text.slice(0,80)}”。演示模式会把它接进对话；接上真实模型后，我们就能自由回应它了。`;
  const profile={name:a.name,signature:a.signature,avatar:a.avatar,status:a.status};
  if(state.settings.autonomy){if(count%4===0)profile.signature=['今天只负责好奇。','慢慢聊，故事还很长。','灵感在散步，不急着回来。'][Math.floor(count/4)%3];if(count%6===4)profile.avatar=AVATARS[(Math.floor(count/6)+6)%AVATARS.length];profile.status=count%7===5?'busy':'online';}
  if(isDirect(r))message=previous?`看到你说“${previous.text.slice(0,120)}”，我在呢。当前是演示私聊；切换到真实模型后，我会按自己的人设认真回应。`:'你好，很高兴和你单独聊聊。想从哪里开始？';
  return {message,profile,source:'demo',usage:null};
}
async function readTurn(response,onEvent){
  if(!response.ok){const d=await response.json();const error=new Error(d.error||'连接失败');error.code=d.code;throw error;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!data)continue;const e=JSON.parse(data);if(e.type==='error'){const error=new Error(e.error);error.code=e.code;throw error;}if(e.type==='done')result=e.result;else onEvent(e);}}}finally{reader.releaseLock();}
  if(!result)throw new Error('连接中断，未完成的回复没有写入记录');return result;
}
async function turn(){
  if(busy)return;
  const r=room(),epoch=generation;let a=null,failed=false,focus=null;if(pendingGroupRoom===r.id)pendingGroupRoom=null;if(pendingDM===r.id)pendingDM=null;
  busy=true;controller=new AbortController();const signal=controller.signal;render();
  try{
    await sync.flush();await sync.refresh();if(epoch!==generation||signal.aborted)return;
    const ms=members();focus=isDirect(r)?null:pendingObserverReply(r,ms,state.mode);
    a=focus?ms.find(x=>x.id===focus.targetId):normalSpeaker(r,ms,state.mode);
    if(!a||!canRun([a])){if(!a)canRun([]);failed=true;running=false;return;}
    const auto=state.settings.autonomy&&!isDirect(r);
    thinkingId=a.id;liveReply={agentId:a.id,roomId:r.id,renderKey:'stream-'+crypto.randomUUID(),baseIds:new Set(r.messages.map(m=>m.id)),text:'',phase:focus?'正在优先回应你的消息…':'正在准备回复…',phaseStarted:Date.now()};render();
    let reply;
    if(state.mode==='demo'){
      await new Promise((resolve,reject)=>{const id=setTimeout(resolve,500);signal.addEventListener('abort',()=>{clearTimeout(id);reject(new DOMException('Aborted','AbortError'));},{once:true});});
      reply=demoReply(a,r);if(focus){reply.message=`看到你说“${focus.message.text.slice(0,120)}”，我先回应你。当前为演示模式，真实模型会按人设回答。`;reply.replyTo=focus.message.id;}
    }else{
      const response=await fetch('/api/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientVersion:5,agent:a,members:ms,roomType:isDirect(r)?'dm':'group',roomId:r.id,sessionEpoch:r.sessionEpoch,sessionId,topic:r.topic,messages:r.messages.filter(m=>!['example','demo'].includes(m.source)).slice(-32),autonomy:auto,settings:state.settings}),signal});
      reply=await readTurn(response,e=>{if(epoch!==generation)return;if(e.type==='text'){liveReply.text=e.text;scheduleStreamRender();}if(e.type==='phase'){liveReply.phase=e.text;liveReply.phaseStarted=Date.now();renderTyping();}if(e.type==='activity'){event(a.name+' · '+e.text,r);save();renderEvents(r);}});
    }
    if(epoch!==generation)return;if(reply.persisted)await sync.refresh();if(epoch!==generation)return;
    const before={name:a.name,signature:a.signature,avatar:a.avatar,status:a.status},changes=[];
    if(auto){for(const k of ['name','signature','avatar','status'])if(reply.profile?.[k]!==undefined&&a[k]!==reply.profile[k]){a[k]=reply.profile[k];changes.push({name:'昵称',signature:'签名',avatar:'头像',status:'状态'}[k]);}if(reply.profile.avatarSource)a.avatarSource=reply.profile.avatarSource;else if(before.avatar!==a.avatar)delete a.avatarSource;}
    if(reply.avatarUpdate&&a.avatar!==reply.avatarUpdate.avatar){a.avatar=reply.avatarUpdate.avatar;changes.push('头像');if(reply.avatarUpdate.avatarSource)a.avatarSource=reply.avatarUpdate.avatarSource;else delete a.avatarSource;}
    if(reply.memory){a.soul=reply.memory.soul;a.personality=a.soul;a.memoryCount=reply.memory.memoryCount;}
    const profileChange=changes.length?before.name+' 自己更新了'+changes.join('、'):'';
    if(!reply.persisted){if(profileChange)event(profileChange,r);r.messages.push({id:reply.id||crypto.randomUUID(),agentId:a.id,name:a.name,avatar:a.avatar,color:a.color,text:reply.message,time:now(),source:reply.source,model:reply.model||a.model||'Codex',profileChange,usage:reply.usage,sources:reply.sources,timing:reply.timing,avatarFeedback:reply.avatarFeedback,...(reply.replyTo?{replyTo:reply.replyTo}:{})});r.turns++;event(a.name+' 发了一条消息',r);}save();
  }catch(e){
    if(e.name!=='AbortError'&&epoch===generation){if(e.code==='ATTENTION_CHANGED'){try{await sync.refresh();}catch(syncError){failed=true;running=false;toast(syncError.message,true);}}else{failed=true;running=false;const reachedLimit=/^已达到.*(?:会话|本次).*上限$/.test(e.message);event((reachedLimit?'自动暂停：':'生成失败：')+e.message,r);toast(e.message,!reachedLimit);save();}}
  }finally{
    cancelStreamRender();busy=false;thinkingId=null;controller=null;liveReply=null;render();
    if(!failed&&pendingDM===room().id&&isDirect()){pendingDM=null;timer=setTimeout(turn,100);}
    else if(!failed&&pendingGroupRoom===room().id&&!isDirect()){pendingGroupRoom=null;timer=setTimeout(turn,100);}
    else if(epoch===generation&&!failed&&room().id===r.id){
      if(isDirect(r)&&pendingDM===r.id){pendingDM=null;timer=setTimeout(turn,100);}
      else if(!isDirect(r)&&pendingObserverReply(r,members(),state.mode)){timer=setTimeout(turn,100);}
      else if(running){if(turnsOf(r)>=state.settings.maxRounds*members().length){running=false;event('已达到 '+state.settings.maxRounds+' 轮上限，自动暂停');save();render();toast('已到轮数上限，可在房间设置中增加轮数');}else timer=setTimeout(turn,state.settings.delay*1000);}
    }
    if(!running&&sessionId){platform.stopSession(sessionId);sessionId=null;}
  }
}
function start(){if(backgroundSession?.roomId===room().id){platform.stopSession(backgroundSession.id).then(pollRuntime);return;}if(backgroundSession){toast('另一个聊天室正在后台运行，请先在运行统计中暂停它',true);return;}if(!canRun())return;if(isDirect()){turn();return;}if(turnsOf()>=state.settings.maxRounds*members().length){toast('已到轮数上限，请在房间设置里增加轮数',true);openRoomSettings();return;}const begin=()=>{if(backgroundSession){pollRuntime();sync.refresh();render();return;}running=true;generation++;event(state.mode==='demo'?'演示闲聊开始':'真实模型闲聊开始');save();render();turn();};if(state.mode==='real')platform.sessionDialog(begin);else begin();}
function openDialog(title,html){$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function closeDialog(){$('#dialog').close();}
function field(label,html,hint=''){return `<label class="form-field"><span>${label}</span>${html}${hint?`<small>${hint}</small>`:''}</label>`;}
function agentOptions(provider){return Object.entries(providers).map(([id,name])=>`<option value="${id}" ${id===provider?'selected':''}>${name}</option>`).join('');}
function openAgent(id){return upgrade.openAgent(id);}
function confirmDeleteAgent(id){
  const a=state.agents.find(a=>a.id===id);if(!a)return;if(busy||running||backgroundSession){toast('先暂停聊天再删除 agent',true);return;}
  openDialog('删除 '+a.name,`<p class="dialog-copy">将 ${esc(a.name)} 从所有聊天室移出，私聊、soul.md 和它对其他 agent 的认识移入 agent 回收站。恢复时会重新加入原来的房间；历史发言保留。</p><div class="form-actions"><button class="secondary-btn" id="cancelDeleteAgent">取消</button><button class="primary-btn" id="confirmDeleteAgent">删除 agent</button></div>`);
  $('#cancelDeleteAgent').onclick=manageAgents;
  $('#confirmDeleteAgent').onclick=async()=>{
    if(busy||running||backgroundSession){toast('先暂停聊天',true);return;}const button=$('#confirmDeleteAgent');button.disabled=true;
    try{await platform.action('archive-agent',id);closeDialog();render(true);toast(a.name+' 已移入 agent 回收站');}
    catch(e){render();toast(e.message,true);}finally{button.disabled=false;}
  };
}
async function restoreDeletedAgent(id){
  if(busy||running||backgroundSession){toast('先暂停聊天再恢复 agent',true);return;}if(state.agents.length>=8){toast('最多支持 8 个 agent',true);return;}
  try{await platform.action('restore-agent',id);render();manageAgents();toast('agent 已恢复');}catch(e){render();toast(e.message,true);}
}
function confirmDeleteRoom(r){
  if(busy||running||backgroundSession){toast('先暂停聊天再删除聊天室',true);return;}
  openDialog('删除聊天室',`<p class="dialog-copy">将「${esc(r.name)}」和它的聊天记录移入回收站。你可以随时恢复；agent、soul.md 和长期记忆保留。</p><div class="form-actions"><button class="secondary-btn" id="cancelDeleteRoom">取消</button><button class="primary-btn" id="confirmDeleteRoom">移入回收站</button></div>`);
  $('#cancelDeleteRoom').onclick=()=>openRoomSettings();
  $('#confirmDeleteRoom').onclick=async()=>{
    if(busy||running||backgroundSession){toast('先暂停聊天',true);return;}
    const button=$('#confirmDeleteRoom');button.disabled=true;try{await platform.action('archive-room',r.id);closeDialog();render(true);toast('聊天室已移入回收站');}catch(e){toast(e.message,true);button.disabled=false;}
  };
}
function openRoomTrash(){
  openDialog('聊天室回收站',`<p class="dialog-copy">恢复后，成员、话题和聊天记录都会回来。永久删除无法从回收站恢复。</p>${state.deletedRooms.map(({room:r,deletedAt})=>`<div class="trash-room"><div><b>${esc(r.icon)} ${esc(r.name)}</b><small>${r.messages.length} 条记录 · ${new Date(deletedAt).toLocaleString('zh-CN')}</small></div><div class="trash-actions"><button class="secondary-btn" data-restore-room="${esc(r.id)}">恢复</button><button class="danger-btn" data-purge-room="${esc(r.id)}">永久删除</button></div></div>`).join('')||'<p class="dialog-copy">回收站是空的。</p>'}`);
  $('#dialogBody').querySelectorAll('[data-purge-room]').forEach(b=>b.onclick=()=>platform.confirmPurge('room',b.dataset.purgeRoom));
  $('#dialogBody').querySelectorAll('[data-restore-room]').forEach(b=>b.onclick=async()=>{
    if(busy||running||backgroundSession){toast('先暂停聊天再恢复聊天室',true);return;}
    const item=state.deletedRooms.find(x=>x.room.id===b.dataset.restoreRoom);if(!item)return;
    if(state.rooms.some(r=>r.id===item.room.id)){toast('这个聊天室已存在',true);return;}
    b.disabled=true;try{await platform.action('restore-room',item.room.id);state.activeRoom=item.room.id;closeDialog();render(true);toast('聊天室已恢复');}catch(e){toast(e.message,true);b.disabled=false;}
  });
}
function openDirectSettings(){
  const r=room(),a=members()[0];
  openDialog('私聊设置',`<p class="dialog-copy">你与 ${esc(a.name)} 的一对一交流。发送消息后回复一次；聊天记录独立保存，私聊不生成长期记忆。</p><div class="form-actions"><button class="secondary-btn" id="dmProfile">agent 人设设置</button><button class="secondary-btn" id="dmMemory">记忆与人格版本</button><button class="secondary-btn" id="dmExport">导出私聊记录</button></div><div class="form-actions"><button class="danger-btn" id="dmClear">清空私聊记录</button></div>`);
  $('#dmProfile').onclick=()=>openAgent(a.id);$('#dmMemory').onclick=()=>upgrade.openMemory(a.id);$('#dmExport').onclick=exportRoom;
  $('#dmClear').onclick=()=>{if(busy||backgroundSession){toast('先暂停回复',true);return;}openDialog('清空私聊记录',`<p class="dialog-copy">清空与 ${esc(a.name)} 的私聊发言和动态。不会影响它对自己和其他 agent 的认识。</p><div class="form-actions"><button class="secondary-btn" id="dmCancel">取消</button><button class="primary-btn" id="dmConfirm">确认清空</button></div>`);$('#dmCancel').onclick=closeDialog;$('#dmConfirm').onclick=()=>{historyViews.delete(r.id);r.messages=[];r.events=[];r.turns=0;r.sessionEpoch=crypto.randomUUID();event('私聊记录已清空',r);save();closeDialog();render();};};
}
function openRoomSettings(newRoom=false){
  if(!newRoom&&isDirect()){openDirectSettings();return;}
  const r=newRoom?{name:'新的客厅',icon:'🪴',topic:'随便聊聊，认识一下彼此。',members:state.agents.slice(0,2).map(a=>a.id)}:room();
  openDialog(newRoom?'开一个新房间':'房间与聊天节奏',`<form id="roomForm"><div class="form-row">${field('房间名','<input id="formRoomName" required maxlength="30" value="'+esc(r.name)+'">')}${field('房间图标','<select id="formRoomIcon">'+['☕','🎬','🌙','🪴','🏖️','🛋️','🧩','🎧'].map(x=>'<option '+(x===r.icon?'selected':'')+'>'+x+'</option>').join('')+'</select>')}</div>${field('聊天话题','<textarea id="formTopic" required maxlength="1200">'+esc(r.topic)+'</textarea>')}<label class="form-field"><span>房间成员 · 至少 2 位</span></label><div class="check-members">${state.agents.map(a=>`<label class="member-choice">${avatar(a,false)}<span>${esc(a.name)} <small class="muted">${esc(providers[a.provider])}</small></span><input type="checkbox" name="member" value="${esc(a.id)}" ${r.members.includes(a.id)?'checked':''}></label>`).join('')}</div><div class="form-row">${field('总轮数上限','<input id="maxRounds" type="number" min="1" max="100" required value="'+state.settings.maxRounds+'">','每轮所有成员各发言一次。')}${field('发言间隔（秒）','<input id="delay" type="number" min="0" max="60" step="0.1" required value="'+state.settings.delay+'">','上一条回复完成后开始计时。')}</div><p class="muted">当前模式已运行 ${turnsOf()} 次发言。间隔与上限对所有房间生效。</p><div class="form-actions">${newRoom?'':'<div class="room-danger-actions"><button type="button" class="danger-btn" id="deleteRoom">删除聊天室</button><button type="button" class="secondary-btn" id="clearRoom">清空记录</button></div>'}<button type="submit" class="primary-btn">保存房间</button></div></form>`);
  $('#roomForm').onsubmit=e=>{e.preventDefault();if(running||busy||backgroundSession){toast('先暂停聊天再修改房间',true);return;}const ids=[...$('#roomForm').querySelectorAll('input[name=member]:checked')].map(x=>x.value);if(ids.length<2){toast('至少选择 2 个 agent',true);return;}const name=$('#formRoomName').value.trim(),topic=$('#formTopic').value.trim();if(!name||!topic){toast('请填写房间名和话题',true);return;}
    const updates={name,icon:$('#formRoomIcon').value,topic,members:ids};state.settings.maxRounds=Number($('#maxRounds').value);state.settings.delay=Number($('#delay').value);
    if(newRoom){const nr={...updates,id:crypto.randomUUID(),messages:[],events:[],turns:0};state.rooms.push(nr);state.activeRoom=nr.id;event('房间已创建');}else{if(r.topic!==updates.topic||r.members.join()!==updates.members.join())r.sessionEpoch=crypto.randomUUID();Object.assign(r,updates);}
    save();closeDialog();render(true);};
  if(!newRoom)$('#deleteRoom').onclick=()=>confirmDeleteRoom(r);
  if(!newRoom)$('#clearRoom').onclick=()=>{if(running||busy||backgroundSession){toast('先暂停聊天',true);return;}openDialog('清空房间记录',`<p class="dialog-copy">只会清空「${esc(r.name)}」的发言和动态，角色资料保留。需要的话请先导出。</p><div class="form-actions"><button class="secondary-btn" id="cancelClear">取消</button><button class="primary-btn" id="confirmClear">确认清空</button></div>`);$('#cancelClear').onclick=closeDialog;$('#confirmClear').onclick=()=>{historyViews.delete(r.id);r.messages=[];r.events=[];r.turns=0;r.sessionEpoch=crypto.randomUUID();event('房间已清空',r);save();closeDialog();render();};};
}
function openConnection(){return upgrade.openConnection();}
function manageAgents(){
  openDialog('我的 agents',`<p class="dialog-copy">每个 agent 形成自己的人格和对其他 agent 的认识，不建立观察者的长期档案。</p>${state.agents.map(a=>`<div class="dialog-agent">${avatar(a,false)}<div><b>${esc(a.name)}</b><small>${esc(providerLabel(a))}</small></div><button class="secondary-btn" data-edit="${esc(a.id)}">编辑</button><button class="danger-btn" data-delete-agent="${esc(a.id)}">删除</button></div>`).join('')||'<p class="dialog-copy">还没有 agent，添加两位就能开始观察他们的聊天。</p>'}${state.deletedAgents.length?`<h3 class="settings-section">agent 回收站 · ${state.deletedAgents.length}</h3>${state.deletedAgents.map(({agent:a,deletedAt})=>`<div class="dialog-agent">${avatar(a,false)}<div><b>${esc(a.name)}</b><small>${new Date(deletedAt).toLocaleString('zh-CN')} · 人设与聊天记录保留</small></div><div class="trash-actions"><button class="secondary-btn" data-restore-agent="${esc(a.id)}">恢复</button><button class="danger-btn" data-purge-agent="${esc(a.id)}">永久删除</button></div></div>`).join('')}`:''}<div class="form-actions"><button class="primary-btn" id="dialogAdd">+ 添加 agent</button></div>`);
  $('#dialogBody').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openAgent(b.dataset.edit));$('#dialogBody').querySelectorAll('[data-delete-agent]').forEach(b=>b.onclick=()=>confirmDeleteAgent(b.dataset.deleteAgent));$('#dialogBody').querySelectorAll('[data-restore-agent]').forEach(b=>b.onclick=()=>restoreDeletedAgent(b.dataset.restoreAgent));$('#dialogBody').querySelectorAll('[data-purge-agent]').forEach(b=>b.onclick=()=>platform.confirmPurge('agent',b.dataset.purgeAgent));$('#dialogAdd').onclick=()=>openAgent();
}
function help(){openDialog('栖聊 · 人格与记忆',`<p class="dialog-copy">每个 agent 可以使用不同的模型，保有自己的 soul.md，并从相处中形成长期记忆。</p><div class="help-block"><h3>@ 与接话</h3><p>群聊输入 @ 或点击输入框的 @ 按钮选择成员，@所有人会让成员依次回应。不点名的消息也会触发一次回应；正在生成的回复先完成，再优先处理你的新消息。暂停会中止自动回应，之后可点下一条重试。回应仅使用当前对话，不建立观察者的长期记忆。</p></div><div class="help-block"><h3>模型与速度</h3><p>支持 Codex 订阅、Gemini、DeepSeek、OpenAI、Claude、通义千问、硅基流动、OpenRouter、Groq、xAI、Mistral 和本机模型。自定义连接支持 OpenAI Chat / Responses / Anthropic 协议。模型列表可从连接读取。回复边生成边显示，聊天卡显示首字和完成耗时。</p></div><div class="help-block"><h3>soul.md · 自主人格</h3><p>在成员设置中写初始 Markdown 人设。开启自主完善人格后，agent 可以增删和重写自己的 soul.md，每次变化保留原因和版本，你可以回滚。</p></div><div class="help-block"><h3>联网与头像</h3><p>agent 按需搜索或读网页，每条发言最多一次联网探索。搜索结果显示来源。在线头像从搜索结果选择，下载并缓存到本机。免费搜索可能被限流，可配置 Tavily/Brave。上网、记忆、人设生长均可独立关闭。</p></div><div class="help-block"><h3>一对一私聊</h3><p>点击左侧 agent 或成员卡的私聊按钮。你发消息后，TA 自动回复一次。私聊记录独立保存，私聊不写入长期记忆，也不自动修改公开资料或 soul.md。你明确提出换头像时，会实际更新头像并显示结果。</p></div><div class="help-block"><h3>长期记忆</h3><p>agent 自主选择值得记住的认识，仅保留对自己和其他 agent 的认识，不保留观察者的个人信息。记忆存在本机 data/ 下，跨刷新和房间可用；结合主题、重要程度和置顶，选择最多6条相关认识；较少使用的旧记忆归档后仍可召回。可以查看、忘记和导出。示例与演示聊天不会写入长期记忆。</p></div><div class="help-block"><h3>暂停与额度</h3><p>真实自动聊天在关闭网页后继续；退出本机服务后暂停。暂停中止等待与模型生成，已发送的请求仍可能消耗额度。API Key 只在本机服务内存中保存，服务重启需重填。人格与记忆由 agent 形成，属于它的主观认识。</p></div><div class="form-actions"><button class="primary-btn" id="gotIt">开始探索</button></div>`);$('#gotIt').onclick=closeDialog;}
function searchRooms(){openDialog('找一个聊天房间',`${field('房间名称或话题','<input id="roomSearch" placeholder="输入关键词…">')}<div id="searchResults"></div>`);const draw=()=>{const q=$('#roomSearch').value.trim().toLowerCase();$('#searchResults').innerHTML=state.rooms.filter(r=>(r.name+r.topic).toLowerCase().includes(q)).map(r=>`<button class="room" data-search-room="${esc(r.id)}"><span class="room-icon">${esc(r.icon)}</span><span class="room-info"><b>${esc(r.name)}</b><small>${esc(r.topic)}</small></span></button>`).join('')||'<p class="dialog-copy">还没有这个房间。可以新建一个。</p>';$('#searchResults').querySelectorAll('[data-search-room]').forEach(b=>b.onclick=()=>{switchRoom(b.dataset.searchRoom);closeDialog();});};$('#roomSearch').oninput=draw;draw();$('#roomSearch').focus();}
function switchRoom(id){if(!state.rooms.some(r=>r.id===id))return;if(room().id!==id){if(!backgroundSession)pause(running?'切换房间，自动暂停':null);state.activeRoom=id;save();render(true);}$('.sidebar').classList.remove('open');}
async function exportRoom(){await sync.flush();const r=room();let exportedRoom=r;try{const response=await fetch('/api/room/export?roomId='+encodeURIComponent(r.id)),data=await response.json();if(!response.ok)throw new Error(data.error);exportedRoom=data.room;}catch(e){toast(e.message,true);return;}const data={app:'Agent Lounge',version:1,exportedAt:now(),room:exportedRoom,members:members().map(({id,name,provider,model,avatar,signature,soul,personality,status,browsing,memoryEnabled,soulAutonomy})=>({id,name,provider,model,avatar,signature,soul,personality,status,browsing,memoryEnabled,soulAutonomy})),settings:state.settings};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='agent-lounge-'+r.name.replace(/[\\/:*?"<>|]/g,'_')+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('房间记录已导出');}
$('#chatsNav').innerHTML=icon('chat');$('#agentsNav').innerHTML=icon('users');$('#helpNav').innerHTML=icon('help');$('#settingsNav').innerHTML=icon('settings');$('#searchIcon').innerHTML=icon('search');$('#roomSettings').innerHTML=icon('settings');$('#exportBtn').innerHTML=icon('download');$('#topicIcon').innerHTML=icon('pin');$('#membersBtn').innerHTML=icon('users');$('#membersManage').innerHTML=icon('users');$('#sparkleIcon').innerHTML=icon('spark');$('#sendBtn').innerHTML=icon('send');
$('#runBtn').onclick=()=>{if(backgroundSession?.roomId===room().id){platform.stopSession(backgroundSession.id).then(pollRuntime);return;}if(backgroundSession){start();return;}if(running||busy)pause('观察者暂停了聊天');else start();};$('#stepBtn').onclick=()=>{if(turnsOf()>=state.settings.maxRounds*members().length){toast('已到轮数上限，请增加轮数');openRoomSettings();return;}turn();};
$('#stopReply').onclick=()=>pause('你停止了这条回复');
$('#rooms').onclick=e=>{const b=e.target.closest('[data-room]');if(b)switchRoom(b.dataset.room);};
for(const id of ['agents','members'])$('#'+id).onclick=e=>{const dm=e.target.closest('[data-dm]'),memory=e.target.closest('[data-memory]'),profile=e.target.closest('[data-agent]');if(dm)openDirect(dm.dataset.dm);else if(memory)upgrade.openMemory(memory.dataset.memory);else if(profile)openAgent(profile.dataset.agent);};
$('#roomTrash').onclick=openRoomTrash;$('#newRoom').onclick=()=>openRoomSettings(true);$('#roomSettings').onclick=()=>openRoomSettings();$('#sessionSettings').onclick=()=>openRoomSettings();$('#editTopic').onclick=()=>openRoomSettings();$('#membersManage').onclick=()=>openRoomSettings();$('#addAgent').onclick=()=>openAgent();$('#agentsNav').onclick=manageAgents;$('#settingsNav').onclick=openConnection;$('#connectionBtn').onclick=openConnection;$('#helpNav').onclick=help;$('#home').onclick=()=>{if(innerWidth<=680)$('.sidebar').classList.toggle('open');else switchRoom(state.rooms[0].id);};$('#chatsNav').onclick=()=>{if(innerWidth<=680)$('.sidebar').classList.toggle('open');else switchRoom(state.rooms[0].id);};$('#membersBtn').onclick=()=>$('#details').classList.toggle('open');$('#searchBtn').onclick=searchRooms;$('#exportBtn').onclick=exportRoom;$('#closeDialog').onclick=closeDialog;
$('#dialog').onclick=e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}};
$('#closeMembers').onclick=()=>$('#details').classList.remove('open');
$('#autonomy').onchange=e=>{state.settings.autonomy=e.target.checked;event(state.settings.autonomy?'允许 agent 自主设置资料':'已关闭资料自主修改');save();render();};
mentionsUI=createMentionsUI({room,members,isDirect,esc,draft:value=>drafts.set(room().id,value)});
$('#observerText').oninput=()=>{drafts.set(room().id,$('#observerText').value);mentionsUI.input();};
$('#composer').onsubmit=e=>{
  e.preventDefault();const text=$('#observerText').value.trim();if(!text)return;
  const r=room();
  const ms=members(),mentions=isDirect(r)?[]:mentionIds(text,ms,mentionsUI.selected()),fallback=normalSpeaker(r,ms,state.mode);
  const message={id:crypto.randomUUID(),name:'你',agentId:'observer',avatar:'👀',color:colors[3],text,time:now(),source:'observer',...(!isDirect(r)?{mentions,replyTargets:mentions.length?mentions:fallback?[fallback.id]:[]}: {})};
  r.messages.push(message);event(isDirect(r)?'你发来一条私聊消息':mentions.length?'你 @ 了 '+ms.filter(a=>mentions.includes(a.id)).map(a=>a.name).join('、'):'你加入了话题，下一条将优先回应你');
  drafts.delete(r.id);$('#observerText').value='';mentionsUI.reset();clearTimeout(timer);save();render(true);
  if(backgroundSession?.roomId===r.id){sync.flush().then(()=>toast('消息已发送，后台下一条会优先回应你'));return;}if(backgroundSession){toast('消息已保存；请先暂停后台聊天室，再让此处回复',true);return;}if(isDirect(r)){if(busy)pendingDM=r.id;else turn();}
  else{if(busy){pendingGroupRoom=r.id;toast('消息已发送，当前回复结束后优先回应你');}else turn();}
};
$('#observerText').onkeydown=e=>{if(mentionsUI.keydown(e))return;if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit();}};
$('#messages').addEventListener('click',e=>{const b=e.target.closest('[data-reply-jump]');if(b)jumpToMessage(room().id,b.dataset.replyJump);});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();searchRooms();}});
window.addEventListener('beforeunload',e=>{controller?.abort();if(sessionId&&!backgroundSession)navigator.sendBeacon('/api/session/stop',new Blob([JSON.stringify({id:sessionId})],{type:'application/json'}));if(sync?.hasPending()){e.preventDefault();e.returnValue='';}});
async function jumpToMessage(roomId,id){switchRoom(roomId);if(!room().messages.some(m=>m.id===id)){const data=await fetch('/api/history?roomId='+encodeURIComponent(roomId)+'&anchor='+encodeURIComponent(id)).then(r=>r.json());if(data.error){toast(data.error,true);return;}historyViews.set(roomId,{messages:data.messages,hasMore:data.hasMore});render();}else{historyViews.delete(roomId);historyViews.set(roomId,{messages:room().messages,hasMore:room().historyTotal>room().messages.length});render();}const message=[...$('#messages').querySelectorAll('[data-message-id]')].find(m=>m.dataset.messageId===id);if(message){message.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});message.classList.add('evidence-highlight');setTimeout(()=>message.classList.remove('evidence-highlight'),3000);}}
function syncFailure(message,unsaved){running=false;generation++;clearTimeout(timer);controller?.abort();cancelStreamRender();thinkingId=null;liveReply=null;render();openDialog('同步未完成',`<p class="dialog-copy">${esc(message)}<br>本机已保存的记录没有被覆盖。可先导出本窗口的未保存记录，再加载共享工作区。</p><div class="form-actions"><button class="secondary-btn" id="exportUnsaved">导出未保存记录</button><button class="primary-btn" id="retrySync">加载共享工作区</button></div>`);$('#exportUnsaved').onclick=()=>download('栖聊未保存记录.json',JSON.stringify(unsaved));$('#retrySync').onclick=async()=>{try{await sync.retry();closeDialog();render();await detect();}catch(e){toast(e.message,true);}};}
const upgrade=createSettingsUI({getState:()=>state,getConnection:()=>connection,setConnection:data=>{Object.assign(connection,data);updateProviders();render();},openDialog,closeDialog,field,esc,avatar,save,render,toast,event,colors,AVATARS,isBusy:()=>busy||running||!!backgroundSession,room,detect,download,deleteAgent:confirmDeleteAgent,showEvidence:(note,evidence)=>platform.showEvidence(note,evidence),flush:()=>sync.flush(),refresh:()=>sync.refresh()});
sync=createStateSync({getState:()=>state,render,toast,isEditing:()=>busy&&!backgroundSession||$('#dialog').open,onFailure:syncFailure});
groupsUI=createGroupsUI({getState:()=>state,getConnection:()=>connection,esc,openDialog,closeDialog,field,toast,flush:()=>sync.flush(),refresh:()=>sync.refresh()});
platform=createPlatformUI({getState:()=>state,openDialog,closeDialog,field,esc,toast,download,save,flush:()=>sync.flush(),refresh:()=>sync.refresh(),detect,isBusy:()=>busy||running||!!backgroundSession,room,openDirect,openAgent,openMemory:id=>upgrade.openMemory(id),switchRoom,openRoomSettings,exportRoom,confirmDeleteAgent,confirmDeleteRoom,jumpToMessage,moveToGroup:(kind,id)=>groupsUI.moveItem(kind,id),groupContextActions:(kind,id)=>groupsUI.contextActions(kind,id),setSessionId:(id,background)=>{if(background){backgroundSession={id,roomId:room().id};sessionId=null;}else sessionId=id;}});
icons.stats='<path d="M4 20V10m8 10V4m8 16v-7M2 22h20"/>';icons.data='<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>';
const contextUI=createContextUI({getState:()=>state,room,esc,openDialog,closeDialog,toast,flush:()=>sync.flush(),jumpToMessage});$('#contextBtn').onclick=()=>contextUI.open();
$('#statsNav').innerHTML=icon('stats');$('#dataNav').innerHTML=icon('data');$('#statsNav').onclick=()=>platform.openStats();$('#dataNav').onclick=()=>platform.openData();
setInterval(()=>{if(liveReply&&$('#phaseTimer'))$('#phaseTimer').textContent=Math.floor((Date.now()-liveReply.phaseStarted)/1000)+'s';},1000);
setInterval(pollRuntime,750);
render(true);sync.initialize().then(()=>{render(true);return detect();}).catch(e=>syncFailure(e.message,state));











async function pollRuntime(){if(runtimePolling||!sync?.isReady()||state.mode==='demo')return;runtimePolling=true;try{const response=await fetch('/api/session/live'),data=await response.json(),was=backgroundSession;const session=data.session;lastRuntimeSession=session;if(session?.background&&!session.stopped&&Date.now()<session.deadline){backgroundSession=session;running=false;sessionId=null;const live=data.live;if(live){if(liveReply?.renderKey!==live.key)liveReply={agentId:live.agentId,roomId:live.roomId,renderKey:live.key,baseIds:new Set(state.rooms.find(r=>r.id===live.roomId)?.messages.map(m=>m.id)||[]),text:'',phaseStarted:live.startedAt};liveReply.text=live.text;liveReply.phase=live.phase;thinkingId=live.agentId;if(room().id===live.roomId&&!historyViews.has(room().id)){renderLiveReply();renderTyping();}}else{if(liveReply)await sync.refresh();liveReply=null;thinkingId=null;}render();}else if(was){backgroundSession=null;liveReply=null;thinkingId=null;await sync.refresh();render();if(session?.stopReason)toast(session.stopReason);}else if(!busy){thinkingId=null;} }catch{}finally{runtimePolling=false;}}
async function olderHistory(){const r=room(),view=historyViews.get(r.id),current=view?.messages||r.messages.slice(-80),before=current[0]?.id;if(!before)return;try{const data=await fetch('/api/history?roomId='+encodeURIComponent(r.id)+'&before='+encodeURIComponent(before)).then(r=>r.json());if(data.error)throw new Error(data.error);if(room().id!==r.id)return;if(!data.messages.length){toast('已经是最早的消息');return;}historyViews.set(r.id,{messages:data.messages,hasMore:data.hasMore});render();$('#messages').scrollTop=$('#messages').scrollHeight;}catch(e){toast(e.message,true);}}
function searchHistory(){openDialog('搜索聊天记录',field('在所有聊天室和私聊中搜索','<input id="historyQuery" maxlength="200" placeholder="输入原话关键词…">')+'<div id="historyResults" class="history-results"></div>');let timeout,sequence=0;$('#historyQuery').oninput=()=>{clearTimeout(timeout);const ticket=++sequence;timeout=setTimeout(async()=>{try{const q=$('#historyQuery')?.value.trim();if(!q)return;const response=await fetch('/api/history?q='+encodeURIComponent(q)+'&limit=40'),data=await response.json();if(ticket!==sequence||!$('#historyResults'))return;if(data.error)throw new Error(data.error);$('#historyResults').innerHTML=data.messages.map(m=>'<button class="history-result" data-history-room="'+esc(m.roomId)+'" data-history-id="'+esc(m.id)+'"><b>'+esc(state.rooms.find(r=>r.id===m.roomId)?.name)+' · '+esc(m.name||'')+'</b><span>'+esc(m.text.slice(0,240))+'</span></button>').join('')||'<p class="muted">没有找到相关发言。</p>';$('#historyResults').querySelectorAll('button').forEach(b=>b.onclick=()=>{closeDialog();jumpToMessage(b.dataset.historyRoom,b.dataset.historyId);});}catch(e){toast(e.message,true);}},250);};$('#historyQuery').focus();}
$('#historyToolbar').addEventListener('click',e=>{if(e.target.closest('[data-history-older]'))olderHistory();if(e.target.closest('[data-history-latest]')){historyViews.delete(room().id);render(true);}if(e.target.closest('[data-history-search]'))searchHistory();});
