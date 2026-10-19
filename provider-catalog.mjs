export const PRESETS = [
  {id:'openai',name:'OpenAI',protocol:'responses',baseUrl:'https://api.openai.com/v1',auth:'bearer'},
  {id:'anthropic',name:'Claude / Anthropic',protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1',auth:'x-api-key'},
  {id:'gemini',name:'Google Gemini',protocol:'chat',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',auth:'bearer',extra:{reasoning_effort:'low'}},
  {id:'deepseek',name:'DeepSeek',protocol:'chat',baseUrl:'https://api.deepseek.com/v1',auth:'bearer'},
  {id:'qwen',name:'通义千问 / 百炼',protocol:'chat',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',auth:'bearer',extra:{enable_thinking:false}},
  {id:'siliconflow',name:'硅基流动',protocol:'chat',baseUrl:'https://api.siliconflow.cn/v1',auth:'bearer'},
  {id:'openrouter',name:'OpenRouter',protocol:'chat',baseUrl:'https://openrouter.ai/api/v1',auth:'bearer'},
  {id:'groq',name:'Groq',protocol:'chat',baseUrl:'https://api.groq.com/openai/v1',auth:'bearer'},
  {id:'xai',name:'xAI / Grok',protocol:'chat',baseUrl:'https://api.x.ai/v1',auth:'bearer'},
  {id:'mistral',name:'Mistral',protocol:'chat',baseUrl:'https://api.mistral.ai/v1',auth:'bearer'},
  {id:'ollama',name:'Ollama · 本地',protocol:'chat',baseUrl:'http://127.0.0.1:11434/v1',auth:'none',local:true},
  {id:'lmstudio',name:'LM Studio · 本地',protocol:'chat',baseUrl:'http://127.0.0.1:1234/v1',auth:'none',local:true}
];
export const DEFAULT_PROVIDERS=['codex',...PRESETS.map(p=>p.id)];
export function endpoint(base,suffix){return base.replace(/\/+$/,'')+'/'+suffix;}
export function validateProvider(input){
  const p={id:String(input.id||''),name:String(input.name||'').trim().slice(0,60),baseUrl:String(input.baseUrl||'').trim().replace(/\/+$/,''),protocol:input.protocol,auth:input.auth||'bearer',local:!!input.local,extra:input.extra||{}};
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||p.id==='codex')throw new Error('连接 ID 无效');
  if(!p.name||!['chat','responses','anthropic'].includes(p.protocol)||!['bearer','x-api-key','api-key','none'].includes(p.auth))throw new Error('连接协议或认证方式无效');
  const u=new URL(p.baseUrl);if(u.username||u.password||u.search||u.hash)throw new Error('API 地址不能包含凭证、查询参数或片段');
  if(u.protocol!=='https:'&&!(p.local&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('云端 API 使用 HTTPS；本地 HTTP 只允许本机地址');
  if(!p.extra||typeof p.extra!=='object'||Array.isArray(p.extra)||JSON.stringify(p.extra).length>8000)throw new Error('附加请求参数必须是 JSON 对象');
  for(const k of Object.keys(p.extra))if(/^(model|messages|input|instructions|stream|tools|api_key|key|authorization|token|headers)$/i.test(k))throw new Error('附加参数不能替换模型、消息、流式开关或包含凭证');
  return p;
}
