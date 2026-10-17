const NAME='cocktail-room-local-v1';const VERSION=2;
export function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(NAME,VERSION);req.onupgradeneeded=()=>{const db=req.result;for(const [name,keyPath] of [['guests','id'],['hookahs','id'],['shifts','id'],['outbox','operationId'],['meta','key']]){if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath});}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function complete(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Транзакция прервана'));});}
export async function all(store){const db=await openDB();try{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).getAll();const result=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});await complete(tx);return result;}finally{db.close();}}
export async function putAndQueue(store,record){const db=await openDB();try{const tx=db.transaction([store,'outbox'],'readwrite');tx.objectStore(store).put(record);tx.objectStore('outbox').put({operationId:crypto.randomUUID(),entity:store,recordId:record.id,action:'upsert',payload:record,createdAt:new Date().toISOString()});await complete(tx);return record;}finally{db.close();}}
export async function removeAndQueue(store,id){const db=await openDB();try{const tx=db.transaction([store,'outbox'],'readwrite');tx.objectStore(store).delete(id);tx.objectStore('outbox').put({operationId:crypto.randomUUID(),entity:store,recordId:id,action:'delete',createdAt:new Date().toISOString()});await complete(tx);}finally{db.close();}}
export async function exportBackup(){const data={format:'cocktail-room-local-backup-v1',exportedAt:new Date().toISOString()};for(const store of ['guests','hookahs','shifts','outbox'])data[store]=await all(store);return data;}
/** Test write/read/delete entirely inside IndexedDB, without touching shifts or outbox. */
export async function verifyLocalStorage(){
 const db=await openDB(),key='offline-probe';
 try{
  let tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({key,value:'ready',at:new Date().toISOString()});await complete(tx);
  tx=db.transaction('meta','readonly');
  const req=tx.objectStore('meta').get(key);
  const value=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  await complete(tx);
  if(value?.value!=='ready')throw new Error('Локальная запись не прочиталась');
  tx=db.transaction('meta','readwrite');tx.objectStore('meta').delete(key);await complete(tx);
  return true;
 }finally{db.close()}
}

/** Set a device-local, owner-supplied Apps Script URL. Never sync/export this setting. */
export async function getLocalSetting(key){
 const db=await openDB();
 try{
  const tx=db.transaction('meta','readonly'),q=tx.objectStore('meta').get('setting:'+key);
  const record=await new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  await complete(tx);return record?.value||'';
 }finally{db.close()}
}
export async function setLocalSetting(key,value){
 const db=await openDB();
 try{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({key:'setting:'+key,value});await complete(tx)}
 finally{db.close()}
}
/** Human-confirmed backup recovery, only when the local database is empty. */
export async function restoreTestBackup(backup){
 if(!backup||backup.format!=='cocktail-room-local-backup-v1')throw new Error('Неверный формат тестовой копии');
 const stores=['guests','hookahs','shifts','outbox'];
 for(const key of stores){
  if(!Array.isArray(backup[key])||backup[key].length>10000)throw new Error('Неверный раздел: '+key);
  if((await all(key)).length)throw new Error('В этой базе уже есть данные. Восстановление заблокировано, чтобы не потерять записи.');
 }
 const db=await openDB();
 try{
  const tx=db.transaction(stores,'readwrite');
  for(const key of stores)for(const row of backup[key]){
   if(!row||typeof row!=='object'||!row[key==='outbox'?'operationId':'id'])throw new Error('Неверный ID записи');
   tx.objectStore(key).put(row);
  }
  await complete(tx);return stores.reduce((n,k)=>n+backup[k].length,0);
 }finally{db.close()}
}
