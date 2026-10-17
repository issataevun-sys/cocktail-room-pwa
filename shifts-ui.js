import {all, putAndQueue} from './db.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[ch]));
const localDate = () => {
  const d = new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};

export async function activeShift() {
  const open = (await all('shifts')).filter(x => x.status === 'open');
  if (open.length > 1) throw new Error('Несколько открытых смен — требуется проверка данных');
  return open[0] ?? null;
}

export async function renderShifts(root, onUpdate, appConfirm) {
  const [shifts,hookahs] = await Promise.all([all('shifts'),all('hookahs')]);
  const open = shifts.filter(s=>s.status==='open');
  const current = open.length===1 ? open[0] : null;
  const ordered = shifts.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));

  root.innerHTML = `<div class="panel">
    <div class="split"><h2>Смена · тестовый режим</h2><span class="tag">Только IndexedDB</span></div>
    <div class="warn">Это тестирование локального учёта, НЕ вход по PIN. Реальных сотрудников и персональные данные пока не вводим.</div>
    ${open.length>1 ? '<p class="error">Обнаружено несколько открытых смен: создание и закрытие заблокированы.</p>' : ''}
    ${current ? `<p><strong>Открыта смена ${esc(current.shiftDate)}</strong></p>
      <p class="muted">Кальянщики: ${current.employees.map(esc).join(' / ')}</p>
      <p class="muted">Официант: ${esc(current.waiter || '—')} · Открыта: ${new Date(current.openedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</p>
      <div class="cards">
        <div class="card"><div class="muted">Кальянов</div><div class="stat">${hookahs.filter(h=>h.shiftId===current.id).length}</div></div>
        <div class="card"><div class="muted">Выручка кальянов</div><div class="stat">${hookahs.filter(h=>h.shiftId===current.id).reduce((n,h)=>n+Number(h.price||0),0).toLocaleString('ru-RU')} ₸</div></div>
        <div class="card"><div class="muted">Расход табака</div><div class="stat">${hookahs.filter(h=>h.shiftId===current.id).reduce((n,h)=>n+Number(h.grams||0),0).toLocaleString('ru-RU')} г</div></div>
      </div>
      <div class="formactions"><button id="close-shift" class="primary" ${open.length!==1?'disabled':''}>Закрыть смену</button></div>
      ` : `<form id="shift-form">
         <div class="formgrid">
          <label class="field">Дата смены<input type="date" name="shiftDate" value="${localDate()}" required></label>
          <label class="field">Кальянщик 1 (тест)<input name="employee1" maxlength="70" required placeholder="Тест 1"></label>
          <label class="field">Кальянщик 2 (необязательно)<input name="employee2" maxlength="70" placeholder="Тест 2"></label>
          <label class="field">Официант смены<input name="waiter" maxlength="70" placeholder="Необязательно"></label>
         </div>
         <div class="formactions"><button class="primary" type="submit" ${open.length?'disabled':''}>Открыть смену</button></div>
       </form>`}
    </div>
    <div class="panel"><h2>История смен на устройстве</h2><table><thead><tr><th>Дата</th><th>Сотрудники</th><th>Статус</th></tr></thead><tbody>
    ${ordered.map(s=>`<tr><td>${esc(s.shiftDate)}</td><td>${s.employees.map(esc).join(' / ')}</td><td>${s.status==='open'?'Открыта':'Закрыта'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Смен пока нет</td></tr>'}
    </tbody></table></div>`;

  const form = root.querySelector('#shift-form');
  if(form) form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form);
    const names = [String(data.get('employee1')||'').trim(),String(data.get('employee2')||'').trim()].filter(Boolean);
    if (names.length===2 && names[0].toLowerCase()===names[1].toLowerCase()) {
      await onUpdate('Нужны два разных имени');return;
    }
    if((await all('shifts')).some(s=>s.status==='open')) {
      await onUpdate('Сначала закройте открытую смену');return;
    }
    const now=new Date().toISOString();
    await putAndQueue('shifts',{
      id:crypto.randomUUID(),shiftDate:String(data.get('shiftDate')),employees:names,
      waiter:String(data.get('waiter')||'').trim(),status:'open',openedAt:now,
      closedAt:null,createdAt:now,updatedAt:now
    });
    await onUpdate('Смена сохранена локально');
  };
  const close = root.querySelector('#close-shift');
  if(close && current) close.onclick=async()=>{
    if(!await appConfirm('Закрыть тестовую смену?'))return;
    const actual=await activeShift();
    if(!actual || actual.id!==current.id) {
      await onUpdate('Смена изменилась. Обнови экран.');return;
    }
    await putAndQueue('shifts',{...actual,status:'closed',closedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    await onUpdate('Смена закрыта локально');
  };
}
