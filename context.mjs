import {createHash} from 'node:crypto';
import {estimateTokens} from './metrics.mjs';
import {makePrompt} from './core.mjs';

// Derived views are disposable and never stored as agent memories or backups.
const recaps=new Map();
const cleanMessages=messages=>messages.filter(m=>!['example','demo'].includes(m.source));
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stop=new Set(['我们','你们','他们','自己','这个','那个','一个','可以','觉得','还是','就是','什么','一下','已经','其实','然后','现在','知道','时候','因为','所以','喜欢','朋友','话题','愿意','一起','这个','的故','故事','想法','值得','慢慢','the','and','that','with','this','have']);
export function keywords(text){const s=String(text||'').toLowerCase(),words=s.match(/[a-z0-9_]{3,}|[\u3400-\u9fff]{2,}/gu)||[];return [...new Set(words.flatMap(w=>/^[\u3400-\u9fff]+$/u.test(w)?Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)):[w]).filter(w=>!stop.has(w)))].slice(-120);}
export function relevance(text,query){const hay=String(text).toLowerCase();return keywords(query).reduce((n,t)=>n+(hay.includes(t)?1:0),0);}
function fitText(text,budget){text=String(text);if(estimateTokens(text)<=budget)return text;let lo=0,hi=text.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(estimateTokens(text.slice(0,mid))<=budget)lo=mid;else hi=mid-1;}if(lo&&/[\uD800-\uDBFF]/.test(text[lo-1]))lo--;return text.slice(0,lo);}
function segments(text){const out=[];let line=1;for(const match of text.matchAll(/[^\n]*(?:\n|$)/g)){if(!match[0])continue;const raw=match[0];for(let p=0;p<raw.length;p+=260){const part=raw.slice(p,p+260);if(part.trim())out.push({text:part,start:match.index+p,end:match.index+p+part.length,line});}line++;}return out;}
export function soulView(soul,query,budget=1400,full=false){
  soul=String(soul||'');const originalTokens=estimateTokens(soul),sourceHash=fingerprint(soul);
  if(full||originalTokens<=budget)return {text:soul,compressed:false,originalTokens,usedTokens:originalTokens,sourceHash,passages:[]};
  const all=segments(soul),ranked=all.map((s,i)=>({...s,index:i,score:(i===0?100:0)+(/身份|名字|价值|原则|边界|底线|禁止|必须|永不|不能|不得|说话|风格/.test(s.text)?15:0)+relevance(s.text,query)*2+(i===all.length-1?1:0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=[];let used=0;for(const s of ranked){const cost=estimateTokens(s.text)+18;if(used+cost>budget)continue;chosen.push(s);used+=cost;}
  chosen.sort((a,b)=>a.index-b.index);const passages=chosen.map(s=>({line:s.line,start:s.start,end:s.end,text:s.text}));
  const text=passages.map(s=>`[原文第 ${s.line} 行]\n${s.text}`).join('\n[…]\n');return {text,compressed:true,originalTokens,usedTokens:estimateTokens(text),sourceHash,passages};
}
export function applySoulEdits(original,edits,visible){
  if(!Array.isArray(edits)||!edits.length)return original;if(edits.length>3)throw new Error('一次最多修改 3 个人设片段');
  let next=original;for(const e of edits){if(typeof e?.old!=='string'||!e.old||typeof e.new!=='string'||!visible.includes(e.old))throw new Error('人设修改没有对应的可见原文');const first=next.indexOf(e.old);if(first<0||next.indexOf(e.old,first+1)>=0)throw new Error('人设原文无法唯一定位');next=next.slice(0,first)+e.new+next.slice(first+e.old.length);}if(!next.trim())throw new Error('人设不能改为空白');return next;
}
function recentView(messages,count){return cleanMessages(messages).slice(-count).map(m=>({id:m.id,speaker:m.name||'观察者',agentId:m.agentId,text:String(m.text||''),source:m.source}));}
function recapView(body,history,budget){
  const all=cleanMessages(body.messages),first=all.findIndex(m=>m.id===history[0]?.id),older=all.slice(0,Math.max(0,first));
  // Advance the source range in batches; excerpts deliberately omit some old text.
  const covered=Math.floor(older.length/8)*8;if(!covered)return {items:[],covered:0,sourceIds:[],method:'extractive'};
  const source=older.slice(0,covered).filter(m=>body.roomType==='dm'||m.agentId!=='observer'&&m.source!=='observer'),query=String(body.topic||''),key=fingerprint([body.roomId,body.roomType,body.topic,source.map(m=>[m.id,m.agentId,m.text]),budget]);
  if(recaps.has(key))return structuredClone(recaps.get(key));
  const ranked=source.map((m,i)=>({m,i,score:relevance(m.text,query)+(/约定|决定|以后|下次|答应|不再|改为|更正|定义|代表|意味着|[?？]/u.test(m.text)?4:0)+i/Math.max(1,source.length)})).sort((a,b)=>b.score-a.score);
  const selected=[],seen=new Set();let used=0;for(const {m,i}of ranked){const text=fitText(m.text,130),normalized=m.agentId+'|'+text.replace(/^第\s*\d+\s*(?:段|条|句)[，:：、.]\s*/u,'').replace(/\s|[，。！？,.!?]/g,'');if(seen.has(normalized))continue;const item={id:m.id,speaker:m.name||m.agentId,text,...(text.length<m.text.length?{excerpt:true}:{})},cost=estimateTokens(JSON.stringify(item));if(used+cost>budget)continue;used+=cost;seen.add(normalized);selected.push({item,i});if(selected.length>=8)break;}
  selected.sort((a,b)=>a.i-b.i);const value={method:'extractive',covered,sourceIds:source.map(m=>m.id),items:selected.map(x=>x.item)};recaps.set(key,value);while(recaps.size>24)recaps.delete(recaps.keys().next().value);return structuredClone(value);
}
export function clearContextCache(){recaps.clear();}
export function prepareContext(body){
  const optimized=body.settings?.optimizeContext!==false,budget=Math.max(2500,Math.min(24000,Number(body.settings?.contextBudget)||6000)),count=Math.max(4,Math.min(32,Number(body.settings?.contextMessages)||12)),query=String(body.topic||'')+' '+body.messages.slice(-3).map(m=>m.text).join(' '),originalSoul=String(body.soul||body.agent.soul||body.agent.personality||'');
  const soul=soulView(originalSoul,query,Math.min(1400,Math.floor(budget*.24)),!optimized||body.settings?.soulContextMode==='full'),history=recentView(body.messages,count).filter(m=>!body.observerRequest||m.id!==body.observerRequest.id);
  const data={...body,soul:soul.text,memoryContext:body.memoryContext||[],runtime:{history,recap:{items:[],covered:0,sourceIds:[]},soulCompressed:soul.compressed}};
  const latest=history.at(-1);if(optimized){for(const m of history)if(m!==latest){const original=m.text;m.text=fitText(original,450);if(m.text!==original)m.excerpt=true;}data.runtime.recap=recapView(body,history,Math.min(800,Math.floor(budget*.14)));}
  const promptSize=()=>{const p=makePrompt(data);return estimateTokens(p.instructions+p.context);};
  // Full-send is an explicit fidelity choice. Keep the normal context allowance
  // alongside it rather than throwing all recent messages away to chase a target
  // which the full soul alone cannot meet.
  const effectiveBudget=budget+(body.settings?.soulContextMode==='full'?Math.max(0,soul.usedTokens-Math.min(1400,Math.floor(budget*.24))):0);
  if(optimized){
    while(promptSize()>effectiveBudget&&history.length>4)history.shift();
    while(promptSize()>effectiveBudget&&data.memoryContext.length>2)data.memoryContext=data.memoryContext.slice(0,-1);
    while(promptSize()>effectiveBudget&&data.runtime.recap.items.length>2)data.runtime.recap.items.pop();
    while(promptSize()>effectiveBudget&&history.length>1)history.shift();
    while(promptSize()>effectiveBudget&&data.memoryContext.length)data.memoryContext=data.memoryContext.slice(0,-1);
    while(promptSize()>effectiveBudget&&data.runtime.recap.items.length)data.runtime.recap.items.pop();
  }
  const prompt=makePrompt(data),parts={instructions:estimateTokens(prompt.instructions)-estimateTokens(soul.text)-estimateTokens(JSON.stringify(data.memoryContext)),soul:estimateTokens(soul.text),memories:estimateTokens(JSON.stringify(data.memoryContext)),recent:estimateTokens(JSON.stringify(history)),recap:estimateTokens(JSON.stringify(data.runtime.recap.items)),priority:estimateTokens(JSON.stringify(body.observerRequest||null))};
  const info={optimized,budget,estimatedTokens:estimateTokens(prompt.instructions+prompt.context),overBudget:estimateTokens(prompt.instructions+prompt.context)>budget,parts,recentIds:history.map(m=>m.id),recapIds:data.runtime.recap.items.map(m=>m.id),recapCovered:data.runtime.recap.covered,memoryIds:data.memoryContext.map(m=>m.id),soul:{compressed:soul.compressed,originalTokens:soul.originalTokens,usedTokens:soul.usedTokens,sourceHash:soul.sourceHash}};
  return {data,prompt,info,view:{soul,recap:data.runtime.recap,recent:history,memories:data.memoryContext,priority:body.observerRequest||null}};
}
