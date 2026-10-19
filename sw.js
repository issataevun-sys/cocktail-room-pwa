const CACHE='cocktail-room-shell-v27';
const PREFIX='cocktail-room-shell-';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./work.html','./pwa-work-client.js','./secure-work-store.js','./pwa-relay-transport.js','./pwa-workspace-merge.js','./pwa-owner-sync.js'];
const FILES=new Set(['','index.html','manifest.webmanifest','icon.svg','work.html','pwa-work-client.js','secure-work-store.js','pwa-relay-transport.js','pwa-workspace-merge.js','pwa-owner-sync.js']);
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
  const cached=await cache.match(req,{ignoreSearch:true})||
   (req.mode==='navigate'?await cache.match('./work.html'):null);
  // Use fresh code on a healthy connection, but do not stall the whole
  // offline-first app on a slow network that never finishes a request.
  const network=fetch(req,{cache:'no-store'}).then(async response=>{
   if(response.ok&&response.type==='basic')await cache.put(req,response.clone());
   return response;
  });
  if(!cached)return network;
  // The update may still finish and refresh the cache after we show the
  // existing shell. Keep that revalidation alive in the service worker.
  event.waitUntil(network.catch(()=>{}));
  let timer;
  try{
   return await Promise.race([
    network.catch(()=>cached),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(cached),2500);})
   ]);
  }finally{clearTimeout(timer);}
 })());
});
