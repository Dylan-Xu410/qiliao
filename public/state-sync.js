import {mergeWorkspace,reconcileInPlace} from '/workspace-state.js';

// Reconcile existing nodes instead of recreating the page on every state update.
// Keeping the same message/avatar elements avoids replayed animations, image
// flashes, lost text selection and scroll jumps while a reply is being saved.
const renderedHTML=new WeakMap();
function nodeKey(node){
  if(node.nodeType!==1)return null;
  for(const name of ['data-message-id','data-render-key','id','data-room','data-dm','data-agent','data-group-id'])if(node.hasAttribute(name))return name+':'+node.getAttribute(name);
  return null;
}
function compatible(a,b){return a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName);}
function reconcileNode(node,next){
  if(node.isEqualNode(next))return;
  if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;return;}
  for(const {name}of [...node.attributes])if(!next.hasAttribute(name))node.removeAttribute(name);
  for(const {name,value}of next.attributes){const actual=name==='class'&&node.classList.contains('evidence-highlight')&&next.classList.contains('message')&&!next.classList.contains('evidence-highlight')?value+' evidence-highlight':value;if(node.getAttribute(name)!==actual)node.setAttribute(name,actual);}
  reconcileChildren(node,next);
}
function reconcileChildren(parent,next){
  const keyed=new Map([...parent.childNodes].map(n=>[nodeKey(n),n]).filter(([key])=>key));let cursor=parent.firstChild;
  for(const desired of [...next.childNodes]){
    const key=nodeKey(desired);let current=key?keyed.get(key):cursor&&!nodeKey(cursor)&&compatible(cursor,desired)?cursor:null;
    if(current&&!compatible(current,desired))current=null;
    if(!current){current=desired.cloneNode(true);parent.insertBefore(current,cursor);}
    else{if(current!==cursor)parent.insertBefore(current,cursor);reconcileNode(current,desired);}
    cursor=current.nextSibling;
  }
  while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
}
export function patchHTML(element,html,{force=false}={}){
  if(!force&&renderedHTML.get(element)===html)return;
  const template=element.ownerDocument.createElement('template');template.innerHTML=html;
  reconcileChildren(element,template.content);renderedHTML.set(element,html);
}
export function patchMessageFeed(box,html,{roomId,follow=false}={}){
  const changedRoom=box.dataset.renderRoom!==roomId,nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90,oldTop=box.scrollTop,top=box.getBoundingClientRect().top;
  const anchor=!changedRoom&&!follow&&!nearBottom?[...box.children].find(n=>n.hasAttribute('data-message-id')&&n.getBoundingClientRect().bottom>top):null,offset=anchor?.getBoundingClientRect().top;
  if(changedRoom){box.replaceChildren();renderedHTML.delete(box);box.dataset.renderRoom=roomId;}
  // Streaming updates append text outside the full state render. Always compare
  // the live DOM so pause/error also removes an unfinished bubble correctly.
  patchHTML(box,html,{force:true});
  if(changedRoom||follow||nearBottom)box.scrollTop=box.scrollHeight;
  else if(anchor?.parentNode===box)box.scrollTop+=anchor.getBoundingClientRect().top-offset;
  else box.scrollTop=oldTop;
}
export function createStateSync(api){
  let revision=0,epoch=null,baseline=null,previous=null,queue=Promise.resolve(),ready=false,pending=0,stopped=false,remoteBusy=false,polling=false;
  const clean=s=>{const value=structuredClone(s);delete value.activeRoom;return value;};
  const apply=next=>{const active=api.getState().activeRoom;reconcileInPlace(api.getState(),next);api.getState().activeRoom=next.rooms.some(r=>r.id===active)?active:next.rooms[0].id;api.render();};
  const request=async(url,body)=>{const r=await fetch(url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw new Error(data.error||'工作区同步失败');return data;};
  async function initialize(){const local=clean(api.getState());let data=await request('/api/workspace?window=1'),migrated=false;if(!data.state){try{data=await request('/api/workspace',{revision:0,state:local,windowed:true});migrated=true;}catch{data=await request('/api/workspace?window=1');if(!data.state)throw new Error('旧记录迁移未完成');}}revision=data.revision;epoch=data.epoch;baseline=structuredClone(data.state);previous=structuredClone(data.state);apply(data.state);remoteBusy=!!data.busy;ready=true;if(migrated)localStorage.removeItem('agent-lounge-v1');setInterval(poll,2000);return data;}
  function save(){if(!ready||stopped){api.toast('工作区尚未同步，请先重试连接',true);return false;}const next=clean(api.getState()),base=previous;if(JSON.stringify(base)===JSON.stringify(next))return true;previous=structuredClone(next);pending++;
    queue=queue.then(async()=>{if(stopped)return;const data=await request('/api/workspace',{revision,epoch,state:next,base,windowed:true});revision=data.revision;epoch=data.epoch;baseline=structuredClone(data.state);const merged=mergeWorkspace(next,data.state,clean(api.getState()));apply(merged);if(pending===1)previous=structuredClone(merged);}).catch(e=>{stopped=true;api.onFailure(e.message,clean(api.getState()));}).finally(()=>{pending--;});return true;
  }
  async function flush(){await queue;if(stopped)throw new Error('工作区同步失败，请保留未保存记录并重试');}
  async function poll(){if(!ready||stopped||pending||polling||api.isEditing())return;polling=true;try{const data=await request('/api/workspace?window=1&revision='+revision);remoteBusy=!!data.busy;if(data.state){const merged=mergeWorkspace(baseline,data.state,clean(api.getState()));revision=data.revision;epoch=data.epoch;baseline=structuredClone(data.state);previous=structuredClone(merged);apply(merged);}}catch(e){api.toast(e.message,true);}finally{polling=false;}}
  async function refresh(){await flush();const data=await request('/api/workspace?window=1');revision=data.revision;epoch=data.epoch;baseline=structuredClone(data.state);previous=structuredClone(data.state);apply(data.state);remoteBusy=!!data.busy;}
  return {initialize,save,flush,refresh,poll,hasPending:()=>pending>0,isReady:()=>ready&&!stopped,isRemoteBusy:()=>remoteBusy,retry:async()=>{stopped=false;if(!ready)return initialize();await refresh();}};
}
