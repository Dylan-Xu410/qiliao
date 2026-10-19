import {readFile,writeFile,mkdir,rename,readdir,unlink,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {writeDatabase} from './history.mjs';
import {validateWorkspace,safeJSON} from './workspace-state.mjs';
import {validateMemoryState,validAgentId} from './memory.mjs';
import {validateProvider} from './provider-catalog.mjs';
const mediaName=/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/;
function stripSecrets(value){if(Array.isArray(value))return value.map(stripSecrets);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:^|_)(key|api_?key|secret|password|authorization|access_?token|refresh_?token|bearer_?token)(?:$|_)/i.test(key)).map(([key,v])=>[key,stripSecrets(v)]));return value;}
export function prepareBackup(input){
  safeJSON(input);
  if(input?.format!=='agent-lounge-backup'||input.version!==1||input.document?.version!==3)throw new Error('不是受支持的栖聊完整备份');
  const value=structuredClone(input);value.document.state=validateWorkspace(value.document.state);value.memories=validateMemoryState(value.memories);if(!Array.isArray(value.providers)||value.providers.length>100)throw new Error('模型连接备份无效');value.providers=value.providers.map(p=>validateProvider(stripSecrets(p)));
  if(!Array.isArray(value.document.runs)||value.document.runs.length>1000)throw new Error('运行记录备份无效');
  for(const r of value.document.runs){if(typeof r.id!=='string'||!['success','failed','cancelled'].includes(r.status)||!Number.isFinite(r.totalMs)||r.totalMs<0||!Number.isFinite(r.estimatedTokens)||r.estimatedTokens<0||typeof r.provider!=='string'||typeof r.model!=='string'||!r.stages||typeof r.stages!=='object'||Object.values(r.stages).some(ms=>!Number.isFinite(ms)||ms<0)||r.usage&&(!Number.isFinite(r.usage.totalTokens)||r.usage.totalTokens<0))throw new Error('运行记录格式无效');}
  if(value.document.web&&!['auto','duckduckgo','tavily','brave'].includes(value.document.web.provider))throw new Error('联网设置备份无效');
  for(const id of value.document.purgedAgents||[])validAgentId(id);if((value.document.purgedRooms||[]).some(id=>!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))throw new Error('回收站标记无效');value.document.session=null;
  if(!Array.isArray(value.media)||value.media.length>1000)throw new Error('头像备份无效');const names=new Set();let bytes=0;
  for(const file of value.media){if(!mediaName.test(file.name)||names.has(file.name)||typeof file.data!=='string'||file.data.length>2800000)throw new Error('头像文件名或内容无效');names.add(file.name);const b=Buffer.from(file.data,'base64');bytes+=b.length;if(!b.length||bytes>80000000||createHash('sha256').update(b).digest('hex')!==file.sha256)throw new Error('头像校验失败或备份过大');const valid=file.name.endsWith('.png')?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):file.name.endsWith('.jpg')?b[0]===255&&b[1]===216&&b[2]===255:file.name.endsWith('.webp')?b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':b.subarray(0,3).toString()==='GIF';if(!valid)throw new Error('头像格式校验失败');}
  return value;
}
export function backupSummary(value){const s=value.document.state;return {agents:s.agents.length,deletedAgents:s.deletedAgents.length,rooms:s.rooms.length,deletedRooms:s.deletedRooms.length,messages:[...s.rooms,...s.deletedRooms.map(x=>x.room),...s.deletedAgents.flatMap(x=>x.privateRooms||[])].reduce((n,r)=>n+r.messages.length,0),memories:Object.values(value.memories.agents).reduce((n,a)=>n+a.memories.length,0),media:value.media.length,exportedAt:value.exportedAt};}
async function atomic(file,data){await writeFile(file+'.tmp',data);await rename(file+'.tmp',file);}
async function writeRawBackup(directory,bundle){
  await mkdir(directory,{recursive:true});for(const [name,data]of [['workspace.json',bundle.document],['agents.json',bundle.memories],['providers.json',bundle.providers]])await atomic(path.join(directory,name),JSON.stringify(data));
  writeDatabase(directory,bundle.document);
  const media=path.join(directory,'media');await mkdir(media,{recursive:true});for(const file of bundle.media)await atomic(path.join(media,file.name),Buffer.from(file.data,'base64'));
  for(const [id,a]of Object.entries(bundle.memories.agents)){const folder=path.join(directory,'agents',validAgentId(id));await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'soul.md'),a.soul);}
}
export async function recoverStorage(directory){const journal=path.join(directory,'restore-journal.json');try{const data=JSON.parse(await readFile(journal,'utf8')),before=prepareBackup(data.before);await writeRawBackup(directory,before);await unlink(journal);}catch(e){if(e.code!=='ENOENT')throw new Error('完整恢复未完成，请保留数据目录：'+e.message);}}
export class BackupService{
  constructor(directory,workspace,memory,registry){Object.assign(this,{directory,workspace,memory,registry});this.restorePoint=path.join(directory,'restore-point.json');this.journal=path.join(directory,'restore-journal.json');}
  async snapshot(){const document=await this.workspace.snapshot(),memories=await this.memory.snapshot(),providers=this.registry.list().map(({configured,...p})=>stripSecrets(p));if(!document.state)throw new Error('先完成旧记录迁移');const referenced=new Set([...JSON.stringify({document,memories}).matchAll(/\/media\/([a-f0-9]{24}\.(?:png|jpg|webp|gif))/g)].map(m=>m[1]));const media=[];for(const name of referenced){const b=await readFile(path.join(this.directory,'media',name));media.push({name,data:b.toString('base64'),sha256:createHash('sha256').update(b).digest('hex')});}return {format:'agent-lounge-backup',version:1,exportedAt:new Date().toISOString(),document,memories,providers,media};}
  async restore(input){const next=prepareBackup(input),before=await this.snapshot();await atomic(this.restorePoint,JSON.stringify(before));await atomic(this.journal,JSON.stringify({before}));
    const replace=async bundle=>{await this.registry.replaceMetadata(bundle.providers);await this.memory.replaceState(bundle.memories);const dir=path.join(this.directory,'media');await mkdir(dir,{recursive:true});for(const file of bundle.media)await atomic(path.join(dir,file.name),Buffer.from(file.data,'base64'));await this.workspace.transaction(d=>{const revision=d.revision;Object.assign(d,structuredClone(bundle.document),{revision,restoreEpoch:randomUUID(),session:null});});};
    try{await replace(next);await unlink(this.journal);}catch(e){try{await replace(before);await unlink(this.journal);}catch{throw new Error('恢复中断，重启会从恢复日志回滚；请保留数据目录');}throw e;}
    const oldIds=Object.keys(before.memories.agents).filter(id=>!next.memories.agents[id]);for(const id of oldIds){const root=path.resolve(this.directory,'agents'),target=path.resolve(root,validAgentId(id));if(!target.startsWith(root+path.sep))throw new Error('无效角色路径');await rm(target,{recursive:true,force:true});}await this.garbageCollectMedia();return backupSummary(next);
  }
  async garbageCollectMedia(){const current={document:await this.workspace.snapshot(),memories:await this.memory.snapshot()},text=JSON.stringify(current),dir=path.join(this.directory,'media');let files=[];try{files=await readdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;}for(const name of files)if(mediaName.test(name)&&!text.includes('/media/'+name))await unlink(path.join(dir,name));}
}
