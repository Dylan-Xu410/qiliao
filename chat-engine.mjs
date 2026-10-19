import {parseObject,parseReply,streamedMessage,explicitAvatarRequest} from './core.mjs';
import {modelReply} from './providers.mjs';
import {randomUUID} from 'node:crypto';
import {combineUsage,estimateTokens} from './metrics.mjs';
import {prepareContext,applySoulEdits} from './context.mjs';
export async function generateTurn(body,{registry,bridge,memory,internet},signal,emit){
  const agent=body.agent,started=Date.now();let firstTextMs=null,usage=null,model=agent.model,webResults=null;
  await memory.ensure(agent);const saved=await memory.get(agent.id);
  const scope=body.roomType==='dm'?'dm':'group',avatarRequest=explicitAvatarRequest(body);let avatarFeedback=null;
  const conversationKey=(scope==='dm'?'dm':body.roomId||'group')+(/^[a-zA-Z0-9_-]{1,80}$/.test(body.sessionEpoch||'')?':'+body.sessionEpoch:'');
  const prepared={...body,avatarRequest,soul:saved.soul,memoryContext:agent.memoryEnabled===false?[]:memory.context(agent.id,body.members,body.topic,body.messages,scope)};
  emit('phase',{text:prepared.memoryContext.length?'带着 '+prepared.memoryContext.length+' 条记忆接话…':'正在准备回复…',stage:'model'});
  let contextInfo=null,contextData=null;
  const run=async data=>{
    let previous='',seen='';const preparedContext=prepareContext(data),{prompt}=preparedContext;contextInfo=preparedContext.info;contextData=preparedContext.data;
    const onRaw=raw=>{seen=raw;if(avatarRequest)return;const text=streamedMessage(raw);if(text&&text!==previous){if(firstTextMs===null)firstTextMs=Date.now()-started;previous=text;emit('text',{text});}};
    emit('metrics',{phase:'start',estimatedTokens:estimateTokens(prompt.instructions+prompt.context),kind:data.finishOnly?'web-followup':'reply',context:contextInfo});
    let result;try{result=agent.provider==='codex'?await bridge.generate({...agent,conversationKey,...(scope==='group'?{observerEpoch:body.observerEpoch||''}:{})},prompt,signal,onRaw,text=>emit('phase',{text,stage:'model'})):await modelReply(registry.get(agent.provider),agent,prompt,body.settings,signal,onRaw);}catch(e){emit('metrics',{phase:'finish',estimatedTokens:estimateTokens(seen),usage:null});throw e;}
    usage=combineUsage(usage,result.usage);emit('metrics',{phase:'finish',usage:result.usage||null,estimatedTokens:estimateTokens(result.raw)});model=result.model||model;return parseObject(result.raw);
  };
  let parsed=await run(prepared);if(signal.aborted)throw new DOMException('已取消','AbortError');
  if(body.natural&&!body.observerRequest&&scope==='group'&&!avatarRequest&&parsed.listening===true&&!String(parsed.message||'').trim()&&(!parsed.tool?.type||parsed.tool.type==='none'))return {id:randomUUID(),listening:true,message:'',source:agent.provider,model,usage,context:contextInfo,timing:{firstTextMs,totalMs:Date.now()-started}};
  if(avatarRequest&&agent.browsing!==false&&(avatarRequest.online||(!parsed.tool?.type||parsed.tool.type==='none')&&(!parsed.profile?.avatar||parsed.profile.avatar===agent.avatar))){parsed.tool={type:'avatar_search',query:parsed.tool?.query||avatarRequest.text,url:''};}
  if(agent.browsing!==false&&['search','read','avatar_search'].includes(parsed.tool?.type)){
    const tool=parsed.tool;emit('activity',{text:tool.type==='read'?'读取网页：'+tool.url:tool.type==='avatar_search'?'寻找头像：'+tool.query:'搜索：'+tool.query,kind:'web'});emit('phase',{text:tool.type==='avatar_search'?'正在寻找喜欢的头像…':'正在上网拓展话题…',stage:'web'});emit('text',{text:''});
    try{webResults=await(tool.type==='read'?internet.read(tool.url,signal):tool.type==='avatar_search'?internet.images(tool.query,signal):internet.search(tool.query,signal));emit('sources',{sources:webResults.results.map(r=>({title:r.title,url:r.url}))});emit('activity',{text:'联网完成 · '+webResults.engine+' · '+webResults.results.length+' 个结果',kind:'web'});}catch(e){if(signal.aborted)throw new DOMException('已取消','AbortError');webResults={error:e.message,results:[],images:[]};emit('activity',{text:'联网未成功：'+e.message,kind:'warning'});}
    emit('phase',{text:'正在把新发现带回聊天…',stage:'model'});parsed=await run({...prepared,finishOnly:true,webResults});parsed._web=true;
  }
  // Private conversation must not be copied into publicly shared profile or soul.
  if(scope==='dm'){parsed.soul='';parsed.soulReason='';parsed.soulEdits=[];parsed.memories=[];parsed.forget=[];}
  else if(contextData?.runtime.soulCompressed){parsed.soul='';try{if(parsed.soulEdits?.length)parsed.soul=applySoulEdits(saved.soul,parsed.soulEdits,contextData.soul);}catch(e){emit('activity',{text:'人设片段修改未应用：'+e.message,kind:'warning'});}}
  const result=parseReply(parsed,agent,scope==='dm'?false:body.autonomy);
  if(avatarRequest)result.profile.avatar=parseReply(parsed,agent,true).profile.avatar;
  if(result.profile.avatar!==agent.avatar)delete result.profile.avatarSource;
  if(avatarRequest&&avatarRequest.online&&agent.browsing===false){avatarFeedback={status:'failed',reason:'自主联网已关闭，请先在角色设置开启联网'};result.profile.avatar=agent.avatar;}
  else if(avatarRequest&&avatarRequest.online&&!/^https:\/\//i.test(result.profile.avatar)){
    if(webResults?.images?.length)result.profile.avatar=webResults.images[0].url;
    else avatarFeedback={status:'failed',reason:webResults?.error||'没有找到可用的在线头像'};
  }
  if(/^https:\/\//i.test(result.profile.avatar)){
    emit('phase',{text:'正在保存新的头像…',stage:'avatar'});
    const chosen=result.profile.avatar;let lastError=null,cached=null;
    const choices=webResults?.images||[],candidates=[chosen,...(avatarRequest?choices.map(x=>x.url).filter(u=>u!==chosen):[])].slice(0,3);
    for(const url of candidates){try{cached=await internet.cacheAvatar(url,choices,signal);break;}catch(e){if(signal.aborted)throw new DOMException('已取消','AbortError');lastError=e;}}
    if(cached){Object.assign(result.profile,cached);emit('activity',{text:'选好了新的在线头像',kind:'profile'});}else{result.profile.avatar=agent.avatar;avatarFeedback={status:'failed',reason:lastError?.message||'图片下载失败'};}
  }
  if(avatarFeedback?.status==='failed')result.profile.avatar=agent.avatar;
  if(result.profile.avatar===agent.avatar&&agent.avatarSource)result.profile.avatarSource=agent.avatarSource;
  if(result.profile.avatar!==agent.avatar)avatarFeedback={status:'updated'};
  else if(avatarRequest&&!avatarFeedback)avatarFeedback={status:'failed',reason:'这次没有选出新的头像，可指定一个表情或更具体的图片主题'};
  if(avatarFeedback?.status==='failed'){emit('activity',{text:'头像未更换：'+avatarFeedback.reason,kind:'warning'});if(avatarRequest)result.message='这次头像没有换成功：'+avatarFeedback.reason+'。原头像保留。';}
  if(avatarRequest&&avatarFeedback?.status==='updated'&&/无法|不能|没法|做不到|没有权限/.test(result.message))result.message='头像已经换好了，'+(/^\/media\//.test(result.profile.avatar)?'新的图片已保存到本机。':'我给自己选了 '+result.profile.avatar+'。');
  if(signal.aborted)throw new DOMException('已取消','AbortError');
  emit('phase',{text:'正在保存这次认识…',stage:'persist'});
  const id=randomUUID(),records=[...body.messages.map(m=>({...m,roomId:body.roomId})),{id,agentId:agent.id,name:agent.name,text:result.message,time:new Date().toISOString(),source:agent.provider,roomId:body.roomId}],changes=await memory.apply(agent,body.members,parsed,result.profile,[...body.messages.filter(m=>m.source!=='observer'&&m.agentId!=='observer').slice(-6).map(m=>m.id).filter(Boolean),id],scope,records);
  if(changes.remembered)emit('activity',{text:'记住了 '+changes.remembered+' 条新的认识',kind:'memory'});
  if(changes.forgotten)emit('activity',{text:'整理了 '+changes.forgotten+' 条旧记忆',kind:'memory'});
  if(changes.merged)emit('activity',{text:'合并了 '+changes.merged+' 条相近认识',kind:'memory'});
  if(changes.corrected)emit('activity',{text:'纠正了 '+changes.corrected+' 条旧认识，原版本已保留',kind:'memory'});
  if(changes.soulChanged)emit('activity',{text:'自主完善了 soul.md：'+String(parsed.soulReason||'新的自我认识').slice(0,120),kind:'soul'});
  if(avatarRequest){firstTextMs=Date.now()-started;emit('text',{text:result.message});}
  return {...result,id,model,usage,context:contextInfo,source:agent.provider,memory:changes,avatarFeedback,avatarUpdate:avatarFeedback?.status==='updated'?{avatar:result.profile.avatar,...(result.profile.avatarSource?{avatarSource:result.profile.avatarSource}:{})}:null,sources:(webResults?.results||[]).map(r=>({title:r.title,url:r.url})),timing:{firstTextMs,totalMs:Date.now()-started}};
}
