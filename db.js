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
