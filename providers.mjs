import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {PRESETS,validateProvider,endpoint} from './provider-catalog.mjs';
export class ProviderRegistry{
  constructor(directory){this.file=path.join(directory,'providers.json');this.providers=new Map(PRESETS.map(p=>[p.id,{...p,key:process.env[p.id.toUpperCase()+'_API_KEY']||((p.id==='anthropic')?process.env.ANTHROPIC_API_KEY:'')||''}]));this.ready=this.load();this.queue=Promise.resolve();}
  async load(){await mkdir(path.dirname(this.file),{recursive:true});try{const saved=JSON.parse(await readFile(this.file,'utf8'));for(const p of saved){const clean=validateProvider(p);this.providers.set(p.id,{...clean,key:this.providers.get(p.id)?.key||''});}}catch(e){if(e.code!=='ENOENT')throw e;}}
  list(){return [...this.providers.values()].map(({key,...p})=>({...p,configured:!!key||p.auth==='none'}));}
  async save(input){await this.ready;const p=validateProvider(input),old=this.providers.get(p.id);this.providers.set(p.id,{...p,key:typeof input.key==='string'?input.key.trim().slice(0,3000):old?.key||''});const task=this.queue.then(async()=>{const metadata=this.list().map(({configured,...p})=>p);await writeFile(this.file+'.tmp',JSON.stringify(metadata,null,2));await rename(this.file+'.tmp',this.file);});this.queue=task.catch(()=>{});await task;return this.list();}
  clearKeys(){for(const p of this.providers.values())p.key='';}
  async replaceMetadata(inputs){const clean=inputs.map(validateProvider),old=this.providers;await this.queue;const next=new Map(clean.map(p=>{const existing=old.get(p.id);return [p.id,{...p,key:existing?.baseUrl===p.baseUrl&&existing?.auth===p.auth?existing.key:''}];}));try{await writeFile(this.file+'.tmp',JSON.stringify(clean,null,2));await rename(this.file+'.tmp',this.file);this.providers=next;}catch(e){this.providers=old;throw e;}}
  get(id){const p=this.providers.get(id);if(!p)throw new Error('模型连接不存在');if(p.auth!=='none'&&!p.key)throw new Error('请先配置 '+p.name+' 的 API Key');return p;}
}
export function authHeaders(p){const h={'content-type':'application/json'};if(p.auth==='bearer')h.authorization='Bearer '+p.key;else if(p.auth!=='none')h[p.auth]=p.key;if(p.protocol==='anthropic')h['anthropic-version']='2023-06-01';return h;}
export function buildRequest(p,agent,prompt,settings={}){
  const max=Math.max(400,Math.min(2400,Number(settings.maxOutputTokens)||900)),extra=p.extra||{};
  if(p.protocol==='responses'){const body={...extra,model:agent.model,instructions:prompt.instructions,input:prompt.context,max_output_tokens:max,store:false,stream:true};if(/^gpt-[56]|^o\d/.test(agent.model)&&!body.reasoning)body.reasoning={effort:'low'};return {url:endpoint(p.baseUrl,'responses'),body};}
  if(p.protocol==='anthropic')return {url:endpoint(p.baseUrl,'messages'),body:{...extra,model:agent.model,max_tokens:max,system:prompt.instructions,messages:[{role:'user',content:prompt.context}],stream:true}};
  const body={...extra,model:agent.model,messages:[{role:'system',content:prompt.instructions},{role:'user',content:prompt.context}],max_tokens:max,stream:true};
  if(['openai','deepseek'].includes(p.id)&&extra.stream_options===undefined)body.stream_options={include_usage:true};
  if(p.id==='deepseek'&&!body.thinking)body.thinking={type:'disabled'};
  return {url:endpoint(p.baseUrl,'chat/completions'),body};
}
export async function* sseFrames(stream){let buffer='';const decoder=new TextDecoder();for await(const chunk of stream){buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(data)yield data;}if(buffer.length>2000000)throw new Error('模型输出过长');}buffer+=decoder.decode();const data=buffer.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(data)yield data;}
export async function modelReply(p,agent,prompt,settings,signal,onRaw,fetcher=fetch){
  const req=buildRequest(p,agent,prompt,settings);const response=await fetcher(req.url,{method:'POST',headers:authHeaders(p),body:JSON.stringify(req.body),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),redirect:'error'});
  if(!response.ok){const codes={401:'Key 无效',403:'没有访问权限',404:'模型或 API 地址不存在',429:'额度不足或请求过快'};await response.body?.cancel();throw new Error(`${p.name}：${codes[response.status]||'服务错误'} (${response.status})`);}
  let raw='',usage=null,finish=null;
  const checkResponse=d=>{if(d.error||d.status==='failed')throw new Error(p.name+' 返回生成错误');if(d.status==='incomplete'){if(d.incomplete_details?.reason==='max_output_tokens')finish='max_tokens';else throw new Error(p.name+' 未完成回复，本轮未写入；请重试');}};
  if(!response.headers.get('content-type')?.includes('text/event-stream')){const d=await response.json();if(p.protocol==='responses')checkResponse(d);raw=p.protocol==='anthropic'?d.content?.filter(c=>c.type==='text').map(c=>c.text).join(''):p.protocol==='responses'?d.output?.flatMap(c=>c.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join(''):d.choices?.[0]?.message?.content;finish=finish||(p.protocol==='anthropic'?d.stop_reason:d.choices?.[0]?.finish_reason);usage=d.usage;onRaw(raw||'');}
  else for await(const text of sseFrames(response.body)){if(text==='[DONE]')break;let e;try{e=JSON.parse(text);}catch{continue;}if(e.error||e.type==='error'||e.type==='response.failed')throw new Error(p.name+' 返回生成错误');let delta='';
    if(p.protocol==='responses'){if(e.type==='response.output_text.delta')delta=e.delta;if(['response.completed','response.incomplete'].includes(e.type)){checkResponse(e.response||{status:e.type==='response.incomplete'?'incomplete':'completed'});usage=e.response?.usage;}}
    else if(p.protocol==='anthropic'){if(e.type==='content_block_delta'&&e.delta?.type==='text_delta')delta=e.delta.text;if(e.type==='message_delta')finish=e.delta?.stop_reason||finish;if(e.usage)usage={...(usage||{}),...e.usage};if(e.message?.usage)usage=e.message.usage;}
    else{delta=e.choices?.[0]?.delta?.content||'';if(e.usage)usage=e.usage;finish=e.choices?.[0]?.finish_reason||finish;}
    if(delta){raw+=delta;onRaw(raw);}
  }
  if(['length','max_tokens'].includes(finish))throw new Error('输出达到 token 上限，本轮未写入；请在连接设置增加输出上限或减少人设长度');
  if(!raw)throw new Error('模型没有返回文本');return {raw,usage};
}
export async function listModels(p,signal){const response=await fetch(endpoint(p.baseUrl,'models'),{headers:authHeaders(p),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error'});if(!response.ok)throw new Error('无法读取模型列表 ('+response.status+')；仍可手填模型 ID');const data=await response.json();return(data.data||data.models||[]).map(m=>({id:m.id||m.name,name:m.display_name||m.id||m.name})).filter(m=>m.id).slice(0,1000);}
