'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const rd=x=>fs.readFileSync(x,'utf8');
const index=rd('index.html');
const sw=rd('sw.js');
const manifest=JSON.parse(rd('manifest.webmanifest'));
const page=rd('.github/workflows/pwa-pages.yml');
const work=rd('work.html');
assert.match(index,/location\.replace\('\.\/work\.html'/);
assert.equal(manifest.start_url,'./work.html');
assert.match(manifest.name,/MANAGEMENT/);
const modules=['pwa-work-client.js','secure-work-store.js','pwa-relay-transport.js','pwa-workspace-merge.js','pwa-owner-sync.js'];
for(const name of modules){
 assert.ok(work.includes('./'+name),'Missing work script '+name);
 assert.ok(sw.includes("'./"+name+"'"),'Offline cache missing '+name);
 assert.ok(page.includes(' '+name+' '),'Build missing '+name);
 assert.ok(fs.existsSync(name),'File missing '+name);
}
for(const legacy of ['app.js','db.js','styles.css','shifts-ui.js',
 'connectivity-test.html','secure-sync-test.html','transport-test.html']){
 assert.ok(!fs.existsSync(legacy),'Obsolete artifact remains '+legacy);
 assert.ok(!sw.includes("'./"+legacy+"'"),'Old SW asset '+legacy);
 assert.ok(!page.includes(' '+legacy+' '),'Legacy file published '+legacy);
}
assert.match(page,/cp index\.html sw\.js manifest\.webmanifest icon\.svg work\.html/);
console.log('✓ Exactly one production entrypoint, all encrypted offline modules cached, no prototype deployed.');
