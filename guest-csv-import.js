'use strict';
/** Private, owner-selected Google Sheets Guests CSV -> encrypted PWA records.
 * This module parses uploaded bytes locally; it never sends plaintext to
 * GitHub or any external endpoint. Persistence is owned by CRPilot. */
(function(root){
 function rowsOf(text){
  if(typeof text!=='string'||text.length>6_000_000)throw Error('CSV слишком большой (максимум 6 МБ)');
  text=text.replace(/^\uFEFF/,'');
  const rows=[],row=[];let value='',quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(quoted){
    if(c==='"'){
     if(text[i+1]==='"'){value+='"';i++}else{quoted=false;afterQuote=true}
    }else value+=c;
   }else if(afterQuote){
    if(c===','){row.push(value);value='';afterQuote=false}
    else if(c==='\r'||c==='\n'){
     row.push(value);rows.push(row.splice(0));value='';afterQuote=false;
     if(c==='\r'&&text[i+1]==='\n')i++;
    }else if(c!==' '&&c!=='\t')throw Error('Некорректные кавычки в CSV');
   }else if(c==='"'){
    if(value)throw Error('Некорректное поле CSV с кавычками');
    quoted=true;
   }else if(c===','){row.push(value);value=''}
   else if(c==='\r'||c==='\n'){
    row.push(value);rows.push(row.splice(0));value='';
    if(c==='\r'&&text[i+1]==='\n')i++;
   }else value+=c;
   if(value.length>4000)throw Error('Слишком длинное поле в CSV');
   if(rows.length>10000)throw Error('CSV содержит слишком много строк');
  }
  if(quoted)throw Error('Незакрытые кавычки в CSV');
  if(value||row.length||afterQuote){row.push(value);rows.push(row)}
  return rows.filter(r=>r.some(x=>String(x||'').trim()));
 }
 const normalizedName=x=>String(x||'').trim().toLocaleLowerCase('ru').replace(/\s+/g,' ');
 const normalizedPhone=x=>String(x||'').replace(/\D/g,'');
 function plan(csv,existing){
  const rows=rowsOf(csv);
  if(!rows.length)throw Error('CSV пустой');
  const headers=rows.shift().map(x=>String(x).trim().toLowerCase());
  const required=['guest_id','name','phone','category','birthday','comment','source','created_at','deleted_at'];
  for(const name of required)if(!headers.includes(name))
   throw Error('Выбран не лист Guests: отсутствует колонка '+name);
  const get=(line,key)=>String(line[headers.indexOf(key)]||'').trim();
  const current=Array.isArray(existing)?existing:[];
  const ids=new Set(current.map(g=>String(g.id||'')).filter(Boolean));
  const names=new Set(current.map(g=>normalizedName(g.name)).filter(Boolean));
  const phones=new Set(current.map(g=>normalizedPhone(g.phone)).filter(Boolean));
  const added=[],stats={total:rows.length,added:0,duplicates:0,deleted:0,invalid:0};
  for(const line of rows){
   const name=get(line,'name'),id=get(line,'guest_id'),
    phone=get(line,'phone');
   if(get(line,'deleted_at')){stats.deleted++;continue}
   if(!name||name.length>90||id.length>120||phone.length>50){stats.invalid++;continue}
   const nameKey=normalizedName(name),phoneKey=normalizedPhone(phone);
   if((id&&ids.has(id))||names.has(nameKey)||(phoneKey&&phones.has(phoneKey))){
    stats.duplicates++;continue;
   }
   const birthday=get(line,'birthday');
   added.push({
    id:id||('import-'+String(stats.total)+'-'+String(added.length)),
    name,phone,category:get(line,'category'),birthday,
    comment:get(line,'comment'),source:get(line,'source'),
    createdAt:get(line,'created_at')||new Date().toISOString()
   });
   ids.add(added[added.length-1].id);names.add(nameKey);
   if(phoneKey)phones.add(phoneKey);
  }
  stats.added=added.length;
  if(!added.length&&stats.invalid===stats.total)throw Error('В CSV нет корректных гостей');
  return {added,stats};
 }
 root.CRGuestCSV={plan,rowsOf};
})(window);
