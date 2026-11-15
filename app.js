import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const ready = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('_HERE') &&
  SUPABASE_PUBLISHABLE_KEY.length > 20 && !SUPABASE_PUBLISHABLE_KEY.includes('_HERE');
const setup = document.querySelector('#setup');
const login = document.querySelector('#login');
const app = document.querySelector('#app');
const page = document.querySelector('#page');
const notice = document.querySelector('#notice');
let db, session, profile, platforms = [], profiles = [], currentPage = 'overview';

if (!ready) setup.classList.remove('hidden');
else {
  db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  start();
}

async function start() {
  const { data } = await db.auth.getSession();
  if (data.session) await enter(data.session);
  else showLogin();
  db.auth.onAuthStateChange((_event, next) => {
    if (!next) showLogin();
  });
}

function showLogin() { app.classList.add('hidden'); login.classList.remove('hidden'); }
function showApp() { login.classList.add('hidden'); setup.classList.add('hidden'); app.classList.remove('hidden'); }
function msg(text, bad = false) {
  notice.textContent = text;
  notice.classList.toggle('hidden', !text);
  notice.classList.toggle('error-notice', bad);
  if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(value, currency = 'GBP') { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
function parseLocalizedAmount(value) {
  let normalized=String(value??'').trim().replace(/\s/g,'');
  if(!normalized)return NaN;
  if(normalized.includes(',')&&normalized.includes('.')) {
    normalized=normalized.lastIndexOf(',')>normalized.lastIndexOf('.')
      ? normalized.replace(/\./g,'').replace(',','.')
      : normalized.replace(/,/g,'');
  } else if(normalized.includes(',')) normalized=normalized.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) normalized=normalized.replace(/\./g,'');
  const amount=Number(normalized);
  return Number.isFinite(amount)?amount:NaN;
}
function niceDate(value) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR') : '—'; }
function today() { return new Date().toISOString().slice(0, 10); }
function weekDates() {
  const d = new Date(); d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d); monday.setDate(d.getDate() - day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start:monday.toISOString().slice(0,10), end:sunday.toISOString().slice(0,10) };
}
function roleName(role) { return ({admin:'Yönetici',assistant:'Asistan / Kayıtçı',consultant:'Danışman',subagency_owner:'Alt ajans sahibi'})[role] || role; }
function statusName(value) { return ({new:'Yeni',contacted:'İletişim kuruldu',reviewing:'Değerlendirmede',accepted:'Kabul edildi',declined:'Uygun değil',active:'Aktif',paused:'Duraklatıldı',left:'Ayrıldı',review:'Kontrol edilecek',inactive:'Pasif'})[value] || value; }

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const errorBox = document.querySelector('#login-error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = 'Giriş yapılıyor…'; errorBox.textContent = '';
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/username-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    const result = await response.json();
    if (!response.ok || !result.session) throw new Error(result.error || 'Giriş yapılamadı.');
    await db.auth.setSession(result.session);
    session = result.session;
    await enter(result.session, result.must_change_password);
  } catch (error) { errorBox.textContent = error.message || 'Bağlantı kurulamadı.'; }
  finally { button.disabled = false; button.textContent = 'Giriş yap'; }
});

async function enter(nextSession, forcePasswordChange = false) {
  session = nextSession;
  const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !data || !data.active) {
    await db.auth.signOut();
    document.querySelector('#login-error').textContent = 'Bu hesabın panele erişimi kapalı.';
    return showLogin();
  }
  profile = data;
  showApp();
  document.querySelector('#user-name').textContent = profile.full_name;
  document.querySelector('#user-role').textContent = roleName(profile.role);
  document.querySelector('#user-avatar').textContent = profile.full_name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  await loadPlatforms();
  buildNav();
  if (forcePasswordChange || profile.must_change_password) return renderPasswordChange();
  await openPage('overview');
}

async function loadPlatforms() {
  const { data } = await db.from('platforms').select('*').order('name');
  platforms = data || [];
}
async function loadProfiles() {
  if (profile.role !== 'admin' && profile.role !== 'subagency_owner') return [];
  const { data } = await db.from('profiles').select('id,full_name,username,role,agency_id,active,email,phone').order('full_name');
  profiles = data || [];
  return profiles;
}

function buildNav() {
  const entries = [{heading:'ÇALIŞMA ALANI'},{id:'overview',icon:'▦',name:'Genel Bakış'}];
  if (['admin','consultant','subagency_owner'].includes(profile.role)) entries.push({id:'creators',icon:'♙',name:'Yayıncılar'});
  if (['admin','subagency_owner'].includes(profile.role)) entries.push({id:'finance',icon:'₺',name:'Gelir & Gider'});
  entries.push({id:'performance',icon:'↗',name:'Performans'});
  if (profile.role === 'admin') entries.push({id:'users',icon:'♧',name:'Kullanıcı Yönetimi'});
  entries.push({heading:'UYGULAMALAR'});
  platforms.forEach(p=>entries.push({id:`platform:${p.id}`,icon:p.name.slice(0,1).toUpperCase(),name:p.name,status:p.status}));
  const nav=document.querySelector('#nav');
  nav.innerHTML=entries.map(item=>item.heading?`<div class="nav-heading">${esc(item.heading)}</div>`:`<button data-page="${esc(item.id)}" class="${item.id===currentPage?'active':''}"><span class="nav-symbol">${esc(item.icon)}</span>${esc(item.name)}${item.status?`<span class="nav-status">${item.status==='active'?'Aktif':item.status==='review'?'Kontrol':'Pasif'}</span>`:''}</button>`).join('');
  nav.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>openPage(button.dataset.page)));
}

async function openPage(id) {
  currentPage=id;
  const platform = id.startsWith('platform:') ? platforms.find(p=>p.id===id.split(':')[1]) : null;
  const title = platform?.name || ({overview:'Genel Bakış',creators:'Yayıncılar',finance:'Gelir & Gider',performance:'Performans',users:'Kullanıcı Yönetimi'}[id] || 'Panel');
  document.querySelector('#breadcrumb').textContent=title;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  msg('');
  if (profile.must_change_password) return renderPasswordChange();
  if (id==='overview') return renderOverview();
  if (id==='creators') return renderCreators();
  if (id==='finance') return renderFinance();
  if (id==='performance') return renderPerformance();
  if (id==='users') return renderUsers();
  if (platform) return renderPlatform(platform);
}

function titleBlock(title, subtitle, action='') { return `<div class="page-title"><div><div class="eyebrow-small">Red Line Ajans · Özel panel</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`; }
function cardMetric(label,value,foot='') { return `<article class="card"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`; }
function table(headers, rows, empty='Henüz kayıt yok.') { return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}"><div class="empty">${esc(empty)}</div></td></tr>`}</tbody></table></div>`; }
function platformOptions(selected='',includeAll=false) { return `<option value="">Platform seç</option>${includeAll?'<option value="all">Hepsi / Genel kayıt</option>':''}${platforms.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}`; }
function roleUsersOptions(selected='') { return `<option value="">Kendime ata</option>${profiles.filter(p=>p.active).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.full_name)} · ${esc(roleName(p.role))}</option>`).join('')}`; }
async function renderOverview() {
  const count = async tableName => { const {count}=await db.from(tableName).select('id',{count:'exact',head:true}); return count||0; };
  const [creatorCount,financeResult,performanceResult] = await Promise.all([
    count('creators'), db.from('financial_entries').select('entry_type,amount,currency'), db.from('performance_entries').select('revenue_contribution,currency')
  ]);
  const totals={}; (financeResult.data||[]).forEach(row=>{const c=row.currency||'GBP';totals[c]??={income:0,expense:0};totals[c][row.entry_type]+=Number(row.amount||0)});
  const rev={}; (performanceResult.data||[]).forEach(r=>{const c=r.currency||'GBP';rev[c]=(rev[c]||0)+Number(r.revenue_contribution||0)});
  const financialText=Object.keys(totals).length?Object.entries(totals).map(([c,v])=>`${c}: net ${money(v.income-v.expense,c)}`).join(' · '):'Henüz gelir/gider kaydı yok';
  const revenueText=Object.keys(rev).length?Object.entries(rev).map(([c,v])=>`${c}: ${money(v,c)}`).join(' · '):'Henüz ciro katkısı girilmedi';
  page.innerHTML=`${titleBlock('Genel Bakış','Yetki alanındaki yayıncı, performans ve finans özetleri.')}
    <div class="cards">${cardMetric('Yayıncı',creatorCount,'Erişebildiğin profiller')}${cardMetric('Ciro katkısı',revenueText,'Performans kayıtlarından')}${cardMetric('Gelir − gider',financialText,'Yetkine açık kayıtlar')}</div>
    <div class="columns"><article class="card"><h2>Hızlı bağlantılar</h2><p>İşlem yapmak istediğin bölümü aç.</p><div class="form-actions"><button class="button" data-open="creators">Yayıncılar</button><button class="button" data-open="performance">Performans</button></div></article><article class="card"><h2>Güvenli erişim</h2><p>Bu oturumda yalnızca rolüne ve bağlı olduğun ekibe izin verilen kayıtlar gösterilir.</p><span class="pill">${esc(roleName(profile.role))}</span></article></div>`;
  page.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openPage(b.dataset.open)));
}

async function renderCreators() {
  const {data,error}=await db.from('creators').select('*,platforms(name)').order('created_at',{ascending:false}).limit(100);
  if(error) return page.innerHTML=titleBlock('Yayıncılar','Erişim alanındaki yayıncı profilleri.')+`<div class="empty">${esc(error.message)}</div>`;
  const records=data||[];
  page.innerHTML=`${titleBlock('Yayıncılar','Sorumlu olduğun veya ajansına bağlı yayıncıları takip et.','<button class="button primary" id="toggle-form">＋ Yayıncı ekle</button>')}
    <article id="create-box" class="card hidden"><h2>Yayıncı profili</h2><form id="creator-form" class="form-grid"><label class="field">Profil adı<input name="display_name" required></label><label class="field">Telefon<input name="phone" type="tel"></label><label class="field">E-posta<input name="email" type="email"></label><label class="field">Uygulama<select name="platform_id">${platformOptions()}</select></label><label class="field">Başlangıç tarihi<input name="started_on" type="date"></label><label class="field">Durum<select name="status"><option value="active">Aktif</option><option value="paused">Duraklatıldı</option><option value="left">Ayrıldı</option></select></label><label class="field full">Operasyon notu<textarea name="notes" rows="2"></textarea></label><div class="form-actions full"><button class="button primary">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card">${table(['Profil adı','Telefon','Uygulama','Durum','Başlangıç'],records.map(r=>`<tr><td>${esc(r.display_name)}</td><td>${esc(r.phone||'—')}</td><td>${esc(r.platforms?.name||'—')}</td><td><span class="pill ${r.status!=='active'?'review':''}">${esc(statusName(r.status))}</span></td><td>${niceDate(r.started_on)}</td></tr>`),'Henüz yayıncı kaydı yok.')}</article>`;
  wireFormToggle();
  document.querySelector('#creator-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const input={display_name:f.get('display_name').trim(),phone:f.get('phone')||null,email:f.get('email')||null,platform_id:f.get('platform_id')||null,started_on:f.get('started_on')||null,status:f.get('status'),consultant_id:profile.id,agency_id:profile.agency_id,notes:f.get('notes')||null,created_by:profile.id};const {error}=await db.from('creators').insert(input);if(error)return msg(error.message,true);msg('Yayıncı eklendi.');renderCreators();});
}

async function renderFinance() {
  const {data,error}=await db.from('financial_entries').select('*,platforms(name),agencies(name)').order('occurred_on',{ascending:false}).limit(200);
  if(error) return page.innerHTML=titleBlock('Gelir & Gider','Finans kayıtları.')+`<div class="empty">${esc(error.message)}</div>`;
  const rows=data||[];const sums={};rows.forEach(r=>{const c=r.currency||'GBP';sums[c]??={income:0,expense:0};sums[c][r.entry_type]+=Number(r.amount)});
  const summary=Object.entries(sums).map(([c,s])=>`<div class="card"><div class="metric-label">${esc(c)} · Net toplam</div><div class="metric-value">${esc(money(s.income-s.expense,c))}</div><div class="metric-foot">Gelir ${esc(money(s.income,c))} · Gider ${esc(money(s.expense,c))}</div></div>`).join('')||cardMetric('Dönem özeti','—','Kayıt eklendikçe hesaplanır');
  page.innerHTML=`${titleBlock('Gelir & Gider','Erişim alanındaki finans kayıtlarını ve para birimine göre toplamları izle.','<button class="button primary" id="toggle-form">＋ Finans kaydı</button>')}<div class="cards">${summary}</div>
    <article id="create-box" class="card hidden"><h2>Gelir / gider ekle</h2><form id="finance-form" class="form-grid"><label class="field">Tür<select name="entry_type"><option value="income">Gelir</option><option value="expense">Gider</option></select></label><label class="field">Kategori<input name="category" required placeholder="Örn. platform ödemesi, prodüksiyon"></label><label class="field">Tutar<input name="amount" type="text" inputmode="decimal" autocomplete="off" required placeholder="Örn. 1.234,56"></label><label class="field">Para birimi<select name="currency"><option>GBP</option><option>TRY</option><option>EUR</option><option>USD</option></select></label><label class="field">Tarih<input name="occurred_on" type="date" value="${today()}" required></label><label class="field">Uygulama<select name="platform_id">${platformOptions('',true)}</select></label><label class="field full">Açıklama<input name="description"></label><div class="form-actions full"><button class="button primary">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card">${table(['Tarih','Tür','Kategori','Açıklama','Uygulama','Tutar'],rows.map(r=>`<tr><td>${niceDate(r.occurred_on)}</td><td><span class="pill ${r.entry_type==='expense'?'review':''}">${r.entry_type==='income'?'Gelir':'Gider'}</span></td><td>${esc(r.category)}</td><td>${esc(r.description||'—')}</td><td>${esc(r.platforms?.name||'—')}</td><td>${esc(money(r.amount,r.currency))}</td></tr>`),'Henüz finans kaydı yok.')}</article>`;
  wireFormToggle();
  document.querySelector('#finance-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const amount=parseLocalizedAmount(f.get('amount'));if(!Number.isFinite(amount)||amount<0.01)return msg('Tutarı 1.234,56 veya 1234,56 biçiminde gir.',true);const selectedPlatform=f.get('platform_id');const {error}=await db.from('financial_entries').insert({entry_type:f.get('entry_type'),category:f.get('category').trim(),description:f.get('description')||null,amount,currency:f.get('currency'),occurred_on:f.get('occurred_on'),platform_id:selectedPlatform&&selectedPlatform!=='all'?selectedPlatform:null,agency_id:profile.role==='subagency_owner'?profile.agency_id:null,entered_by:profile.id});if(error)return msg(error.message,true);msg('Finans kaydı eklendi.');renderFinance();});
}

async function renderPerformance() {
  await loadProfiles();
  const {data,error}=await db.from('performance_entries').select('*,profiles!performance_entries_user_id_fkey(full_name),platforms(name),agencies(name)').order('period_start',{ascending:false}).limit(200);
  if(error) return page.innerHTML=titleBlock('Performans','Kişi ve ekip performans kayıtları.')+`<div class="empty">${esc(error.message)}<br>Veritabanı ilişkisi farklıysa performans listesi ilk kurulumda güncellenebilir.</div>`;
  const reportRole=profile.role==='admin'?'assistant':profile.role==='consultant'?'consultant':'assistant';
  const rows=(data||[]).filter(r=>profile.role==='admin'||profile.role==='subagency_owner'||(r.report_type||'assistant')===reportRole);
  const week=weekDates();
  const userSelect=(role)=>profile.role==='admin'
    ? `<label class="field">${role==='consultant'?'Danışman':'Kayıt asistanı'}<select name="user_id" required><option value="">Kişi seç</option>${profiles.filter(p=>p.active&&p.role===role).map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></label>`
    : `<label class="field">${profile.role==='consultant'?'Danışman':'Kayıt asistanı'}<select name="user_id" required><option value="${profile.id}" selected>${esc(profile.full_name)}</option></select></label>`;
  const assistantFields=`<div class="form-grid full"><label class="field">Alınan toplam numara<input name="phone_numbers_count" type="number" min="0" step="1" value="0" required></label><label class="field">Toplam alınan kayıt<input name="registrations_count" type="number" min="0" step="1" value="0" required></label></div>`;
  const consultantFields=`<div class="form-grid full"><label class="field">Bu hafta yapılan toplam kota<input name="quota_completed" type="number" min="0" step="1" value="0" required></label><label class="field">Arka plan kotası<input name="background_quota" type="number" min="0" step="1" value="0" required></label><label class="field full">Haftalık sorunlar<textarea name="weekly_issues" rows="3" placeholder="Bu hafta karşılaşılan sorunları yazın"></textarea></label><label class="field full">Çözüm önerileri<textarea name="solution_suggestions" rows="3" placeholder="Önerilen çözümleri yazın"></textarea></label></div>`;
  const initialType=profile.role==='consultant'?'consultant':'assistant';
  const adminType=profile.role==='admin'?`<label class="field">Rapor türü<select name="report_type"><option value="assistant">Kayıt asistanı haftalık raporu</option><option value="consultant">Danışman haftalık raporu</option></select></label>`:'';
  const fieldsFor=(role)=>`${userSelect(role)}<label class="field">Uygulama<select name="platform_id">${platformOptions('',true)}</select></label><label class="field">Hafta başlangıcı<input name="period_start" type="date" value="${week.start}" required></label><label class="field">Hafta bitişi<input name="period_end" type="date" value="${week.end}" required></label><div class="role-fields full" data-role-fields="assistant" ${role==='consultant'?'hidden':''}>${assistantFields}</div><div class="role-fields full" data-role-fields="consultant" ${role!=='consultant'?'hidden':''}>${consultantFields}</div>${profile.role==='admin'?`<div class="form-grid full"><label class="field">Yönetici ciro katkısı (isteğe bağlı)<input name="revenue_contribution" type="number" step="0.01" min="0" value="0"></label><label class="field">Para birimi<select name="currency"><option>GBP</option><option>TRY</option><option>EUR</option><option>USD</option></select></label></div>`:''}<div class="form-actions full"><button class="button primary">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div>`;
  const adminForm=`<form id="performance-form" class="form-grid">${adminType}<div id="performance-fields" class="form-grid full">${fieldsFor(initialType)}</div></form>`;
  const selfForm=`<form id="performance-form" class="form-grid">${fieldsFor(initialType)}</form>`;
  const heading=profile.role==='consultant'?'Danışman haftalık raporu':profile.role==='admin'?'Haftalık ekip performansı':'Kayıt asistanı haftalık performansı';
  const subtitle=profile.role==='consultant'?'Danışmanlar kendi uygulamalarına ait haftalık kota, arka plan kotası, sorun ve çözüm raporunu girer.':'Kayıt asistanları yalnızca haftalık numara ve kayıt toplamlarını girer.';
  const displayRows=rows.map(r=>{
    const kind=r.report_type||'assistant';
    const detail=kind==='consultant'?`<td>${Number(r.quota_completed||0)}</td><td>${Number(r.background_quota||0)}</td><td>${esc(r.weekly_issues||'—')}</td><td>${esc(r.solution_suggestions||'—')}</td>`:`<td>${Number(r.phone_numbers_count||0)}</td><td>${Number(r.registrations_count||0)}</td>`;
    return `<tr><td>${esc(r.profiles?.full_name||'—')}</td>${profile.role==='admin'?`<td>${kind==='consultant'?'Danışman':'Kayıt asistanı'}</td>`:''}<td>${esc(r.agencies?.name||'Merkez')}</td><td>${esc(r.platforms?.name||'Hepsi / Genel kayıt')}</td><td>${niceDate(r.period_start)} – ${niceDate(r.period_end)}</td>${detail}${profile.role==='admin'?`<td>${esc(money(r.revenue_contribution,r.currency))}</td>`:''}</tr>`;
  });
  const columns=profile.role==='admin'?['Ad soyad','Rapor türü','Alt ajans','Uygulama','Hafta','Toplam kota','Arka plan kotası','Haftalık sorunlar','Çözüm önerileri','Ciro katkısı']
    :reportRole==='consultant'?['Danışman','Alt ajans','Uygulama','Hafta','Toplam kota','Arka plan kotası','Haftalık sorunlar','Çözüm önerileri']
    :['Kayıt asistanı','Alt ajans','Uygulama','Hafta','Alınan toplam numara','Toplam alınan kayıt'];
  page.innerHTML=`${titleBlock('Performans',subtitle,'<button class="button primary" id="toggle-form">＋ Haftalık rapor gir</button>')}
    <article id="create-box" class="card hidden"><h2>${heading}</h2>${profile.role==='admin'?adminForm:selfForm}</article>
    <article class="card">${table(columns,displayRows,'Henüz haftalık performans kaydı yok.')}</article>`;
  wireFormToggle();
  const form=document.querySelector('#performance-form');
  if(profile.role==='admin') {
    const typeSelect=form.elements.report_type;
    const renderAdminFields=()=>{const role=typeSelect.value;document.querySelector('#performance-fields').innerHTML=fieldsFor(role);};
    typeSelect.addEventListener('change',renderAdminFields);
  }
  form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form);const kind=profile.role==='admin'?f.get('report_type'):initialType;const selectedUser=profile.role==='admin'?profiles.find(p=>p.id===f.get('user_id')):profile;if(!selectedUser)return msg('Önce kişiyi seç.',true);if(f.get('period_end')<f.get('period_start'))return msg('Hafta bitişi başlangıç tarihinden önce olamaz.',true);
    const input={user_id:selectedUser.id,agency_id:selectedUser.agency_id||null,platform_id:f.get('platform_id')&&f.get('platform_id')!=='all'?f.get('platform_id'):null,period_start:f.get('period_start'),period_end:f.get('period_end'),report_type:kind,phone_numbers_count:kind==='assistant'?Number(f.get('phone_numbers_count')||0):0,applications_count:0,registrations_count:kind==='assistant'?Number(f.get('registrations_count')||0):0,active_creators_count:0,quota_completed:kind==='consultant'?Number(f.get('quota_completed')||0):0,background_quota:kind==='consultant'?Number(f.get('background_quota')||0):0,weekly_issues:kind==='consultant'?(f.get('weekly_issues')||null):null,solution_suggestions:kind==='consultant'?(f.get('solution_suggestions')||null):null,revenue_contribution:profile.role==='admin'?Number(f.get('revenue_contribution')||0):0,currency:profile.role==='admin'?f.get('currency'):'GBP',note:null,entered_by:profile.id};
    const {error}=await db.from('performance_entries').insert(input);if(error)return msg(error.message,true);msg('Haftalık rapor kaydedildi.');renderPerformance();});
}

async function renderUsers() {
  await loadProfiles();
  const rows=profiles.map(p=>`<tr><td>${esc(p.full_name)}</td><td>${esc(p.username)}</td><td>${esc(p.email)}</td><td>${esc(p.phone||'—')}</td><td>${esc(roleName(p.role))}</td><td><span class="pill ${p.active?'':'review'}">${p.active?'Aktif':'Kapalı'}</span></td><td>${p.id!==profile.id?`${p.active?`<button class="button" data-disable="${p.id}">Kapat</button>`:`<button class="button" data-activate="${p.id}">Aç</button>`} <button class="button" data-reset="${p.id}">Parola yenile</button>`:'—'}</td></tr>`);
  page.innerHTML=`${titleBlock('Kullanıcı Yönetimi','Çalışan ve alt ajans hesaplarını yalnızca sen yönetebilirsin.','<button class="button primary" id="toggle-form">＋ Kullanıcı oluştur</button>')}
    <article id="create-box" class="card hidden"><h2>Yeni hesap</h2><p>Geçici parolayı güvenli biçimde çalışana ilet. İlk girişte parola değişimi zorunlu olur.</p><form id="user-form" class="form-grid"><label class="field">Ad soyad<input name="full_name" required></label><label class="field">Telefon<input name="phone" type="tel"></label><label class="field">E-posta<input name="email" type="email" required></label><label class="field">Kullanıcı adı<input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+"></label><label class="field">Rol<select name="role"><option value="assistant">Asistan / Kayıtçı</option><option value="consultant">Danışman</option><option value="subagency_owner">Alt ajans sahibi</option></select></label><label id="agency-field" class="field hidden">Ajans adı<input name="agency_name"></label><label class="field full">İlk giriş parolası<input name="password" type="password" minlength="12" autocomplete="new-password" required><small class="small">En az 12 karakter. İlk girişte değiştirilmesi istenir.</small></label><div class="form-actions full"><button class="button primary">Hesap oluştur</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card">${table(['Ad soyad','Kullanıcı adı','E-posta','Telefon','Rol','Hesap','İşlem'],rows,'Henüz personel hesabı yok.')}</article>`;
  wireFormToggle();
  const roleSelect=document.querySelector('#user-form [name="role"]');
  roleSelect.addEventListener('change',()=>document.querySelector('#agency-field').classList.toggle('hidden',roleSelect.value!=='subagency_owner'));
  document.querySelector('#user-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={action:'create',full_name:f.get('full_name'),phone:f.get('phone'),email:f.get('email'),username:f.get('username'),password:f.get('password'),role:f.get('role'),agency_name:f.get('agency_name')};const result=await invoke('manage-users',payload);if(!result.ok)return msg(result.error||'Hesap açılamadı.',true);msg(`Hesap oluşturuldu. Kullanıcı adı: ${result.username}`);await renderUsers();});
  page.querySelectorAll('[data-disable]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu kişinin panel erişimini kapatmak istiyor musun?'))return;const result=await invoke('manage-users',{action:'deactivate',user_id:button.dataset.disable});if(!result.ok)return msg(result.error||'Erişim kapatılamadı.',true);msg('Hesap erişimi kapatıldı.');renderUsers();}));
  page.querySelectorAll('[data-activate]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu kişinin panel erişimini yeniden açmak istiyor musun?'))return;const result=await invoke('manage-users',{action:'activate',user_id:button.dataset.activate});if(!result.ok)return msg(result.error||'Hesap açılamadı.',true);msg('Hesap yeniden açıldı.');renderUsers();}));
  page.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',async()=>{const password=prompt('En az 12 karakterlik yeni geçici parolayı gir:');if(!password)return;if(password.length<12)return msg('Parola en az 12 karakter olmalı.',true);const result=await invoke('manage-users',{action:'reset_password',user_id:button.dataset.reset,password});if(!result.ok)return msg(result.error||'Parola değiştirilemedi.',true);msg('Parola yenilendi. Yeni geçici parolayı personele güvenli yoldan ilet.');}));
}

async function renderPlatform(platform) {
  const [{data:creators},{data:perf}] = await Promise.all([
    db.from('creators').select('id,status').eq('platform_id',platform.id),
    db.from('performance_entries').select('revenue_contribution,currency').eq('platform_id',platform.id),
  ]);
  const revenue={};(perf||[]).forEach(p=>revenue[p.currency]=(revenue[p.currency]||0)+Number(p.revenue_contribution));
  const revenueLabel=Object.keys(revenue).length?Object.entries(revenue).map(([c,v])=>`${c}: ${money(v,c)}`).join(' · '):'Henüz ciro katkısı yok';
  page.innerHTML=`${titleBlock(platform.name,'Bu uygulamadaki yayıncı ve performans özeti.')}<div class="cards">${cardMetric('Uygulama durumu',statusName(platform.status),'Yönetici tarafından yönetilir')}${cardMetric('Yayıncı',(creators||[]).length,'Erişim alanındaki profiller')}${cardMetric('Ciro katkısı',revenueLabel,'Performans kayıtlarından')}</div><article class="card"><h2>Uygulama kayıtları</h2><p>Yayıncı ve performans bilgilerini ilgili menülerden bu uygulamaya göre takip edebilirsin.</p></article>`;
}

function wireFormToggle() {
  const toggle=document.querySelector('#toggle-form');if(!toggle)return;
  toggle.addEventListener('click',()=>document.querySelector('#create-box').classList.toggle('hidden'));
  document.querySelector('#cancel-form')?.addEventListener('click',()=>document.querySelector('#create-box').classList.add('hidden'));
}
async function invoke(functionName, payload) {
  const {data:{session:current}}=await db.auth.getSession();
  try {const response=await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${current.access_token}`},body:JSON.stringify(payload)});return await response.json();}
  catch {return {ok:false,error:'Sunucuya ulaşılamadı.'};}
}
function renderPasswordChange() {
  page.innerHTML=`${titleBlock('İlk giriş · Parolanı yenile','Güvenliğin için geçici parolanı yeni bir parolayla değiştir.')}
    <article class="card" style="max-width:520px"><form id="change-password" class="form-grid"><label class="field full">Yeni parola<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><label class="field full">Yeni parolayı tekrar gir<input name="confirm" type="password" minlength="12" autocomplete="new-password" required></label><div class="form-actions full"><button class="button primary">Parolayı kaydet</button></div></form></article>`;
  document.querySelector('#change-password').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('password')!==f.get('confirm'))return msg('Parolalar eşleşmiyor.',true);const {error}=await db.auth.updateUser({password:f.get('password')});if(error)return msg(error.message,true);const {data:{session:current}}=await db.auth.getSession();const result=await invoke('complete-password-change',{});if(!result.ok)return msg(result.error||'Parola durumu güncellenemedi.',true);profile.must_change_password=false;msg('Parolan güncellendi.');await openPage('overview');});
}
document.querySelector('#logout').addEventListener('click',async()=>{await db.auth.signOut();profile=null;showLogin();});
document.querySelector('#menu-toggle').addEventListener('click',()=>document.querySelector('#sidebar').classList.toggle('open'));
document.querySelector('#theme-toggle').addEventListener('click',event=>{
  const light=document.querySelector('#login').classList.toggle('light');
  event.currentTarget.querySelector('span').textContent=light?'Koyu':'Açık';
  event.currentTarget.setAttribute('aria-label',light?'Koyu temaya geç':'Açık temaya geç');
});
