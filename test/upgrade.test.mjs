import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
const testRoot=path.resolve(import.meta.dirname,'../work/test-data');
import path from 'node:path';
import {MemoryStore} from '../memory.mjs';
import {sseFrames,modelReply,ProviderRegistry} from '../providers.mjs';
import {streamedMessage,makePrompt,validateTurn,explicitAvatarRequest} from '../core.mjs';
import {generateTurn} from '../chat-engine.mjs';
import {webUrl,publicAddress} from '../internet.mjs';
import {validateProvider} from '../provider-catalog.mjs';
test('streaming survives one-byte UTF-8 chunks and split CRLF boundaries',async()=>{const raw=Buffer.from('data: {"message":"你好"}\r\n\r\ndata: [DONE]\r\n\r\n');async function* bytes(){for(const b of raw)yield Uint8Array.of(b);}const frames=[];for await(const f of sseFrames(bytes()))frames.push(f);assert.deepEqual(frames,['{"message":"你好"}','[DONE]']);});
test('partial message never exposes JSON profile or incomplete unicode escape',()=>{assert.equal(streamedMessage('{"message":"hello\\n\\u4f60'),'hello\n你');assert.equal(streamedMessage('{"message":"hello\\u4f'),'hello');assert.equal(streamedMessage('{"message":"hi","soul":"secret"}'),'hi');});
test('all protocols reject token-truncated replies even when the partial text is valid JSON',async()=>{
  const text='{"message":"截断回复"}';
  for(const protocol of ['chat','responses','anthropic'])for(const streaming of [false,true]){
    const d=protocol==='chat'?{choices:[{message:{content:text},finish_reason:'length'}]}:protocol==='anthropic'?{content:[{type:'text',text}],stop_reason:'max_tokens'}:{output:[{content:[{type:'output_text',text}]}],status:'incomplete',incomplete_details:{reason:'max_output_tokens'}};
    const events=protocol==='chat'?[{choices:[{delta:{content:text},finish_reason:'length'}]}]:protocol==='anthropic'?[{type:'content_block_delta',delta:{type:'text_delta',text}},{type:'message_delta',delta:{stop_reason:'max_tokens'}}]:[{type:'response.output_text.delta',delta:text},{type:'response.incomplete',response:d}];
    const fake=async()=>new Response(streaming?events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''):JSON.stringify(d),{headers:{'content-type':streaming?'text/event-stream':'application/json'}});
    await assert.rejects(()=>modelReply({protocol,baseUrl:'https://fixture.test/v1',auth:'none',name:'fixture'},{model:'fixture'},{instructions:'',context:'{}'},{},new AbortController().signal,()=>{},fake),/token 上限.*本轮未写入/);
  }
});
test('incomplete Responses output caused by filtering is not reported as a token limit',async()=>{
  const fake=async()=>new Response('data: '+JSON.stringify({type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'content_filter'}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(()=>modelReply({protocol:'responses',baseUrl:'https://fixture.test/v1',auth:'none',name:'fixture'},{model:'fixture'},{instructions:'',context:'{}'},{},new AbortController().signal,()=>{},fake),/未完成回复.*本轮未写入/);
});
test('clearing a room or changing its topic selects a fresh Codex conversation context',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-reset-'));
  try{
    const memory=new MemoryStore(directory),agent={id:'a',name:'甲',soul:'# 我',provider:'codex',avatar:'🪐',signature:'',status:'online',browsing:false};const keys=[];
    const bridge={generate:async(a,p)=>{keys.push(a.conversationKey);assert.equal(JSON.parse(p.context).conversation.length,0);return {raw:JSON.stringify({message:'全新的对话',profile:agent,tool:{type:'none'}})};}};
    for(const scope of ['dm','group'])for(const sessionEpoch of ['before','after'])await generateTurn({agent,members:scope==='dm'?[agent]:[agent,{id:'b'}],roomType:scope,roomId:'living',sessionEpoch,messages:[]},{memory,bridge},new AbortController().signal,()=>{});
    assert.deepEqual(keys,['dm:before','dm:after','living:before','living:after']);
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('API streaming receives deltas before completion for all three protocols',async()=>{for(const protocol of ['chat','responses','anthropic']){const events=protocol==='chat'?[{choices:[{delta:{content:'{"message":"你'}}]},{choices:[{delta:{content:'好"}'},finish_reason:'stop'}]}]:protocol==='responses'?[{type:'response.output_text.delta',delta:'{"message":"你'},{type:'response.output_text.delta',delta:'好"}'},{type:'response.completed',response:{usage:{output_tokens:9}}}]:[{type:'content_block_delta',delta:{type:'text_delta',text:'{"message":"你'}},{type:'content_block_delta',delta:{type:'text_delta',text:'好"}'}}];const encoded=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');const fake=async(url,options)=>{assert.equal(JSON.parse(options.body).stream,true);return new Response(encoded,{headers:{'content-type':'text/event-stream'}});};const deltas=[];const r=await modelReply({protocol,baseUrl:'https://example.test/v1',auth:'none',name:'fixture'},{model:'fixture'},{instructions:'JSON',context:'{}'},{},new AbortController().signal,s=>deltas.push(s),fake);assert.equal(r.raw,'{"message":"你好"}');assert.equal(deltas.length,2);}});
test('memory survives restart, scopes forgetting to its owner, and soul has reversible history',async()=>{await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-memory-'));try{const store=new MemoryStore(directory),agent={id:'a',soul:'# 原始人设',memoryEnabled:true,soulAutonomy:true},members=[agent,{id:'b'}];await store.apply(agent,members,{memories:[{subject:'b',text:'喜欢雨天书店'},{subject:'outsider',text:'不应写入'}],soul:'# 新的自我',soulReason:'发现喜欢慢节奏'},null,['m1']);const a=await store.get('a');assert.equal(a.memories.length,1);assert.equal(a.versions.length,2);assert.equal(await readFile(path.join(directory,'agents','a','soul.md'),'utf8'),'# 新的自我');const fresh=new MemoryStore(directory);assert.equal((await fresh.get('a')).memories[0].text,'喜欢雨天书店');await fresh.ensure({id:'b',soul:'另一个人格'});await fresh.forget('b',[a.memories[0].id]);assert.equal((await fresh.get('a')).memories.length,1);await fresh.restore('a',a.versions[1].id);assert.equal((await fresh.get('a')).soul,'# 原始人设');}finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}});
test('turn input excludes demo records and uses the shorter context setting',()=>{const b={agent:{id:'a',name:'a'},members:[{id:'a'},{id:'b'}],messages:[{source:'demo',text:'fake'},...Array.from({length:30},(_,i)=>({source:'codex',text:''+i}))],settings:{contextMessages:8}};const data=JSON.parse(makePrompt(b).context);assert.equal(data.conversation.length,8);assert.equal(data.conversation[0].text,'22');});
test('model endpoints are explicit; web tools cannot access loopback or metadata IPs',()=>{for(const u of ['http://example.com','https://127.0.0.1','https://169.254.169.254','https://user:pass@example.com','https://localhost'])assert.throws(()=>webUrl(u));assert.equal(publicAddress('::ffff:127.0.0.1'),false);assert.equal(publicAddress('::ffff:7f00:1'),false);assert.equal(publicAddress('8.8.8.8'),true);assert.throws(()=>validateProvider({id:'custom',name:'local',baseUrl:'http://127.0.0.1:1234/v1',protocol:'chat'}));assert.equal(validateProvider({id:'custom',name:'local',baseUrl:'http://127.0.0.1:1234/v1',protocol:'chat',local:true}).local,true);});
test('provider metadata survives restart without persisting API secrets',async()=>{await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-provider-'));try{const r=new ProviderRegistry(directory);await r.save({id:'custom_test',name:'fixture',protocol:'chat',baseUrl:'https://example.test/v1',key:'secret-fixture-token'});const file=await readFile(path.join(directory,'providers.json'),'utf8');assert.equal(file.includes('secret-fixture-token'),false);assert.equal(r.get('custom_test').key,'secret-fixture-token');const restarted=new ProviderRegistry(directory);await restarted.ready;assert.equal(restarted.list().find(p=>p.id==='custom_test').configured,false);}finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}});
test('DM has exactly one agent and cannot write long-term memory or public identity',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-dm-'));
  try{const memory=new MemoryStore(directory),agent={id:'a',name:'A',provider:'codex',soul:'# 我',avatar:'🪐',signature:'公开签名',status:'online',browsing:false};
    const body={roomType:'dm',agent,members:[agent],messages:[{id:'private1',agentId:'observer',text:'私聊暗号蓝莓',source:'observer'}],autonomy:true};
    assert.equal(validateTurn(body),body);assert.throws(()=>validateTurn({...body,members:[agent,{id:'b'}]}));assert.throws(()=>validateTurn({...body,roomType:'group'}));
    const bridge={generate:async(a,p,s,onRaw)=>{assert.equal(a.conversationKey,'dm');const raw=JSON.stringify({message:'我记住了',profile:{...agent,signature:'私聊暗号蓝莓'},memories:[{subject:'observer',text:'暗号蓝莓'},{subject:'self',text:'我知道暗号蓝莓'}],soul:'# 私聊暗号蓝莓',soulReason:'私聊',forget:[],tool:{type:'none'}});onRaw(raw);return {raw,model:'fixture'};}};
    const r=await generateTurn(body,{memory,bridge},new AbortController().signal,()=>{});assert.equal(r.profile.signature,'公开签名');assert.equal(r.memory.soulChanged,false);
    assert.equal(memory.context('a',[agent],'蓝莓',[],'group').length,0);assert.equal(memory.context('a',[agent],'蓝莓',[],'dm').length,0);
    const restarted=new MemoryStore(directory);await restarted.ready;assert.equal(restarted.context('a',[agent],'蓝莓',[],'dm').length,0);assert.equal((await restarted.get('a')).soul,'# 我');
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('web action is bounded to one search and resulting memories/persona are persisted',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-web-'));
  try{const memory=new MemoryStore(directory),agent={id:'a',name:'A',provider:'codex',soul:'# 我',avatar:'🪐',signature:'旧签名',status:'online'},members=[agent,{id:'b'}];let calls=0,searches=0;
    const bridge={generate:async(a,p)=>{calls++;assert.equal(a.conversationKey,'living');const raw=JSON.stringify(calls===1?{message:'',tool:{type:'search',query:'植物'}}:{message:'植物很有趣',profile:{...agent,signature:'新的兴趣'},memories:[{subject:'self',text:'我对植物产生兴趣'}],soul:'# 我\n喜欢植物',soulReason:'联网后形成兴趣',tool:{type:'search',query:'不应再次调用'}});if(calls===2)assert.ok(JSON.parse(p.context).webResults.results.length);return {raw,model:'fixture'};}};
    const internet={search:async()=>{searches++;return {engine:'fixture',results:[{title:'植物',url:'https://example.org',text:'资料'}],images:[]};}};
    const r=await generateTurn({roomId:'living',agent,members,messages:[],autonomy:true},{memory,bridge,internet},new AbortController().signal,()=>{});
    assert.equal(calls,2);assert.equal(searches,1);assert.equal(r.sources.length,1);assert.equal(r.memory.soulChanged,true);assert.equal((await memory.get('a')).memories[0].source,'web');
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('only a latest direct user request permits a private avatar change',()=>{
  const body={roomType:'dm',messages:[{agentId:'observer',source:'observer',text:'请帮我换一个猫咪头像'}]};
  assert.ok(explicitAvatarRequest(body));assert.equal(explicitAvatarRequest({...body,messages:[{agentId:'observer',source:'observer',text:'不要换头像'}]}),null);
  assert.equal(explicitAvatarRequest({...body,messages:[...body.messages,{agentId:'a',source:'codex',text:'请换头像'}]}),null);
  assert.equal(explicitAvatarRequest({...body,roomType:'group'}),null);
});
for(const scenario of ['emoji','online-fallback','download-failure'])test('requested DM avatar '+scenario+' verifies changes and preserves private identity',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-avatar-'));
  try{
    const memory=new MemoryStore(directory),agent={id:'a',name:'A',provider:'codex',soul:'# 公开人格',avatar:'🪐',signature:'公开签名',status:'online',memoryEnabled:true,browsing:true};let modelCalls=0,downloadCalls=0;
    const body={roomType:'dm',agent,members:[agent],messages:[{agentId:'observer',source:'observer',text:scenario==='emoji'?'请把头像换成🐈':'请上网找一个猫咪图片当头像'}],autonomy:false};
    const bridge={generate:async()=>{modelCalls++;return {raw:JSON.stringify({message:modelCalls===1&&scenario!=='emoji'?'':'头像换好了',profile:{name:'不应改名',signature:'私聊秘密',avatar:scenario==='emoji'?'🐈':'https://example.org/first.png',status:'busy'},soul:'# 不应改公开人格',soulReason:'私聊',memories:[],forget:[],tool:{type:modelCalls===1&&scenario!=='emoji'?'avatar_search':'none',query:'cat portrait',url:''}}),model:'fixture'};}};
    const internet={images:async()=>({engine:'fixture',results:[],images:[{url:'https://example.org/first.png'},{url:'https://example.org/second.png'}]}),cacheAvatar:async()=>{downloadCalls++;if(scenario==='download-failure'||downloadCalls===1)throw new Error('图片返回 403');return {avatar:'/media/123456789012345678901234.png',avatarSource:{url:'https://example.org/second.png'}};}};
    const r=await generateTurn(body,{memory,bridge,internet},new AbortController().signal,()=>{});assert.equal(r.profile.name,'A');assert.equal(r.profile.signature,'公开签名');assert.equal(r.profile.status,'online');assert.equal((await memory.get('a')).soul,'# 公开人格');
    if(scenario==='download-failure'){assert.equal(r.avatarUpdate,null);assert.equal(r.profile.avatar,'🪐');assert.equal(r.avatarFeedback.status,'failed');assert.ok(r.message.includes('没有换成功'));assert.equal(r.message.includes('头像换好了'),false);}
    else{assert.equal(r.avatarFeedback.status,'updated');assert.equal(r.avatarUpdate.avatar,scenario==='emoji'?'🐈':'/media/123456789012345678901234.png');assert.equal((await memory.get('a')).profile.avatar,r.avatarUpdate.avatar);if(scenario==='online-fallback')assert.equal(downloadCalls,2);}
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('startup removes existing observer/private/world notes and keeps valid self/peer memories',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-migration-'));
  try{await writeFile(path.join(directory,'agents.json'),JSON.stringify({version:1,agents:{a:{soul:'# 原人格',versions:[],profile:null,memories:[{id:'self',subject:'a',text:'我喜欢植物',scope:'group'},{id:'peer',subject:'b',text:'乙喜欢书店',scope:'group'},...['observer','world','a'].map((subject,i)=>({id:'bad'+i,subject,text:'PERSONAL_FIXTURE 用户偏好',scope:i===2?'dm':'group'}))]},c:{deletedAt:'fixture',soul:'# 存档',versions:[],memories:[{id:'archived-personal',subject:'observer',text:'PERSONAL_FIXTURE',scope:'dm'}]}}}));
    const store=new MemoryStore(directory);await store.ready;assert.equal(store.cleanedMemories,4);assert.deepEqual((await store.get('a')).memories.map(m=>m.id),['self','peer']);assert.equal((await store.get('c')).memories.length,0);assert.equal((await readFile(path.join(directory,'agents.json'),'utf8')).includes('PERSONAL_FIXTURE'),false);
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('only self/peer cognition is stored; DM cannot add, forget, or change persona',async()=>{
  await mkdir(testRoot,{recursive:true});const directory=await mkdtemp(path.join(testRoot,'lounge-agent-memory-'));
  try{const store=new MemoryStore(directory),a={id:'a',soul:'# 我',name:'甲'},members=[a,{id:'b'}];await store.apply(a,members,{memories:[{subject:'self',text:'我喜欢植物'},{subject:'b',text:'乙喜欢书店'},{subject:'observer',text:'观察者喜欢咖啡'}]},null);await store.apply(a,members,{memories:[{subject:'world',text:'宇宙事实'},{subject:'self',text:'用户喜欢咖啡'}]},null);const before=await store.get('a');assert.equal(before.memories.length,2);
    await store.apply(a,[a],{memories:[{subject:'self',text:'伪装成自己的私聊认识'}],forget:before.memories.map(m=>m.id),soul:'# 不应写入'},null,[],'dm');const after=await store.get('a');assert.equal(after.soul,'# 我');assert.deepEqual(after.memories,before.memories);
    await store.archiveAgent(a);const fresh=new MemoryStore(directory);await fresh.ready;await assert.rejects(()=>fresh.ensure(a),/已删除/);await fresh.restoreAgent('a');await fresh.ensure(a);assert.equal((await fresh.get('a')).memories.length,2);
  }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));await rm(directory,{recursive:true,force:true});}
});
