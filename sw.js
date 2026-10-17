const CACHE='cocktail-room-shell-v4';
const PREFIX='cocktail-room-shell-';
const ASSETS=['./','./index.html','./styles.css','./app.js','./db.js','./shifts-ui.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.registration.scope).pathname))return;
 // Only cache explicit offline shell files; never cache app-server responses or private content.
 const path=url.pathname.slice(new URL('./',self.registration.scope).pathname.length);
 if(!['','index.html','styles.css','app.js','db.js','shifts-ui.js','manifest.webmanifest','icon.svg'].includes(path))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  try{return await fetch(request)}catch(error){
   if(request.mode==='navigate'){const fallback=await cache.match('./index.html');if(fallback)return fallback}
   throw error;
  }
 })());
});
