const CACHE='cocktail-room-shell-v14';
const PREFIX='cocktail-room-shell-';
const ASSETS=['./','./index.html','./styles.css','./app.js','./db.js','./shifts-ui.js','./manifest.webmanifest','./icon.svg','./work.html','./pwa-work-client.js','./secure-work-store.js'];
const FILES=new Set(['','index.html','styles.css','app.js','db.js','shifts-ui.js','manifest.webmanifest','icon.svg','work.html','pwa-work-client.js','secure-work-store.js']);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url),root=new URL('./',self.registration.scope);
 if(req.method!=='GET'||url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return;
 const path=url.pathname.slice(root.pathname.length);
 if(!FILES.has(path))return; // Never cache protected data or server calls.
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   // Network first: deploy updates are picked up while online. Cache still works offline.
   const response=await fetch(req,{cache:'no-store'});
   if(response.ok&&response.type==='basic')await cache.put(req,response.clone());
   return response;
  }catch(error){
   const cached=await cache.match(req,{ignoreSearch:true})||
    (req.mode==='navigate'?await cache.match('./index.html'):null);
   if(cached)return cached;
   throw error;
  }
 })());
});
