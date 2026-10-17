import {all,putAndQueue,removeAndQueue,exportBackup,verifyLocalStorage,getLocalSetting,setLocalSetting,restoreTestBackup} from './db.js';
import {activeShift,renderShifts} from './shifts-ui.js';
const $=s=>document.querySelector(s);
 async function launchWork(url){
  if(navigator.onLine){window.location.assign(url);return}
  try{
   if(await window.CRWorkStore?.hasSnapshot?.()){
    window.location.assign('./work.html');return;
   }
  }catch(error){console.error('Offline snapshot check failed',error)}
  notify('Нет интернета и сохранённой зашифрованной смены. Подключи интернет для первого запуска.');
 }
let view='dashboard',installEvent=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
const notify=s=>{const e=$('#toast');e.textContent=s;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)};
function appConfirm(message){
 return new Promise(resolve=>{
  const backdrop=document.createElement('div');
  backdrop.className='confirm-backdrop';
  backdrop.innerHTML='<div class="confirm-dialog" role="dialog" aria-modal="true"><h2>Подтверждение</h2>'+
   '<p></p><div class="formactions"><button type="button" data-action="cancel">Отмена</button>'+
   '<button type="button" class="primary" data-action="yes">Подтвердить</button></div></div>';
  backdrop.querySelector('p').textContent=message;
  document.body.append(backdrop);
  const finish=value=>{backdrop.remove();resolve(value)};
  backdrop.querySelector('[data-action="cancel"]').onclick=()=>finish(false);
  backdrop.querySelector('[data-action="yes"]').onclick=()=>finish(true);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)finish(false)});
 });
}
async function offlineDiagnostics(){
 let indexedDBReady=false,cacheReady=false,persistent=false,installed=false,workerReady=false;
 let dbError='';
 try{indexedDBReady=await verifyLocalStorage()}catch(err){dbError=String(err.message||err)}
 try{
  const reg=await navigator.serviceWorker?.getRegistration('./');
  workerReady=!!reg?.active;
  if(workerReady&&'caches' in window){
   const cache=await caches.open('cocktail-room-shell-v14');
   const assets=['./index.html','./app.js','./db.js','./shifts-ui.js','./styles.css','./manifest.webmanifest','./icon.svg','./work.html','./pwa-work-client.js','./secure-work-store.js'];
   cacheReady=(await Promise.all(assets.map(path=>cache.match(path)))).every(Boolean);
  }
 }catch(err){dbError=dbError||String(err.message||err)}
 try{persistent=!!(await navigator.storage?.persisted?.())}catch(err){}
 installed=window.matchMedia('(display-mode: standalone)').matches||!!navigator.standalone;
 return {indexedDBReady,workerReady,cacheReady,persistent,installed,dbError};
}
function guideForDevice(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios)return 'iPhone / iPad: открой приложение в Safari → «Поделиться» → «На экран Домой» → «Добавить».';
 if(/Macintosh/.test(navigator.userAgent))return 'MacBook: Safari → «Файл» → «Добавить в Dock» (если поддерживается), либо Chrome → «Установить приложение» в меню.';
 return 'Windows: Chrome или Edge → значок установки в адресной строке либо меню браузера → «Установить приложение».';
}
async function renderInstall(root){
 const d=await offlineDiagnostics();
 const mark=v=>'<strong class="'+(v?'ok':'pending')+'">'+(v?'Готово':'Нет')+'</strong>';
 root.innerHTML='<div class="panel"><div class="split"><h2>Установка и офлайн-режим</h2><span class="tag">PWA · v1.0 beta</span></div>'+
 '<div class="warn">Это отдельный автономный ТЕСТОВЫЙ интерфейс. Он пока не связан с рабочим COCKTAIL ROOM в Apps Script и Google Sheets. Не вводи персональные данные и настоящие смены.</div>'+
 '<div class="offline-checks">'+
 '<div>Локальная база IndexedDB '+mark(d.indexedDBReady)+'</div>'+
 '<div>Service Worker '+mark(d.workerReady)+'</div>'+
 '<div>Файлы интерфейса в офлайн-кэше '+mark(d.cacheReady)+'</div>'+
 '<div>Приложение открыто как установленное '+mark(d.installed)+'</div>'+
 '<div>Защита хранилища от автоматической очистки '+mark(d.persistent)+'</div></div>'+
 (d.dbError?'<p class="error">'+esc(d.dbError)+'</p>':'')+
 '<p class="muted">'+esc(guideForDevice())+'</p>'+
 '<div class="formactions"><button id="check-offline">Повторить проверку</button>'+
 '<button id="persist-storage">Запросить постоянное хранилище</button>'+
 '<button class="primary" id="install-app" '+(installEvent?'':'hidden')+'>Установить</button></div>'+
 '<p class="notice">Без подключения к Google Sheets очередь операций не отправляется никуда. Проверка «готово» относится исключительно к офлайн-тесту на этом устройстве.</p></div>';
 $('#check-offline').onclick=()=>renderInstall(root);
 $('#persist-storage').onclick=async()=>{
  try{const allowed=await navigator.storage?.persist?.();notify(allowed?'Хранилище закреплено':'Браузер не разрешил закрепление хранилища')}
  catch(e){notify('Запрос хранилища недоступен')}
  await renderInstall(root);
 };
 $('#install-app').onclick=async()=>{
  if(!installEvent)return;
  const evt=installEvent;installEvent=null;
  await evt.prompt();
  await evt.userChoice;
  await renderInstall(root);
 };
}
function checkOwnerAppUrl(value){
 try{
  const url=new URL(String(value).trim());
  return url.protocol==='https:'&&url.hostname==='script.google.com'&&
   /^\/macros\/s\/[A-Za-z0-9_-]+\/(dev|exec)\/?$/.test(url.pathname)?url.href:'';
 }catch(err){return ''}
}
function probeOwnerBridge(url){
 // Called directly from a button click: browser may block popups if opened later.
 const bridge=new URL(url);
 bridge.searchParams.set('view','bridge');
 const popup=window.open(bridge.href,'cocktailRoomGoogleSession','width=700,height=650');
 if(!popup)return Promise.resolve({ok:false,error:'Браузер заблокировал окно проверки. Разреши всплывающие окна для COCKTAIL ROOM PWA.'});
 return new Promise(resolve=>{
  const CHANNEL='cocktail-room-bridge-v1';
  let settled=false;
  const finish=value=>{
   if(settled)return;settled=true;
   window.removeEventListener('message',receive);
   clearTimeout(timeout);
   resolve(value);
  };
  function receive(event){
   if(event.data?.channel!==CHANNEL||event.data?.action!=='summary-result')return;
   let host='';
   try{host=new URL(event.origin).hostname}catch(e){}
   if(host!=='script.google.com'&&host!=='script.googleusercontent.com'&&!host.endsWith('.script.googleusercontent.com'))return;
   const result=event.data.result;
   if(result?.ok&&result.summary?.ok)finish({ok:true,summary:result.summary});
   else finish({ok:false,error:String(result?.error||'Google не подтвердил сессию')});
  }
  window.addEventListener('message',receive);
  const timeout=setTimeout(()=>finish({ok:false,error:'Автоматический ответ не пришёл за 30 секунд. Посмотри результат непосредственно в открывшемся окне Google Apps Script; если там показана смена, авторизация работает.'}),30000);
 });
}
async function renderWork(root){
 const saved=await getLocalSetting('ownerAppUrl'),configured=!!checkOwnerAppUrl(saved);
 root.innerHTML='<div class="panel"><h2>Рабочий COCKTAIL ROOM</h2>'+
 '<div class="warn">Рабочие смены и реальные гости по-прежнему находятся в защищённом Google Apps Script. Тестовый PWA НЕ связан с этой базой, и его очередь НЕ отправляется туда.</div>'+
 '<p>Задай адрес рабочей версии один раз на устройстве. Для входа используется Google-аккаунт, доступ к приложению проверяет сервер.</p>'+
 '<form id="owner-app-form"><label class="field">Адрес защищённой версии'+
 '<input name="url" type="url" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off" value="'+esc(saved)+'"></label>'+
 '<div class="formactions"><button type="submit">Сохранить адрес</button>'+
 '<button type="button" id="owner-bridge-probe" '+(configured?'':'disabled')+'>Проверить доступ</button>'+
 '<button type="button" class="primary" id="open-full-work" '+(configured?'':'disabled')+'>Полный интерфейс</button>'+
 '<button type="button" id="open-owner-app" '+(configured?'':'disabled')+'>Открыть Apps Script</button></div></form><p id="owner-bridge-result" class="muted"></p>'+
 '<p class="muted">Допускается только адрес https://script.google.com/macros/s/.../dev или /exec. Адрес сохраняется на этом устройстве. Пароли и токены здесь не хранятся.</p>'+
 '<h3>Режимы</h3><p class="muted">В рабочей версии доступны зал, кальяны, гости, брони, VIP, мойка, история и справочники. Для настоящего офлайн-создания этих операций необходим отдельный защищённый канал синхронизации.</p></div>';
 $('#owner-app-form').onsubmit=async e=>{
  e.preventDefault();const url=checkOwnerAppUrl(new FormData(e.target).get('url'));
  if(!url)return notify('Нужен HTTPS-адрес Apps Script /dev либо /exec');
  await setLocalSetting('ownerAppUrl',url);localStorage.setItem('cr-pwa-work-url',url);notify('Адрес сохранён на устройстве');await renderWork(root);
 };
 $('#owner-bridge-probe').onclick=async()=>{
  const url=checkOwnerAppUrl($('#owner-app-form [name="url"]').value);
  if(!url)return notify('Сначала сохрани адрес Apps Script');
  const status=$('#owner-bridge-result');status.textContent='Проверяем Google-сессию…';
  const result=await probeOwnerBridge(url);
  if(result.ok){
   const summary=result.summary||{};
   status.textContent=summary.active?
    'Доступ подтверждён. Смена: '+(summary.date||'—')+' · кальянов: '+summary.hookahs+
    ' · броней: '+summary.bookings+' · открытых столов: '+summary.tables+
    ' · сумма: '+Number(summary.revenue||0).toLocaleString('ru-RU')+' ₸':
    'Доступ подтверждён. Открытой смены нет.';
   if(summary.discrepancy){
    const p=summary.projection||{};
    status.textContent+=' ВНИМАНИЕ: в HookahOrders сохранено '+Number(p.hookahs||0)+
     ' кальянов на '+Number(p.revenue||0).toLocaleString('ru-RU')+
     ' ₸, но текущее состояние отличается. Автоматического объединения не было.';
   }
  }else status.textContent='Проверка: '+result.error;
 };
 $('#open-full-work').onclick=()=>{
  const url=checkOwnerAppUrl($('#owner-app-form [name="url"]').value);
  if(!url)return notify('Сначала сохрани адрес Apps Script');
  localStorage.setItem('cr-pwa-work-url',url);
  launchWork(url);
 };
 $('#open-owner-app').onclick=()=>{
  const url=checkOwnerAppUrl($('#owner-app-form [name="url"]').value);
  if(!url)return notify('Сначала сохрани адрес Apps Script');
  window.open(url,'_blank','noopener,noreferrer');
 };
}
async function status(){const n=(await all('outbox')).length;$('#status').textContent=(navigator.onLine?'Локально':'Офлайн')+' · очередь: '+n;$('#status').className='pill'+(navigator.onLine?'':' off')}
async function render(){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#page-title').textContent=({dashboard:'Обзор',shifts:'Смены',hookahs:'Кальяны',guests:'Гости',sync:'Состояние данных',install:'Установка и офлайн',work:'Рабочее приложение'})[view];await status();const root=$('#content');
if(view==='dashboard'){const [guests,hookahs,queue]=await Promise.all(['guests','hookahs','outbox'].map(all));root.innerHTML='<div class="cards">'+[['Кальянов в тестовой базе',hookahs.length],['Гостей в тестовой базе',guests.length],['Ожидают передачи',queue.length]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="stat">'+x[1]+'</div></div>').join('')+'</div><div class="panel"><div class="split"><h2>Рабочий COCKTAIL ROOM</h2><button type="button" id="go-working">Настроить связь</button><button type="button" id="go-full-work">Полный интерфейс</button></div><p class="muted">Для настоящих смен используй защищённую Google Apps Script-версию. Тестовая локальная база не синхронизируется с ней.</p></div><div class="panel"><h2>Техническая проверка</h2><div class="warn">Тестовый прототип. Авторизация, шифрование и синхронизация ещё не подключены. Реальные данные вводить нельзя.</div><p class="muted">После первого открытия проверьте отключение интернета, создание записи, перезапуск и наличие записей.</p></div>';}
if(view==='dashboard'){
 $('#go-working').onclick=()=>{view='work';render().catch(console.error)};
 $('#go-full-work').onclick=()=>{
  const url=checkOwnerAppUrl(localStorage.getItem('cr-pwa-work-url')||'');
  if(!url){view='work';render().catch(console.error);notify('Сначала укажи адрес рабочего Google Apps Script');return}
  launchWork(url);
 };
}
if(view==='shifts') { await renderShifts(root, async message=>{notify(message);await render()},appConfirm); }
if(view==='guests'){const items=(await all('guests')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));root.innerHTML='<div class="panel"><div class="split"><h2>Тестовые гости</h2><span class="tag">Только локально</span></div><form id="guest-form"><div class="formgrid"><label class="field">Имя<input name="name" maxlength="100" required placeholder="Тестовый гость"></label><label class="field">Категория<select name="category"><option>Гость</option><option>Новый гость</option><option>Постоянщик</option><option>Редкий гость</option><option>Конфликтный</option></select></label></div><div class="formactions"><button class="primary" type="submit">Добавить гостя</button></div></form></div><div class="panel"><h2>Записи</h2><table><thead><tr><th>Имя</th><th>Категория</th><th>Добавлен</th><th></th></tr></thead><tbody>'+ (items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category)+'</td><td>'+date(x.createdAt)+'</td><td><button data-delete="'+esc(x.id)+'">Удалить</button></td></tr>').join('')||'<tr><td colspan="4" class="empty">Пусто</td></tr>')+'</tbody></table></div>';$('#guest-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await putAndQueue('guests',{id:crypto.randomUUID(),name:String(f.get('name')).trim(),category:String(f.get('category')),createdAt:new Date().toISOString()});notify('Сохранено локально');await render()};root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(await appConfirm('Удалить тестового гостя?')){await removeAndQueue('guests',b.dataset.delete);await render()}})}
if(view==='hookahs'){const shift = await activeShift(); const items=(await all('hookahs')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));root.innerHTML='<div class="panel"><h2>Добавить тестовый кальян</h2><form id="hookah-form"><div class="formgrid"><label class="field">Стол<select name="table">'+Array.from({length:11},(_,i)=>'<option>'+ (i+30)+'</option>').join('')+'</select></label><label class="field">Цена, ₸<input name="price" type="number" min="0" max="1000000" value="3000" required></label><label class="field">Вкус<input name="flavor" maxlength="100" required placeholder="Тестовый вкус"></label><label class="field">Расход табака, г<input name="grams" type="number" min="0" max="100" step="0.1" value="20" required></label></div><div class="formactions"><button class="primary" type="submit" '+(shift?'':'disabled')+'>Сохранить локально</button></div></form></div><div class="panel"><h2>Кальяны</h2><table><thead><tr><th>Стол</th><th>Вкус</th><th>Цена</th><th>Табак</th><th>Дата</th><th></th></tr></thead><tbody>'+(items.map(x=>'<tr><td>'+x.table+'</td><td>'+esc(x.flavor)+'</td><td>'+x.price+' ₸</td><td>'+x.grams+' г</td><td>'+date(x.createdAt)+'</td><td><button data-delete="'+esc(x.id)+'">Удалить</button></td></tr>').join('')||'<tr><td colspan="6" class="empty">Пусто</td></tr>')+'</tbody></table></div>';$('#hookah-form').onsubmit=async e=>{e.preventDefault();const liveShift=await activeShift();if(!liveShift){notify('Сначала откройте смену');return}const f=new FormData(e.target);await putAndQueue('hookahs',{id:crypto.randomUUID(),shiftId:liveShift.id,table:Number(f.get('table')),price:Number(f.get('price')),flavor:String(f.get('flavor')).trim(),grams:Number(f.get('grams')),createdAt:new Date().toISOString()});notify('Сохранено локально');await render()};root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(await appConfirm('Удалить тестовый кальян?')){await removeAndQueue('hookahs',b.dataset.delete);await render()}})}
if(view==='install'){await renderInstall(root)}
if(view==='work'){await renderWork(root)}
if(view==='sync'){const q=await all('outbox');root.innerHTML='<div class="panel"><h2>Локальная база</h2><div class="split"><div><div class="stat">'+q.length+'</div><div class="muted">Операций в очереди</div></div><button id="export">Экспорт тестовой резервной копии</button></div><p class="notice">Синхронизация с Google специально отключена до реализации авторизации и защищённого сервера.</p><div class="formactions"><label class="field">Восстановить тестовую копию (только в пустую базу)<input id="import-file" type="file" accept=".json,application/json"></label><button id="import-backup" type="button">Восстановить</button></div><table><thead><tr><th>Время</th><th>Раздел</th><th>Операция</th></tr></thead><tbody>'+(q.slice(-40).reverse().map(x=>'<tr><td>'+date(x.createdAt)+'</td><td>'+esc(x.entity)+'</td><td>'+esc(x.action)+'</td></tr>').join('')||'<tr><td colspan="3" class="empty">Очередь пуста</td></tr>')+'</tbody></table></div>';$('#import-backup').onclick=async()=>{const file=$('#import-file').files?.[0];if(!file)return notify('Выбери JSON-файл');if(file.size>2000000)return notify('Слишком большой файл');if(!await appConfirm('Восстановить тестовую копию в пустую базу?'))return;try{const count=await restoreTestBackup(JSON.parse(await file.text()));notify('Восстановлено записей: '+count);await render()}catch(e){notify('Ошибка: '+(e.message||e))}};$('#export').onclick=async()=>{const blob=new Blob([JSON.stringify(await exportBackup(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cocktail-room-test-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};}
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{view=b.dataset.view;render().catch(console.error)});window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;if(view==='install')render().catch(console.error)});
window.addEventListener('appinstalled',()=>{installEvent=null;if(view==='install')render().catch(console.error)});
window.addEventListener('online',status);window.addEventListener('offline',status);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.error);
(async()=>{
 const saved=localStorage.getItem('cr-pwa-work-url')||'';
 const url=checkOwnerAppUrl(saved);
 if(url){
  if(navigator.onLine){window.location.replace(url);return}
  try{
   if(await window.CRWorkStore?.hasSnapshot?.()){window.location.replace('./work.html');return}
  }catch(e){console.error('Offline snapshot check failed',e)}
 }
 render().catch(err=>{$('#content').textContent='Ошибка локальной базы: '+err.message});
})();