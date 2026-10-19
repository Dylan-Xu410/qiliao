import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {RESPONSE_SCHEMA} from './core.mjs';
export class CodexBridge{
  constructor(directory){this.directory=directory;this.pending=new Map();this.sessions=new Map();this.listeners=new Set();this.sequence=0;this.child=null;this.starting=null;this.modelsCache=null;this.diagnostics=[];}
  diagnostic(text){this.diagnostics.push({time:new Date().toISOString(),text:String(text).slice(0,300)});this.diagnostics=this.diagnostics.slice(-12);}
  async start(){if(this.starting)return this.starting;this.starting=(async()=>{
    this.child=spawn(process.env.CODEX_BIN||'codex',['app-server','--stdio','-c','mcp_servers={}','-c','features.shell_tool=false','-c','features.apps=false','-c','features.hooks=false','-c','web_search="disabled"','-c','model_providers.lounge_https.name="Agent Lounge HTTPS"','-c','model_providers.lounge_https.base_url="https://chatgpt.com/backend-api/codex"','-c','model_providers.lounge_https.wire_api="responses"','-c','model_providers.lounge_https.requires_openai_auth=true','-c','model_providers.lounge_https.supports_websockets=false'],{cwd:this.directory,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',()=>{});
    const lines=createInterface({input:this.child.stdout});lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch{}});
    this.child.stderr.on('data',chunk=>{const text=String(chunk);if(/websocket|reconnect|retry|failed|timeout/i.test(text))this.diagnostic('Codex 连接事件：'+text.replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w.-]+/gi,'[hidden]').slice(-260));});
    const child=this.child;let didClose=false;
    const closed=e=>{if(didClose)return;didClose=true;if(this.child&&this.child!==child)return;const error=new Error(e?.code==='ENOENT'?'未找到 Codex CLI':'Codex 常驻连接已关闭');for(const p of this.pending.values())p.reject(error);this.pending.clear();for(const fn of this.listeners)fn({method:'bridge/closed'});this.sessions.clear();this.modelsCache=null;this.child=null;this.starting=null;};
    this.child.on('error',closed);this.child.on('exit',()=>closed());
    await this.rpc('initialize',{clientInfo:{name:'agent_lounge',title:'Agent Lounge',version:'0.2.0'}},20000);
    this.send({method:'initialized',params:{}});const account=await this.rpc('account/read',{refreshToken:false});this.subscription=account.account?.type==='chatgpt';return true;
  })();try{return await this.starting;}catch(e){this.close();throw e;}}
  send(message){if(!this.child||this.child.stdin.destroyed)throw new Error('Codex 连接未启动');this.child.stdin.write(JSON.stringify(message)+'\n');}
  rpc(method,params,timeout=15000){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex '+method+' 超时'));},timeout);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  receive(message){
    if(message.id!==undefined&&!message.method){const p=this.pending.get(message.id);if(p){this.pending.delete(message.id);message.error?p.reject(new Error(message.error.message||'Codex 请求失败')):p.resolve(message.result);}return;}
    if(message.id!==undefined&&message.method){const method=message.method;const result=method==='item/tool/call'?{contentItems:[{type:'inputText',text:'本聊天应用不提供该系统工具，请使用JSON联网请求'}],success:false}:method==='item/commandExecution/requestApproval'||method==='item/fileChange/requestApproval'?{decision:'decline'}:{decision:'decline'};this.send({id:message.id,result});return;}
    for(const listener of this.listeners)listener(message);
  }
  async models(){await this.start();if(!this.modelsCache){const r=await this.rpc('model/list',{limit:100});this.modelsCache=r.data||[];}return this.modelsCache;}
  async generate(agent,prompt,signal,onRaw,onPhase){
    await this.start();const models=await this.models();const selected=agent.model?models.find(m=>m.id===agent.model||m.model===agent.model):models.find(m=>(m.model||m.id)==='gpt-6-luna')||models.find(m=>m.isDefault)||models[0];
    const model=agent.model||selected?.model||selected?.id;
    const efforts=(selected?.supportedReasoningEfforts||[]).map(x=>typeof x==='string'?x:x.reasoningEffort);
    const effort=['none','minimal','low'].find(e=>efforts.includes(e))||'low';
    // The app supplies a complete bounded view. Reusing a model thread would append
    // that same view repeatedly. Keep the transport process warm, start a fresh view.
    const key=agent.id+'|'+model+'|'+(agent.conversationKey||'group');
    const result=await this.rpc('thread/start',{model,modelProvider:this.subscription?'lounge_https':undefined,cwd:this.directory,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:'你是栖聊中的闲聊人格。只根据当前用户提供的人设和上下文输出结构化JSON。不要执行任何系统工具。',config:{'features.shell_tool':false,'features.apps':false,'features.hooks':false,'web_search':'disabled','mcp_servers':{}}},25000),session={threadId:result.thread.id};this.sessions.set(key,session);
    if(signal.aborted){this.sessions.delete(key);throw new DOMException('已取消','AbortError');}
    return new Promise((resolve,reject)=>{
      let raw='',turnId=null,usage=null,done=false;const started=Date.now();
      const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);this.listeners.delete(listener);this.sessions.delete(key);this.rpc('thread/unsubscribe',{threadId:session.threadId},10000).catch(()=>{});error?reject(error):resolve(result);};
      const abort=()=>{if(turnId)this.rpc('turn/interrupt',{threadId:session.threadId,turnId}).catch(()=>{});finish(new DOMException('请求已取消','AbortError'));};
      const timer=setTimeout(()=>{if(turnId)this.rpc('turn/interrupt',{threadId:session.threadId,turnId}).catch(()=>{});finish(new Error('Codex 90 秒未完成；可换轻量模型或直连 API'));},90000);
      const listener=e=>{const p=e.params||{};if(e.method==='bridge/closed'){finish(new Error('Codex 连接中断'));return;}if(p.threadId!==session.threadId)return;
        if(e.method==='turn/started')turnId=p.turn?.id||turnId;
        if(e.method==='item/agentMessage/delta'){raw+=p.delta||'';onRaw(raw);}
        if(e.method==='item/completed'&&p.item?.type==='agentMessage'){raw=p.item.text||raw;onRaw(raw);}
        if(e.method==='thread/tokenUsage/updated')usage=p.tokenUsage?.last||p.tokenUsage;
        if(e.method==='error'){if(p.willRetry)onPhase?.('Codex 网络重连中…');else finish(new Error(p.error?.message?.replace(/https?:\/\/\S+/g,'[service]')||'Codex 生成失败'));}
        if(e.method==='turn/completed'){const status=p.turn?.status;if(status==='completed')finish(null,{raw,usage,model,elapsedMs:Date.now()-started});else finish(new Error(p.turn?.error?.message||'Codex 未完成生成'));}
      };
      this.listeners.add(listener);signal.addEventListener('abort',abort,{once:true});
      this.rpc('turn/start',{threadId:session.threadId,input:[{type:'text',text:prompt.instructions+'\n聊天数据：'+prompt.context,text_elements:[]}],model,effort,summary:'none',outputSchema:RESPONSE_SCHEMA,approvalPolicy:'never'},20000).then(result=>{turnId=result.turn?.id||turnId;if(signal.aborted)this.rpc('turn/interrupt',{threadId:session.threadId,turnId}).catch(()=>{});}).catch(e=>finish(e));
    });
  }
  dropAgent(id){for(const key of this.sessions.keys())if(key.startsWith(id+'|'))this.sessions.delete(key);}
  close(){this.child?.kill();this.child=null;this.starting=null;}
}
