import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareContext,soulView,applySoulEdits} from '../context.mjs';
import {tokensOf,combineUsage,RunTracker} from '../metrics.mjs';
import {MemoryStore} from '../memory.mjs';
import {generateTurn} from '../chat-engine.mjs';
import {CodexBridge} from '../codex-bridge.mjs';
const a={id:'a',name:'甲',provider:'codex',model:'test',soul:'# 身份\n我叫甲。\n# 边界\n不得伪装为其他成员。',avatar:'🪐',signature:'聊天',status:'online'},b={...a,id:'b',name:'乙'};
const history=n=>Array.from({length:n},(_,i)=>({id:'m'+i,source:'codex',agentId:i%2?'a':'b',name:i%2?'甲':'乙',text:'第'+i+'段：'+('一起聊植物、书店和未来的约定。'.repeat(30)),time:String(i)}));
const body=(messages=history(80))=>({agent:a,members:[a,b],roomId:'r',roomType:'group',topic:'植物',messages,soul:a.soul,memoryContext:[],settings:{contextBudget:6000},autonomy:true});
const root=path.resolve('work','context-tests');
async function fixture(fn){await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'case-'));try{return await fn(dir);}finally{assert.ok(path.resolve(dir).startsWith(root+path.sep));await rm(dir,{recursive:true,force:true});}}
test('long conversations stay within a bounded view without mutating or discarding the stored transcript',()=>{
  for(const n of [20,80,400,900]){const input=body(history(n)),before=structuredClone(input),p=prepareContext(input);assert.ok(p.info.estimatedTokens<=6000);assert.ok(p.info.recentIds.length<=12);assert.ok(p.info.recapIds.length<=8);assert.deepEqual(input,before);assert.equal(p.view.recent.at(-1).text,input.messages.at(-1).text);}
});
test('pending @ original and latest long message survive a soft budget overrun',()=>{
  const request={id:'u',agentId:'observer',source:'observer',text:'必须完整回应的问题。'.repeat(900),mentions:['a']},input={...body(),observerRequest:request,settings:{contextBudget:2500}};input.messages.push({...request,id:'latest'});const p=prepareContext(input),ctx=JSON.parse(p.prompt.context);assert.equal(ctx.observerRequest.text,request.text);assert.equal(ctx.conversation.at(-1).text,request.text);assert.equal(p.info.overBudget,true);
});
test('the same pending @ message is sent once as priority instead of duplicated in recent history',()=>{const request={id:'u',agentId:'observer',source:'observer',text:'@甲 请回应',mentions:['a']},p=prepareContext({...body([...history(20),request]),observerRequest:request}),context=JSON.parse(p.prompt.context);assert.equal(context.observerRequest.text,request.text);assert.equal(context.conversation.some(m=>m.id===request.id),false);});
test('recaps contain traceable agent excerpts, exclude observer profiles and demos, and invalidate on edits/clear',()=>{
  const messages=history(80);messages[3]={...messages[3],source:'observer',agentId:'observer',text:'PRIVATE_OBSERVER_PROFILE'};messages[4]={...messages[4],source:'demo',text:'DEMO_SECRET'};
  const p=prepareContext(body(messages));assert.ok(p.view.recap.items.length);assert.ok(!JSON.stringify(p.view.recap).includes('PRIVATE_OBSERVER_PROFILE'));assert.ok(!p.prompt.context.includes('DEMO_SECRET'));for(const x of p.view.recap.items)assert.ok(messages.find(m=>m.id===x.id).text.startsWith(x.text));
  const changed=structuredClone(messages);for(const m of changed)m.text='替换后的新消息';const fresh=prepareContext(body(changed));assert.ok(!JSON.stringify(fresh.view.recap).includes('植物、书店'));assert.equal(prepareContext(body([])).view.recap.items.length,0);
});
test('soul excerpts prioritize identity and boundaries, expose sources and support complete-send opt-out',()=>{
  const full=a.soul+'\n'+Array.from({length:200},(_,i)=>`第 ${i} 项兴趣：我喜欢探索不同的花园与故事。`).join('\n');const view=soulView(full,'花园',1000);assert.equal(view.compressed,true);assert.ok(view.text.includes('不得伪装'));for(const x of view.passages)assert.equal(full.slice(x.start,x.end),x.text);const p=prepareContext({...body([]),soul:full,settings:{soulContextMode:'full'}});assert.equal(p.view.soul.text,full);assert.equal(p.view.soul.compressed,false);assert.equal(full.includes('第 199 项兴趣'),true);
});
test('full-soul fidelity choice does not erase all conversational context trying to meet an impossible target',()=>{const soul=a.soul+'\n'+('爱好、原则和经历。\n'.repeat(1800)),p=prepareContext({...body(),soul,settings:{soulContextMode:'full',contextBudget:6000}});assert.equal(p.view.soul.text,soul);assert.equal(p.info.overBudget,true);assert.ok(p.view.recent.length>=4);assert.ok(p.view.recap.items.length);});
test('precise soul edits preserve unseen text and fail atomically on ambiguity, invisible anchors or blank documents',()=>{
  const original='# 身份\n我叫甲。\n隐藏细节不可丢。';assert.equal(applySoulEdits(original,[{old:'我叫甲。',new:'我叫甲，喜欢花园。'}],'我叫甲。'),'# 身份\n我叫甲，喜欢花园。\n隐藏细节不可丢。');assert.throws(()=>applySoulEdits('重复重复',[{old:'重复',new:'新'}],'重复'),/唯一/);assert.throws(()=>applySoulEdits(original,[{old:'隐藏细节',new:''}],'我叫甲。'),/可见/);assert.throws(()=>applySoulEdits('甲',[{old:'甲',new:''}],'甲'),/空白/);
});
test('memory retrieval selects relevant peer facts, avoids unrelated filler and isolates private context',()=>fixture(async dir=>{
  const m=new MemoryStore(dir);await m.ensure(a);await m.transaction(()=>{m.state.agents.a.memories=[{id:'plant',subject:'b',text:'乙喜欢植物和花园',basis:'explicit'},...Array.from({length:15},(_,i)=>({id:'noise'+i,subject:'b',text:'乙在遥远星系学过量子力学'})),{id:'self',subject:'a',text:'我说话简洁'}];});const selected=m.context('a',[a,b],'花园',[]);assert.ok(selected.some(x=>x.id==='plant'));assert.ok(!selected.some(x=>x.id.startsWith('noise')));assert.ok(selected.length<=6);assert.equal(m.context('a',[a,b],'花园',[],'dm').length,0);
}));
test('cache and reasoning usage normalize across protocols without double-counting included tokens',()=>{
  assert.deepEqual(tokensOf({prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:80}),{inputTokens:100,outputTokens:20,totalTokens:120,cachedInputTokens:80});
  assert.deepEqual(tokensOf({input_tokens:10,output_tokens:20,cache_read_input_tokens:70,cache_creation_input_tokens:30}),{inputTokens:110,outputTokens:20,totalTokens:130,cachedInputTokens:70,cacheWriteTokens:30});
  const x=tokensOf({inputTokens:100,outputTokens:20,totalTokens:120,cachedInputTokens:60,reasoningOutputTokens:7});assert.equal(x.inputTokens,100);assert.equal(x.reasoningTokens,7);assert.equal(tokensOf(x).inputTokens,100);
  assert.equal(tokensOf({input_tokens:100,output_tokens:20,output_tokens_details:{reasoning_tokens:10}}).totalTokens,120);assert.equal(combineUsage({inputTokens:10,outputTokens:2,totalTokens:12,cachedInputTokens:0},{inputTokens:20,outputTokens:3,totalTokens:23}).cachedInputTokens,null);
});
test('tracker keeps first reply and web follow-up usage separate and marks missing usage',()=>{
  const t=new RunTracker(body([]));t.event('metrics',{phase:'start',kind:'reply',estimatedTokens:100});t.event('metrics',{phase:'finish',usage:{prompt_tokens:100,completion_tokens:20},estimatedTokens:20});t.event('metrics',{phase:'start',kind:'web-followup',estimatedTokens:140});t.event('metrics',{phase:'finish',usage:null,estimatedTokens:30});const r=t.finish('success');assert.equal(r.calls.length,2);assert.equal(r.calls[1].kind,'web-followup');assert.equal(r.calls[1].usage,null);assert.equal(r.usageComplete,false);assert.equal(r.usage.totalTokens,120);
});
test('Codex keeps transport warm but never appends repeated full contexts to an existing thread',async()=>{
  const bridge=new CodexBridge('.');let starts=0,threadStarts=0;const threads=[];bridge.start=async()=>{starts++;};bridge.models=async()=>[{id:'test',supportedReasoningEfforts:['low']}];bridge.rpc=async(method,p)=>{if(method==='thread/start')return {thread:{id:'thread-'+(++threadStarts)}};if(method==='turn/start'){threads.push(p.threadId);queueMicrotask(()=>{for(const fn of [...bridge.listeners]){fn({method:'item/agentMessage/delta',params:{threadId:p.threadId,delta:'{"message":"好"}'}});fn({method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});}});return {turn:{id:'turn'}};}throw new Error(method);};
  for(let i=0;i<8;i++)await bridge.generate(a,{instructions:'RULES',context:'DATA'},new AbortController().signal,()=>{});assert.equal(new Set(threads).size,8);assert.equal(bridge.sessions.size,0);assert.equal(starts,8);
});
test('compressed autonomous soul updates apply exact patches and preserve the full file and version',()=>fixture(async dir=>{
  const soul=a.soul+'\n'+('隐藏兴趣和经历。\n'.repeat(500)),agent={...a,soul},memory=new MemoryStore(dir);await memory.ensure(agent);const bridge={generate:async()=>({raw:JSON.stringify({message:'我想补充一点。',soul:'# 错误的摘要全文',soulEdits:[{old:'我叫甲。',new:'我叫甲，喜欢花园。'}],soulReason:'新增兴趣'}),model:'test'})};
  const result=await generateTurn({...body([]),agent,soul},{memory,bridge,registry:{},internet:{}},new AbortController().signal,()=>{});const saved=await memory.get('a');assert.equal(result.context.soul.compressed,true);assert.equal(saved.soul,soul.replace('我叫甲。','我叫甲，喜欢花园。'));assert.equal(await readFile(path.join(dir,'agents/a/soul.md'),'utf8'),saved.soul);assert.equal(saved.versions[1].soul,soul);
}));
