import {randomUUID} from 'node:crypto';
export function tokensOf(usage){
  if(!usage)return null;
  const pick=(...values)=>values.find(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
  let input=pick(usage.inputTokens,usage.input_tokens,usage.prompt_tokens);
  const cached=pick(usage.cachedInputTokens,usage.cached_input_tokens,usage.input_tokens_details?.cached_tokens,usage.prompt_tokens_details?.cached_tokens,usage.prompt_cache_hit_tokens,usage.cache_read_input_tokens),write=pick(usage.cacheWriteTokens,usage.cache_creation_input_tokens,usage.input_tokens_details?.cache_write_tokens,usage.prompt_tokens_details?.cache_write_tokens),reasoning=pick(usage.reasoningTokens,usage.reasoningOutputTokens,usage.reasoning_output_tokens,usage.output_tokens_details?.reasoning_tokens,usage.completion_tokens_details?.reasoning_tokens);
  // Anthropic input_tokens excludes cache reads/writes; other protocols include them.
  if(usage.inputTokens===undefined&&typeof usage.input_tokens==='number'&&(usage.cache_read_input_tokens!==undefined||usage.cache_creation_input_tokens!==undefined))input+=(cached||0)+(write||0);
  const output=pick(usage.outputTokens,usage.output_tokens,usage.completion_tokens),total=pick(usage.totalTokens,usage.total_tokens,input!==undefined&&output!==undefined?input+output:undefined);
  return total===undefined?null:{inputTokens:input??null,outputTokens:output??null,totalTokens:total,...(cached!==undefined?{cachedInputTokens:cached}:{}),...(write!==undefined?{cacheWriteTokens:write}:{}),...(reasoning!==undefined?{reasoningTokens:reasoning}:{})};
}
export function combineUsage(a,b){const x=tokensOf(a),y=tokensOf(b);if(!x)return y;if(!y)return x;const result={inputTokens:x.inputTokens===null||y.inputTokens===null?null:x.inputTokens+y.inputTokens,outputTokens:x.outputTokens===null||y.outputTokens===null?null:x.outputTokens+y.outputTokens,totalTokens:x.totalTokens+y.totalTokens};for(const k of ['cachedInputTokens','cacheWriteTokens','reasoningTokens'])if(x[k]!==undefined||y[k]!==undefined)result[k]=typeof x[k]==='number'&&typeof y[k]==='number'?x[k]+y[k]:null;return result;}
export function estimateTokens(text){return Math.ceil(Buffer.byteLength(String(text),'utf8')/3);}
export class RunTracker{
  constructor(body){this.started=Date.now();this.stage='prepare';this.stageStarted=this.started;this.stages={};this.body=body;this.usage=null;this.estimatedTokens=0;this.modelCalls=0;this.unknownModelCalls=0;this.firstTextMs=null;this.calls=[];}
  event(type,data){
    if(type==='phase'&&data.stage!==this.stage){this.stages[this.stage]=(this.stages[this.stage]||0)+Date.now()-this.stageStarted;this.stage=data.stage||'model';this.stageStarted=Date.now();}
    if(type==='text'&&data.text&&this.firstTextMs===null)this.firstTextMs=Date.now()-this.started;
    if(type==='metrics'){
      this.usage=combineUsage(this.usage,data.usage);this.estimatedTokens+=data.estimatedTokens||0;
      if(data.phase!=='finish'){this.modelCalls++;this.calls.push({kind:data.kind||'reply',estimatedInputTokens:data.estimatedTokens||0,context:data.context||null,usage:null});}
      if(data.phase==='finish'){if(!tokensOf(data.usage))this.unknownModelCalls++;const call=this.calls.at(-1);if(call){call.usage=tokensOf(data.usage);call.estimatedOutputTokens=data.estimatedTokens||0;}}
    }
  }
  finish(status,result,error){this.stages[this.stage]=(this.stages[this.stage]||0)+Date.now()-this.stageStarted;return {id:randomUUID(),time:new Date().toISOString(),roomId:this.body.roomId,agentId:this.body.agent.id,provider:this.body.agent.provider,model:result?.model||this.body.agent.model||'自动模型',sessionId:this.body.sessionId||null,status,totalMs:Date.now()-this.started,firstTextMs:this.firstTextMs,stages:this.stages,modelCalls:this.modelCalls,calls:this.calls,usage:this.usage,usageComplete:this.unknownModelCalls===0&&!!this.usage,estimatedTokens:this.estimatedTokens,error:error?String(error).replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w.-]+|tvly-[\w-]+/gi,'[hidden]').slice(0,180):null};}
}
export function sessionLimits(input){const limit=(v,fallback,max)=>Math.max(1,Math.min(max,Number(v)||fallback));return {maxCalls:Math.floor(limit(input.maxCalls,30,1000)),maxMinutes:limit(input.maxMinutes,30,1440)};}
export function checkSession(session,id,roomId,time=Date.now()){
  if(!id)return;if(!session||session.id!==id||session.roomId!==roomId||session.stopped)throw new Error('会话已结束，请重新开始');
  if(session.calls>=session.maxCalls)throw new Error('已达到本次会话回复次数上限');
  if(time>=session.deadline)throw new Error('已达到本次会话运行时长上限');
}
export function summarizeRuns(runs){
  const models=new Map();
  for(const r of runs){
    const key=r.provider+'|'+r.model,row=models.get(key)||{provider:r.provider,model:r.model,attempts:0,success:0,failed:0,cancelled:0,totalMs:0,firstTextMs:0,firstTextCount:0,tokens:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,cacheReported:0,estimatedTokens:0,knownUsage:0,missingUsage:0,stages:{}};
    row.attempts++;row[r.status==='success'?'success':r.status==='cancelled'?'cancelled':'failed']++;row.totalMs+=r.totalMs;
    if(Number.isFinite(r.firstTextMs)){row.firstTextMs+=r.firstTextMs;row.firstTextCount++;}
    if(r.usage){row.tokens+=r.usage.totalTokens;row.knownUsage++;row.inputTokens+=r.usage.inputTokens||0;row.outputTokens+=r.usage.outputTokens||0;if(typeof r.usage.cachedInputTokens==='number'){row.cachedInputTokens+=r.usage.cachedInputTokens;row.cacheReported++;}}if(!r.usage||r.usageComplete===false)row.missingUsage++;
    row.estimatedTokens+=r.estimatedTokens||0;for(const [stage,ms]of Object.entries(r.stages||{}))row.stages[stage]=(row.stages[stage]||0)+ms;models.set(key,row);
  }
  return [...models.values()].map(r=>({...r,successRate:r.attempts?r.success/r.attempts:0,averageMs:r.totalMs/r.attempts,averageFirstTextMs:r.firstTextCount?r.firstTextMs/r.firstTextCount:null}));
}
