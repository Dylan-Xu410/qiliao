import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const allRooms=s=>s?[...s.rooms,...s.deletedRooms.map(x=>x.room),...s.deletedAgents.flatMap(x=>x.privateRooms||[])]:[];
export function acquireServerLock(directory){const db=connect(directory),nonce=randomUUID(),scope=path.resolve(directory);try{db.exec('BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS server_lock(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL,scope TEXT NOT NULL)');const prior=db.prepare('SELECT * FROM server_lock WHERE id=1').get();if(prior&&prior.scope===scope){let alive=true;try{process.kill(prior.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw new Error('这个数据目录已有栖聊服务在运行，请使用已有实例');}db.prepare('INSERT INTO server_lock(id,pid,nonce,scope) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,nonce=excluded.nonce,scope=excluded.scope').run(process.pid,nonce,scope);db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}db.close();throw e;}return ()=>{try{db.prepare('DELETE FROM server_lock WHERE nonce=?').run(nonce);}finally{db.close();}};}
function connect(directory){
  const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{timeout:5000});
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(room TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(room,id));
    CREATE INDEX IF NOT EXISTS message_order ON messages(room,position);
    CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(text,content='messages',content_rowid='rowid',tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS msg_insert AFTER INSERT ON messages BEGIN INSERT INTO message_search(rowid,text) VALUES(new.rowid,new.text); END;
    CREATE TRIGGER IF NOT EXISTS msg_delete AFTER DELETE ON messages BEGIN INSERT INTO message_search(message_search,rowid,text) VALUES('delete',old.rowid,old.text); END;
    CREATE TRIGGER IF NOT EXISTS msg_update AFTER UPDATE ON messages BEGIN INSERT INTO message_search(message_search,rowid,text) VALUES('delete',old.rowid,old.text); INSERT INTO message_search(rowid,text) VALUES(new.rowid,new.text); END;`);
  return db;
}
export function readDatabase(directory){const db=connect(directory);try{const row=db.prepare('SELECT document FROM metadata WHERE id=1').get();if(!row)return null;const document=JSON.parse(row.document);for(const room of allRooms(document.state))room.messages=db.prepare('SELECT payload FROM messages WHERE room=? ORDER BY position').all(room.id).map(x=>JSON.parse(x.payload));return document;}finally{db.close();}}
// Only changed message rows are written. The metadata and all history changes
// share one SQLite transaction, including trash moves, clears and full restores.
export function writeDatabase(directory,document,before=null){
  const db=connect(directory);try{db.exec('BEGIN IMMEDIATE');const nextRooms=allRooms(document.state),ids=new Set(nextRooms.map(r=>r.id));
    for(const {room}of db.prepare('SELECT DISTINCT room FROM messages').all())if(!ids.has(room))db.prepare('DELETE FROM messages WHERE room=?').run(room);
    const oldRooms=new Map(allRooms(before?.state).map(r=>[r.id,r]));
    const upsert=db.prepare('INSERT INTO messages(room,id,position,payload,text) VALUES(?,?,?,?,?) ON CONFLICT(room,id) DO UPDATE SET position=excluded.position,payload=excluded.payload,text=excluded.text');
    for(const room of nextRooms){const prior=oldRooms.get(room.id),old=new Map((prior?.messages||[]).map((m,i)=>[m.id,{payload:JSON.stringify(m),position:i}])),keep=new Set(room.messages.map(m=>m.id));
      const stored=prior?prior.messages:db.prepare('SELECT id FROM messages WHERE room=?').all(room.id);
      for(const m of stored)if(!keep.has(m.id))db.prepare('DELETE FROM messages WHERE room=? AND id=?').run(room.id,m.id);
      room.messages.forEach((m,i)=>{const payload=JSON.stringify(m),previous=old.get(m.id);if(previous?.payload!==payload||previous?.position!==i)upsert.run(room.id,m.id,i,payload,m.text);});
    }
    const meta=structuredClone(document);for(const r of allRooms(meta.state))r.messages=[];
    db.prepare('INSERT INTO metadata(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(JSON.stringify(meta));db.exec('COMMIT');
  }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
}
export function queryHistory(directory,{roomId,before,anchor,query='',limit=60,activeRooms=null}={}){
  const db=connect(directory);try{limit=Math.max(1,Math.min(100,Number(limit)||60));let where=[],args=[];
    if(roomId){where.push('room=?');args.push(roomId);}if(activeRooms){if(!activeRooms.length)return {messages:[],hasMore:false};where.push('room IN ('+activeRooms.map(()=>'?').join(',')+')');args.push(...activeRooms);}
    if(anchor){const row=db.prepare('SELECT position FROM messages WHERE room=? AND id=?').get(roomId,anchor);if(!row)throw new Error('原消息已清空或删除');where.push('position BETWEEN ? AND ?');args.push(Math.max(0,row.position-25),row.position+25);}
    if(before){const row=db.prepare('SELECT position FROM messages WHERE room=? AND id=?').get(roomId,before);if(!row)throw new Error('历史游标已失效，请刷新后重试');where.push('position<?');args.push(row.position);}
    query=String(query).trim().slice(0,200);if(query){if([...query].length>=3){where.push('rowid IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)');args.push('"'+query.replaceAll('"','""')+'"');}else{where.push('instr(lower(text),lower(?))>0');args.push(query);}}
    const rows=db.prepare('SELECT room,payload FROM messages'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY position DESC LIMIT ?').all(...args,limit+1),hasMore=rows.length>limit;
    return {messages:rows.slice(0,limit).map(x=>({...JSON.parse(x.payload),roomId:x.room})).reverse(),hasMore};
  }finally{db.close();}
}
