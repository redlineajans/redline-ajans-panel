import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const ready = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('_HERE') &&
  SUPABASE_PUBLISHABLE_KEY.length > 20 && !SUPABASE_PUBLISHABLE_KEY.includes('_HERE');
const setup = document.querySelector('#setup');
const login = document.querySelector('#login');
const app = document.querySelector('#app');
const page = document.querySelector('#page');
const notice = document.querySelector('#notice');
let db, session, profile, platforms = [], profiles = [], assignedPlatformIds = new Set(), currentPage = 'overview';

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
function dateInputValue(date) {
  const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}
function shiftedLocalDate(days) { const date=new Date();date.setDate(date.getDate()+days);return dateInputValue(date); }
function isMondayToSunday(start,end) {
  if(!start||!end)return false;
  const [sy,sm,sd]=start.split('-').map(Number),[ey,em,ed]=end.split('-').map(Number);
  const startUtc=Date.UTC(sy,sm-1,sd),endUtc=Date.UTC(ey,em-1,ed);
  return new Date(startUtc).getUTCDay()===1&&new Date(endUtc).getUTCDay()===0&&endUtc-startUtc===6*86400000;
}
function today() { return dateInputValue(new Date()); }
function weekDates() {
  const d = new Date(); d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d); monday.setDate(d.getDate() - day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start:dateInputValue(monday), end:dateInputValue(sunday) };
}
function roleName(role) { return ({admin:'Yönetici',assistant:'Asistan / Kayıtçı',consultant:'Danışman',subagency_owner:'Alt ajans sahibi',host:'Sunucu',room_assistant:'Oda Asistanı'})[role] || role; }
function visibleName(person) { return person?.display_name?.trim() || person?.full_name || '—'; }
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
  document.querySelector('#user-name').textContent = visibleName(profile);
  document.querySelector('#user-role').textContent = roleName(profile.role);
  document.querySelector('#user-avatar').textContent = visibleName(profile).split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  await loadPlatforms();
  assignedPlatformIds=new Set();
  if(['consultant','room_assistant'].includes(profile.role)) {
    const {data:assigned}=await db.from('consultant_platforms').select('platform_id').eq('user_id',profile.id);
    assignedPlatformIds=new Set((assigned||[]).map(item=>item.platform_id));
  }
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
  const { data } = await db.from('profiles').select('id,full_name,display_name,username,role,agency_id,active,email,phone').order('full_name');
  profiles = data || [];
  return profiles;
}

function buildNav() {
  const entries = [{heading:'ÇALIŞMA ALANI'},{id:'overview',icon:'▦',name:'Genel Bakış'}];
  if (['admin','consultant','subagency_owner','room_assistant'].includes(profile.role)) entries.push({id:'reports',icon:'▤',name:'Raporlar'});
  if (profile.role==='admin') entries.push({id:'payments',icon:'＄',name:'Çalışan Ödeme Tablosu'});
  else if (['assistant','consultant','host','room_assistant'].includes(profile.role)) entries.push({id:'my-payments',icon:'✓',name:'Ödeme Durumum'});
  if (['admin','subagency_owner'].includes(profile.role)) entries.push({id:'finance',icon:'₺',name:'Gelir & Gider'});
  if(!['host','room_assistant'].includes(profile.role))entries.push({id:'performance',icon:'↗',name:'Performans'});
  if(['admin','consultant','host'].includes(profile.role))entries.push({id:'host-performance',icon:'✓',name:'Sunucu Performansı'});
  if(['admin','consultant','room_assistant'].includes(profile.role))entries.push({id:'room-operations',icon:'◎',name:'Oda Operasyonları'});
  if (['admin','assistant','consultant'].includes(profile.role)) entries.push({id:'referrals',icon:'↗',name:'Referans Kayıtları'});
  if (['admin','consultant','host'].includes(profile.role)) entries.push({id:'pk',icon:'★',name:'PK Takip'});
  if (profile.role === 'admin') entries.push({id:'users',icon:'♧',name:'Kullanıcı Yönetimi'});
  if(!['host','room_assistant'].includes(profile.role)){
    entries.push({heading:'UYGULAMALAR'});
    platforms.filter(p=>profile.role!=='consultant'||assignedPlatformIds.has(p.id)).forEach(p=>entries.push({id:`platform:${p.id}`,icon:p.name.slice(0,1).toUpperCase(),name:p.name,status:p.status}));
  }
  const nav=document.querySelector('#nav');
  nav.innerHTML=entries.map(item=>item.heading?`<div class="nav-heading">${esc(item.heading)}</div>`:`<button data-page="${esc(item.id)}" class="${item.id===currentPage?'active':''}"><span class="nav-symbol">${esc(item.icon)}</span>${esc(item.name)}${item.status?`<span class="nav-status">${item.status==='active'?'Aktif':item.status==='review'?'Kontrol':'Pasif'}</span>`:''}</button>`).join('');
  nav.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{closeMenu();openPage(button.dataset.page);}));
}

async function openPage(id) {
  if(profile.role==='host'&&!['overview','my-payments','pk','host-performance'].includes(id))return openPage('overview');
  if(profile.role==='consultant'&&!['overview','reports','my-payments','performance','referrals','pk','host-performance','room-operations'].includes(id))return openPage('overview');
  if(profile.role==='room_assistant'&&!['overview','reports','room-operations','my-payments'].includes(id))return openPage('overview');
  if(profile.role==='consultant'&&id.startsWith('platform:')&&!assignedPlatformIds.has(id.slice('platform:'.length)))return openPage('overview');
  currentPage=id;
  const platform = id.startsWith('platform:') ? platforms.find(p=>p.id===id.split(':')[1]) : null;
  const title = platform?.name || ({overview:'Genel Bakış',reports:'Raporlar',payments:'Çalışan Ödeme Tablosu','my-payments':'Ödeme Durumum',finance:'Gelir & Gider',performance:'Performans','host-performance':'Sunucu Performansı','room-operations':'Oda Operasyonları',referrals:'Referans Kayıtları',pk:'PK Takip',users:'Kullanıcı Yönetimi'}[id] || 'Panel');
  document.querySelector('#breadcrumb').textContent=title;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  msg('');
  if (profile.must_change_password) return renderPasswordChange();
  if (id==='overview') return renderOverview();
  if (id==='reports') return renderReports();
  if (id==='payments') return renderEmployeePayments();
  if (id==='my-payments') return renderMyPaymentStatus();
  if (id==='finance') return renderFinance();
  if (id==='performance') return renderPerformance();
  if (id==='host-performance') return renderHostPerformance();
  if (id==='room-operations') return renderRoomOperations();
  if (id==='referrals') return renderReferrals();
  if (id==='pk') return renderPkEvents();
  if (id==='users') return renderUsers();
  if (platform) return renderPlatform(platform);
}

function titleBlock(title, subtitle, action='') { return `<div class="page-title"><div><div class="eyebrow-small">Red Line Ajans · Özel panel</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`; }
function cardMetric(label,value,foot='') { return `<article class="card"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`; }
function table(headers, rows, empty='Henüz kayıt yok.') { return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}"><div class="empty">${esc(empty)}</div></td></tr>`}</tbody></table></div>`; }
function platformOptions(selected='',includeAll=false) { return `<option value="">Platform seç</option>${includeAll?'<option value="all">Hepsi / Genel kayıt</option>':''}${platforms.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}`; }
function roleUsersOptions(selected='') { return `<option value="">Kendime ata</option>${profiles.filter(p=>p.active).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(visibleName(p))} · ${esc(roleName(p.role))}</option>`).join('')}`; }
async function renderOverview() {
  if(profile.role==='room_assistant') {
    page.innerHTML=`${titleBlock('Genel Bakış','Sana atanmış uygulamaların raporlarını ve günlük yayıncı takiplerini buradan yönet.')}<div class="columns"><article class="card"><h2>Raporlar</h2><p>Yöneticinin yüklediği günlük ve haftalık uygulama raporlarını görüntüle.</p><button class="button" data-open="reports">Raporları aç</button></article><article class="card"><h2>Oda Operasyonları</h2><p>Yayıncılarla yaptığın günlük takibi kaydet; çözemediğin konuyu danışmana ilet.</p><button class="button primary" data-open="room-operations">Takip ekranını aç</button></article></div>`;
    page.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>openPage(button.dataset.open)));
    return;
  }
  if(profile.role==='host') {
    page.innerHTML=`${titleBlock('Genel Bakış','Buradan PK programlarını, tamamlanan sunumlarını ve ödeme durumunu takip edebilirsin.')}<div class="columns"><article class="card"><h2>PK Takip</h2><p>Sana atanmış PK programlarını, afişleri ve sunum durumunu görüntüle.</p><button class="button primary" data-open="pk">PK Takip’i aç</button></article><article class="card"><h2>Sunucu Performansı</h2><p>Sunumunu yaptığın PK kayıtlarını görüntüle.</p><button class="button" data-open="host-performance">Sunucu performansını aç</button></article><article class="card"><h2>Ödeme Durumum</h2><p>Ödemelerinin ödendi / ödenmedi durumunu görüntüle.</p><button class="button" data-open="my-payments">Ödeme durumunu aç</button></article></div>`;
    page.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>openPage(button.dataset.open)));
    return;
  }
  const count = async tableName => { const {count}=await db.from(tableName).select('id',{count:'exact',head:true}); return count||0; };
  const [reportCount,financeResult,performanceResult] = await Promise.all([
    count(profile.role==='assistant'?'performance_entries':'platform_reports'), db.from('financial_entries').select('entry_type,amount,currency'), db.from('performance_entries').select('revenue_contribution,currency')
  ]);
  const totals={}; (financeResult.data||[]).forEach(row=>{const c=row.currency||'GBP';totals[c]??={income:0,expense:0};totals[c][row.entry_type]+=Number(row.amount||0)});
  const rev={}; (performanceResult.data||[]).forEach(r=>{const c=r.currency||'GBP';rev[c]=(rev[c]||0)+Number(r.revenue_contribution||0)});
  const financialText=Object.keys(totals).length?Object.entries(totals).map(([c,v])=>`${c}: net ${money(v.income-v.expense,c)}`).join(' · '):'Henüz gelir/gider kaydı yok';
  const revenueText=Object.keys(rev).length?Object.entries(rev).map(([c,v])=>`${c}: ${money(v,c)}`).join(' · '):'Henüz ciro katkısı girilmedi';
  page.innerHTML=`${titleBlock('Genel Bakış','Yetki alanındaki dosya raporları, performans ve finans özetleri.')}
    <div class="cards">${cardMetric(profile.role==='assistant'?'Performans raporların':'Erişebildiğin raporlar',reportCount,profile.role==='assistant'?'Kendi haftalık kayıtların':'Uygulama ve ajans kapsamına göre')}${cardMetric('Ciro katkısı',revenueText,'Yetkili performans raporlarından')}${cardMetric('Gelir − gider',financialText,'Yetkine açık kayıtlar')}</div>
    <div class="columns"><article class="card"><h2>Hızlı bağlantılar</h2><p>İşlem yapmak istediğin bölümü aç.</p><div class="form-actions">${['admin','consultant','subagency_owner'].includes(profile.role)?'<button class="button" data-open="reports">Raporlar</button>':''}<button class="button" data-open="performance">Performans</button></div></article><article class="card"><h2>Güvenli erişim</h2><p>Bu oturumda yalnızca rolüne ve bağlı olduğun ekibe izin verilen kayıtlar gösterilir.</p><span class="pill">${esc(roleName(profile.role))}</span></article></div>`;
  page.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openPage(b.dataset.open)));
}

async function renderCreators() {
  const {data,error}=await db.from('creators').select('*,platforms(name)').order('created_at',{ascending:false}).limit(100);
  if(error) return page.innerHTML=titleBlock('Yayıncılar','Erişim alanındaki yayıncı profilleri.')+`<div class="empty">${esc(error.message)}</div>`;
  const records=data||[];
  page.innerHTML=`${titleBlock('Yayıncılar','Sorumlu olduğun veya ajansına bağlı yayıncıları takip et.','<button class="button primary" id="toggle-form">＋ Yayıncı ekle</button>')}
    <article id="create-box" class="card hidden"><h2 id="creator-form-title">Yayıncı profili</h2><form id="creator-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Profil adı<input name="display_name" required></label><label class="field">Telefon<input name="phone" type="tel"></label><label class="field">E-posta<input name="email" type="email"></label><label class="field">Uygulama<select name="platform_id">${platformOptions()}</select></label><label class="field">Başlangıç tarihi<input name="started_on" type="date"></label><label class="field">Durum<select name="status"><option value="active">Aktif</option><option value="paused">Duraklatıldı</option><option value="left">Ayrıldı</option></select></label><label class="field full">Operasyon notu<textarea name="notes" rows="2"></textarea></label><div class="form-actions full"><button class="button primary" id="creator-save">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card">${table(['Profil adı','Telefon','Uygulama','Durum','Başlangıç','İşlem'],records.map(r=>{const canEdit=profile.role==='admin'||(profile.role==='consultant'&&r.consultant_id===profile.id)||(profile.role==='subagency_owner'&&r.agency_id===profile.agency_id);return `<tr><td>${esc(r.display_name)}</td><td>${esc(r.phone||'—')}</td><td>${esc(r.platforms?.name||'—')}</td><td><span class="pill ${r.status!=='active'?'review':''}">${esc(statusName(r.status))}</span></td><td>${niceDate(r.started_on)}</td><td>${canEdit?`<button class="button" data-edit-creator="${r.id}">Düzenle</button>`:''}${profile.role==='admin'?` <button class="button" data-delete-creator="${r.id}">Sil</button>`:canEdit?'':'—'}</td></tr>`;}),'Henüz yayıncı kaydı yok.')}</article>`;
  wireFormToggle();
  const form=document.querySelector('#creator-form');
  document.querySelector('#cancel-form').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';document.querySelector('#creator-form-title').textContent='Yayıncı profili';document.querySelector('#creator-save').textContent='Kaydet';});
  form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form);const input={display_name:f.get('display_name').trim(),phone:f.get('phone')||null,email:f.get('email')||null,platform_id:f.get('platform_id')||null,started_on:f.get('started_on')||null,status:f.get('status'),consultant_id:profile.role==='admin'?records.find(r=>r.id===f.get('record_id'))?.consultant_id||profile.id:profile.id,agency_id:profile.role==='admin'?records.find(r=>r.id===f.get('record_id'))?.agency_id||profile.agency_id:profile.agency_id,notes:f.get('notes')||null,created_by:profile.id};const recordId=f.get('record_id');const query=recordId?db.from('creators').update(input).eq('id',recordId):db.from('creators').insert(input);const {error}=await query;if(error)return msg(error.message,true);msg(recordId?'Yayıncı kaydı güncellendi.':'Yayıncı eklendi.');renderCreators();});
  page.querySelectorAll('[data-edit-creator]').forEach(button=>button.addEventListener('click',()=>{const r=records.find(x=>x.id===button.dataset.editCreator);if(!r)return;form.elements.record_id.value=r.id;form.elements.display_name.value=r.display_name||'';form.elements.phone.value=r.phone||'';form.elements.email.value=r.email||'';form.elements.platform_id.value=r.platform_id||'';form.elements.started_on.value=r.started_on||'';form.elements.status.value=r.status||'active';form.elements.notes.value=r.notes||'';document.querySelector('#creator-form-title').textContent='Yayıncı kaydını düzenle';document.querySelector('#creator-save').textContent='Değişiklikleri kaydet';document.querySelector('#create-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  page.querySelectorAll('[data-delete-creator]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu yayıncı kaydını silmek istiyor musun?'))return;const {error}=await db.from('creators').delete().eq('id',button.dataset.deleteCreator);if(error)return msg(error.message,true);msg('Yayıncı kaydı silindi.');renderCreators();}));
}

async function renderReports() {
  if (!['admin','consultant','subagency_owner','room_assistant'].includes(profile.role)) {
    page.innerHTML=titleBlock('Raporlar','Bu bölüm bu kullanıcı rolüne açık değil.')+`<div class="empty">Kendi haftalık raporlarını Performans bölümünde görebilirsin.</div>`;
    return;
  }
  let agencies=[];
  if(profile.role==='admin') {
    const {data,error}=await db.from('agencies').select('id,name').order('name');
    if(error)return page.innerHTML=titleBlock('Raporlar','Uygulama raporları.')+`<div class="empty">${esc(error.message)}</div>`;
    agencies=data||[];
  }
  const {data,error}=await db.from('platform_reports').select('*,platforms(name),agencies(name)').order('period_start',{ascending:false}).order('created_at',{ascending:false}).limit(500);
  if(error)return page.innerHTML=titleBlock('Raporlar','Uygulamaya ve döneme göre filtrelenmiş dosya raporları.')+`<div class="empty">${esc(error.message)}<br>Rapor arşivi için Supabase güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  const rows=data||[];
  let visiblePlatforms=platforms;
  if(profile.role==='room_assistant') {
    const {data:assignmentRows,error:assignmentError}=await db.from('consultant_platforms').select('platform_id').eq('user_id',profile.id);
    if(assignmentError)return page.innerHTML=titleBlock('Raporlar','Yalnızca atanmış uygulamaların raporları.')+`<div class="empty">${esc(assignmentError.message)}</div>`;
    const assignedIds=new Set((assignmentRows||[]).map(row=>row.platform_id));
    visiblePlatforms=platforms.filter(item=>assignedIds.has(item.id));
  }
  const fileTypes='Excel (.xlsx, .xls, .csv), PDF veya görsel (.jpg, .png, .webp, .gif)';
  page.innerHTML=`${titleBlock('Raporlar','Dosyaları uygulama, rapor türü, dönem ve ajansa göre görüntüle.',profile.role==='admin'?'<button class="button primary" id="toggle-report-form">＋ Rapor yükle</button>':'')}
    ${profile.role==='admin'?`<article id="report-form-box" class="card hidden"><h2>Rapor dosyası yükle</h2><p>${fileTypes} · Dosya başına en fazla 20 MB. Raporlar yalnızca yetkili hesaplara gösterilir.</p><form id="report-form" class="form-grid"><label class="field">Başlık<input name="title" maxlength="120" placeholder="Boş bırakılırsa dosya adı kullanılır"></label><label class="field">Uygulama<select name="platform_id" required>${platformOptions()}</select></label><label class="field">Rapor türü<select name="report_type"><option value="daily">Günlük</option><option value="weekly">Haftalık</option></select></label><label class="field">Alt ajans<select name="agency_id"><option value="">Merkez / ajansa özel değil</option>${agencies.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label><label class="field">Dönem başlangıcı<input name="period_start" type="date" value="${today()}" required></label><label class="field">Dönem bitişi<input name="period_end" type="date" value="${today()}" required></label><label class="field full">Rapor dosyası<input name="file" type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/jpeg,image/png,image/webp,image/gif,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><label class="field full">Açıklama (isteğe bağlı)<textarea name="notes" rows="2" maxlength="1000" placeholder="Raporla ilgili kısa not"></textarea></label><div class="form-actions full"><button class="button primary" type="submit" id="report-submit">Yükle</button><button class="button" type="button" id="cancel-report">Vazgeç</button></div></form></article>`:''}
    <div class="section-head"><strong>Rapor arşivi</strong><div class="form-grid report-filters"><label class="field">Uygulama<select id="report-filter-platform"><option value="all">Tüm uygulamalar</option>${visiblePlatforms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Tür<select id="report-filter-type"><option value="all">Günlük ve haftalık</option><option value="daily">Günlük</option><option value="weekly">Haftalık</option></select></label></div></div>
    <article class="card" id="report-table-card"></article>`;

  const drawRows=()=>{
    const selectedPlatform=document.querySelector('#report-filter-platform')?.value||'all';
    const selectedType=document.querySelector('#report-filter-type')?.value||'all';
    const visible=rows.filter(r=>(selectedPlatform==='all'||r.platform_id===selectedPlatform)&&(selectedType==='all'||r.report_type===selectedType));
    document.querySelector('#report-table-card').innerHTML=table(['Başlık','Uygulama','Tür','Dönem','Ajans','Dosya','Yüklenme',...(profile.role==='admin'?['İşlem']:[])],visible.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(r.platforms?.name||'—')}</td><td>${r.report_type==='daily'?'Günlük':'Haftalık'}</td><td>${niceDate(r.period_start)}${r.period_end!==r.period_start?` – ${niceDate(r.period_end)}`:''}</td><td>${esc(r.agencies?.name||'Merkez')}</td><td><button class="button" data-open-report="${r.id}">${esc(r.original_filename)}</button></td><td>${new Date(r.created_at).toLocaleDateString('tr-TR')}</td>${profile.role==='admin'?`<td><button class="button" data-delete-report="${r.id}">Sil</button></td>`:''}</tr>`),'Bu filtrelerde rapor bulunamadı.');
    document.querySelectorAll('[data-open-report]').forEach(button=>button.addEventListener('click',async()=>{const report=rows.find(r=>r.id===button.dataset.openReport);if(!report)return;const tab=window.open('about:blank','_blank');const {data,error}=await db.storage.from('platform-reports').createSignedUrl(report.storage_path,120);if(error||!data?.signedUrl){tab?.close();return msg(error?.message||'Rapor bağlantısı oluşturulamadı.',true);}if(tab)tab.location.href=data.signedUrl;else window.location.assign(data.signedUrl);}));
    document.querySelectorAll('[data-delete-report]').forEach(button=>button.addEventListener('click',async()=>{const report=rows.find(r=>r.id===button.dataset.deleteReport);if(!report||!confirm('Bu raporu ve yüklenen dosyasını silmek istiyor musun?'))return;const {error:removeError}=await db.storage.from('platform-reports').remove([report.storage_path]);if(removeError)return msg(removeError.message,true);const {error:deleteError}=await db.from('platform_reports').delete().eq('id',report.id);if(deleteError)return msg(deleteError.message,true);msg('Rapor silindi.');renderReports();}));
  };
  document.querySelector('#report-filter-platform').addEventListener('change',drawRows);
  document.querySelector('#report-filter-type').addEventListener('change',drawRows);
  drawRows();
  if(profile.role!=='admin')return;
  const box=document.querySelector('#report-form-box');
  document.querySelector('#toggle-report-form').addEventListener('click',()=>box.classList.toggle('hidden'));
  document.querySelector('#cancel-report').addEventListener('click',()=>{document.querySelector('#report-form').reset();box.classList.add('hidden');});
  const allowedMime={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
  document.querySelector('#report-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;const f=new FormData(form);const file=f.get('file');
    if(!(file instanceof File)||!file.name)return msg('Yüklenecek dosyayı seç.',true);
    if(file.size>20*1024*1024)return msg('Dosya 20 MB sınırını aşıyor.',true);
    const ext=file.name.split('.').pop().toLowerCase();const contentType=allowedMime[ext];
    if(!contentType)return msg('Bu dosya türü desteklenmiyor. Excel, PDF veya görsel dosyası seç.',true);
    const periodStart=f.get('period_start'),periodEnd=f.get('period_end');
    if(periodEnd<periodStart)return msg('Dönem bitişi başlangıç tarihinden önce olamaz.',true);
    if(f.get('report_type')==='daily'&&periodStart!==periodEnd)return msg('Günlük raporda başlangıç ve bitiş tarihi aynı olmalı.',true);
    if(f.get('report_type')==='weekly'&&!isMondayToSunday(periodStart,periodEnd))return msg('Haftalık rapor pazartesi başlamalı ve pazar bitmeli.',true);
    const safeName=file.name.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-120)||`rapor.${ext}`;
    const id=crypto.randomUUID();const storagePath=`${id}/${safeName}`;const saveButton=document.querySelector('#report-submit');saveButton.disabled=true;saveButton.textContent='Yükleniyor…';
    const metadata={id,title:String(f.get('title')||'').trim()||file.name,platform_id:f.get('platform_id'),report_type:f.get('report_type'),period_start:periodStart,period_end:periodEnd,agency_id:f.get('agency_id')||null,original_filename:file.name,storage_path:storagePath,content_type:contentType,file_size:file.size,uploaded_by:profile.id};
    const {error:insertError}=await db.from('platform_reports').insert(metadata);
    if(insertError){saveButton.disabled=false;saveButton.textContent='Yükle';return msg(insertError.message,true);}
    const {error:uploadError}=await db.storage.from('platform-reports').upload(storagePath,file,{contentType,upsert:false});
    if(uploadError){await db.from('platform_reports').delete().eq('id',id);saveButton.disabled=false;saveButton.textContent='Yükle';return msg(uploadError.message,true);}
    msg('Rapor dosyası yüklendi.');await renderReports();
  });
}

async function renderRoomOperations() {
  if(!['admin','consultant','room_assistant'].includes(profile.role)) {
    page.innerHTML=titleBlock('Oda Operasyonları','Bu bölüm için yetkin yok.')+'<div class="empty">Bu ekran yönetici, danışman ve oda asistanına açıktır.</div>';
    return;
  }
  let assignedIds=null;
  if(profile.role!=='admin') {
    const {data:assignments,error:assignmentError}=await db.from('consultant_platforms').select('platform_id').eq('user_id',profile.id);
    if(assignmentError)return page.innerHTML=titleBlock('Oda Operasyonları','Uygulama erişimleri yüklenemedi.')+`<div class="empty">${esc(assignmentError.message)}</div>`;
    assignedIds=new Set((assignments||[]).map(x=>x.platform_id));
  }
  const allowedPlatforms=profile.role==='admin'?platforms:platforms.filter(p=>assignedIds.has(p.id));
  const [{data:reports,error:reportError},{data:records,error}] = await Promise.all([
    db.from('platform_reports').select('id,title,platform_id,report_type,period_start,period_end,storage_path,original_filename').order('period_start',{ascending:false}).limit(500),
    db.from('room_assistant_followups').select('*,platforms(name)').order('follow_up_date',{ascending:false}).order('created_at',{ascending:false}).limit(500)
  ]);
  if(error)return page.innerHTML=titleBlock('Oda Operasyonları','Günlük yayıncı takibi ve yönlendirmeler.')+`<div class="empty">${esc(error.message)}<br>Oda Asistanı SQL güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  if(reportError)return page.innerHTML=titleBlock('Oda Operasyonları','Yüklenen raporlar alınamadı.')+`<div class="empty">${esc(reportError.message)}</div>`;
  const rows=records||[];const allowedIds=new Set(allowedPlatforms.map(p=>p.id));
  const visibleReports=(reports||[]).filter(r=>allowedIds.has(r.platform_id));
  const reportOptions=(platformId,selected='')=>`<option value="">Yok — rapora bağlama</option>${visibleReports.filter(r=>r.platform_id===platformId).map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${esc(r.title||r.original_filename)} · ${r.report_type==='daily'?'Günlük':'Haftalık'} · ${niceDate(r.period_start)}</option>`).join('')}`;
  const statusOptions=(name,items,value)=>`<select name="${name}">${items.map(([v,label])=>`<option value="${v}" ${v===value?'selected':''}>${label}</option>`).join('')}</select>`;
  const defaultPlatform=allowedPlatforms[0]?.id||'';
  const renderRows=()=>{
    const selectedPlatform=document.querySelector('#room-filter-platform')?.value||'all';
    const selectedDate=document.querySelector('#room-filter-date')?.value||'';
    const visible=rows.filter(r=>(selectedPlatform==='all'||r.platform_id===selectedPlatform)&&(!selectedDate||r.follow_up_date===selectedDate));
    document.querySelector('#room-followups').innerHTML=table(['Tarih','Uygulama','Yayıncı','Yayın durumu','Kota kontrolü','İletişim','Yönlendirme','Motivasyon','Takip notu','Sorun / Baş Asistan','Kaydı giren','İşlem'],visible.map(r=>{
      const canEdit=profile.role==='admin'||(profile.role==='room_assistant'&&r.created_by===profile.id);
      const escalation=r.escalation_status==='pending'?'Baş Asistana iletildi':r.escalation_status==='resolved'?'Çözüldü':'Yok';
      const resolution=r.lead_resolution?`<small class="small">Çözüm: ${esc(r.lead_resolution)}</small>`:'';
      return `<tr><td>${niceDate(r.follow_up_date)}</td><td>${esc(r.platforms?.name||'—')}</td><td>${esc(r.publisher_name)}<small class="small">ID: ${esc(r.publisher_id)}</small></td><td>${({streamed:'Yayın yaptı',not_streamed:'Yayın yapmadı',unknown:'Kontrol edilmedi'})[r.broadcast_status]}</td><td>${({on_track:'Kotası uygun',short:'Kota eksiği',unknown:'Kontrol edilmedi'})[r.quota_status]}</td><td>${({contacted:'Görüşüldü',unreachable:'Ulaşılamadı',pending:'Bekliyor'})[r.contact_status]}</td><td>${({none:'—',pk:'PK',event:'Etkinlik',room_activity:'Oda aktivitesi'})[r.activity_invitation]}</td><td>${r.motivation_status==='low'?'Birebir destek gerekli':'Normal'}</td><td>${esc(r.action_notes||'—')}</td><td><span class="pill ${r.escalation_status==='pending'?'review':''}">${escalation}</span>${r.issue_note?`<small class="small">${esc(r.issue_note)}</small>`:''}${resolution}${profile.role==='consultant'&&r.escalation_status==='pending'?`<button class="button" data-resolve-followup="${r.id}">Çözüm gir</button>`:''}</td><td>${esc(r.created_by_name||'—')}</td><td>${canEdit?`<button class="button" data-edit-followup="${r.id}">Düzenle</button>`:''}${profile.role==='admin'?` <button class="button" data-delete-followup="${r.id}">Sil</button>`:'—'}</td></tr>`;
    }),'Bu filtrelerde günlük takip kaydı yok.');
    document.querySelectorAll('[data-edit-followup]').forEach(b=>b.addEventListener('click',()=>fillForm(rows.find(r=>r.id===b.dataset.editFollowup))));
    document.querySelectorAll('[data-delete-followup]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Bu günlük takip kaydını silmek istiyor musun?'))return;const {error:deleteError}=await db.from('room_assistant_followups').delete().eq('id',b.dataset.deleteFollowup);if(deleteError)return msg(deleteError.message,true);msg('Takip kaydı silindi.');renderRoomOperations();}));
    document.querySelectorAll('[data-resolve-followup]').forEach(b=>b.addEventListener('click',async()=>{const resolution=prompt('Baş Asistan çözümünü veya yönlendirme notunu yaz:');if(!resolution?.trim())return;const {error:resolveError}=await db.rpc('resolve_room_assistant_followup',{p_followup_id:b.dataset.resolveFollowup,p_resolution:resolution.trim()});if(resolveError)return msg(resolveError.message,true);msg('Konu çözüldü olarak kaydedildi.');renderRoomOperations();}));
  };
  page.innerHTML=`${titleBlock('Oda Operasyonları','Günlük yayıncı takibini, kota kontrolünü ve Baş Asistana iletilen konuları kaydet.',profile.role==='room_assistant'?'<button class="button primary" id="toggle-room-form">＋ Günlük takip ekle</button>':'')}
    <article id="room-form-box" class="card ${profile.role==='room_assistant'?'hidden':''}"><h2 id="room-form-title">Günlük yayıncı takibi</h2><p>Kota sayısı girilmez. Yüklenen günlük/haftalık rapora bakıp kontrol durumunu seç; sayısal verileri rapor dosyasında tut.</p><form id="room-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Uygulama<select name="platform_id" required>${allowedPlatforms.map(p=>`<option value="${p.id}" ${p.id===defaultPlatform?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="field">Takip tarihi<input name="follow_up_date" type="date" value="${today()}" required></label><label class="field">Yayıncı ID<input name="publisher_id" maxlength="100" required></label><label class="field">Yayıncı adı<input name="publisher_name" maxlength="120" required></label><label class="field">İlgili yüklenmiş rapor<select name="source_report_id">${reportOptions(defaultPlatform)}</select></label><label class="field">Günlük yayın durumu${statusOptions('broadcast_status',[['unknown','Kontrol edilmedi'],['streamed','Yayın yaptı'],['not_streamed','Yayın yapmadı']],'unknown')}</label><label class="field">Kota kontrolü${statusOptions('quota_status',[['unknown','Kontrol edilmedi'],['on_track','Kotası uygun'],['short','Kota eksiği var']],'unknown')}</label><label class="field">İletişim durumu${statusOptions('contact_status',[['pending','Henüz görüşülmedi'],['contacted','Görüşüldü'],['unreachable','Ulaşılamadı']],'pending')}</label><label class="field">Yönlendirme${statusOptions('activity_invitation',[['none','Yok'],['pk','PK'],['event','Etkinlik'],['room_activity','Oda aktivitesi']],'none')}</label><label class="field">Motivasyon<select name="motivation_status"><option value="normal">Normal</option><option value="low">Birebir destek gerekli</option></select></label><label class="field full">Yapılan takip / aksiyon notu<textarea name="action_notes" rows="2" maxlength="1500"></textarea></label><label class="field full">Sorun veya Baş Asistana iletilecek konu<textarea name="issue_note" rows="2" maxlength="1500" placeholder="Çözemediğin bir konu varsa buraya yaz"></textarea></label><div class="form-actions full"><button class="button primary" id="room-save">Kaydet</button><button class="button" type="button" id="room-cancel">Vazgeç</button></div></form></article>
    <div class="section-head"><strong>Günlük yayıncı takipleri</strong><div class="form-grid report-filters"><label class="field">Uygulama<select id="room-filter-platform"><option value="all">Tüm yetkili uygulamalar</option>${allowedPlatforms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Tarih<input id="room-filter-date" type="date"></label></div></div><article class="card" id="room-followups"></article>`;
  if(profile.role==='consultant')document.querySelector('#room-form-box').classList.add('hidden');
  const form=document.querySelector('#room-form');
  const resetForm=()=>{form.reset();form.elements.record_id.value='';form.elements.follow_up_date.value=today();if(defaultPlatform)form.elements.platform_id.value=defaultPlatform;form.elements.source_report_id.innerHTML=reportOptions(form.elements.platform_id.value);form.elements.broadcast_status.value='unknown';form.elements.quota_status.value='unknown';form.elements.contact_status.value='pending';form.elements.activity_invitation.value='none';form.elements.motivation_status.value='normal';document.querySelector('#room-form-title').textContent='Günlük yayıncı takibi';document.querySelector('#room-save').textContent='Kaydet';if(profile.role==='room_assistant')document.querySelector('#room-form-box').classList.add('hidden');};
  const fillForm=r=>{if(!r)return;form.elements.record_id.value=r.id;form.elements.platform_id.value=r.platform_id;form.elements.follow_up_date.value=r.follow_up_date;form.elements.publisher_id.value=r.publisher_id;form.elements.publisher_name.value=r.publisher_name;form.elements.source_report_id.innerHTML=reportOptions(r.platform_id,r.source_report_id||'');form.elements.broadcast_status.value=r.broadcast_status;form.elements.quota_status.value=r.quota_status;form.elements.contact_status.value=r.contact_status;form.elements.activity_invitation.value=r.activity_invitation;form.elements.motivation_status.value=r.motivation_status;form.elements.action_notes.value=r.action_notes||'';form.elements.issue_note.value=r.issue_note||'';document.querySelector('#room-form-title').textContent='Günlük takip kaydını düzenle';document.querySelector('#room-save').textContent='Değişiklikleri kaydet';document.querySelector('#room-form-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});};
  document.querySelector('#room-filter-platform').addEventListener('change',renderRows);document.querySelector('#room-filter-date').addEventListener('change',renderRows);
  document.querySelector('#toggle-room-form')?.addEventListener('click',()=>document.querySelector('#room-form-box').classList.toggle('hidden'));
  document.querySelector('#room-cancel').addEventListener('click',resetForm);
  form.elements.platform_id.addEventListener('change',()=>form.elements.source_report_id.innerHTML=reportOptions(form.elements.platform_id.value));
  form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form);const platformId=f.get('platform_id');if(!allowedIds.has(platformId))return msg('Bu uygulama için yetkin yok.',true);const issue=String(f.get('issue_note')||'').trim();const old=rows.find(r=>r.id===f.get('record_id'));const payload={platform_id:platformId,follow_up_date:f.get('follow_up_date'),publisher_id:String(f.get('publisher_id')).trim(),publisher_name:String(f.get('publisher_name')).trim(),source_report_id:f.get('source_report_id')||null,broadcast_status:f.get('broadcast_status'),quota_status:f.get('quota_status'),contact_status:f.get('contact_status'),activity_invitation:f.get('activity_invitation'),motivation_status:f.get('motivation_status'),action_notes:String(f.get('action_notes')||'').trim()||null,issue_note:issue||null,escalation_status:issue?(old?.escalation_status==='resolved'?'resolved':'pending'):'none',lead_resolution:issue?(old?.lead_resolution||null):null,created_by:old?.created_by||profile.id,created_by_name:old?.created_by_name||visibleName(profile)};const id=f.get('record_id');const query=id?db.from('room_assistant_followups').update(payload).eq('id',id):db.from('room_assistant_followups').insert(payload);const {error:saveError}=await query;if(saveError)return msg(saveError.message,true);msg(id?'Günlük takip güncellendi.':'Günlük takip kaydedildi.');await renderRoomOperations();});
  renderRows();
}

async function renderFinance() {
  const {data,error}=await db.from('financial_entries').select('*,platforms(name),agencies(name)').order('occurred_on',{ascending:false}).limit(200);
  if(error) return page.innerHTML=titleBlock('Gelir & Gider','Finans kayıtları.')+`<div class="empty">${esc(error.message)}</div>`;
  const rows=data||[];const sums={};rows.forEach(r=>{const c=r.currency||'GBP';sums[c]??={income:0,expense:0};sums[c][r.entry_type]+=Number(r.amount)});
  const summary=Object.entries(sums).map(([c,s])=>`<div class="card"><div class="metric-label">${esc(c)} · Net toplam</div><div class="metric-value">${esc(money(s.income-s.expense,c))}</div><div class="metric-foot">Gelir ${esc(money(s.income,c))} · Gider ${esc(money(s.expense,c))}</div></div>`).join('')||cardMetric('Dönem özeti','—','Kayıt eklendikçe hesaplanır');
  page.innerHTML=`${titleBlock('Gelir & Gider','Erişim alanındaki finans kayıtlarını ve para birimine göre toplamları izle.','<button class="button primary" id="toggle-form">＋ Finans kaydı</button>')}<div class="cards">${summary}</div>
    <article id="create-box" class="card hidden"><h2 id="finance-form-title">Gelir / gider ekle</h2><form id="finance-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Tür<select name="entry_type"><option value="income">Gelir</option><option value="expense">Gider</option></select></label><label class="field">Kategori<input name="category" required placeholder="Örn. platform ödemesi, prodüksiyon"></label><label class="field">Tutar<input name="amount" type="text" inputmode="decimal" autocomplete="off" required placeholder="Örn. 1.234,56"></label><label class="field">Para birimi<select name="currency"><option>GBP</option><option>TRY</option><option>EUR</option><option>USD</option></select></label><label class="field">Tarih<input name="occurred_on" type="date" value="${today()}" required></label><label class="field">Uygulama<select name="platform_id">${platformOptions('',true)}</select></label><label class="field full">Açıklama<input name="description"></label><div class="form-actions full"><button class="button primary" id="finance-save">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card"><p>Çalışan ödemelerinden otomatik oluşan giderleri, Çalışan Ödeme Tablosu içindeki ödeme geçmişinden düzelt veya sil.</p>${table(['Tarih','Tür','Kategori','Açıklama','Uygulama','Tutar','İşlem'],rows.map(r=>{const employeePayment=r.category==='Çalışan ödemesi';return `<tr><td>${niceDate(r.occurred_on)}</td><td><span class="pill ${r.entry_type==='expense'?'review':''}">${r.entry_type==='income'?'Gelir':'Gider'}</span></td><td>${esc(r.category)}</td><td>${esc(r.description||'—')}</td><td>${esc(r.platforms?.name||(employeePayment?'Hepsi / Genel kayıt':'—'))}</td><td>${esc(money(r.amount,r.currency))}</td><td>${employeePayment?'<span class="small">Ödeme tablosundan yönetilir</span>':`<button class="button" data-edit-finance="${r.id}">Düzenle</button>${profile.role==='admin'?` <button class="button" data-delete-finance="${r.id}">Sil</button>`:''}`}</td></tr>`;}),'Henüz finans kaydı yok.')}</article>`;
  wireFormToggle();
  const form=document.querySelector('#finance-form');
  document.querySelector('#cancel-form').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';document.querySelector('#finance-form-title').textContent='Gelir / gider ekle';document.querySelector('#finance-save').textContent='Kaydet';});
  form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form);const amount=parseLocalizedAmount(f.get('amount'));if(!Number.isFinite(amount)||amount<0.01)return msg('Tutarı 1.234,56 veya 1234,56 biçiminde gir.',true);const selectedPlatform=f.get('platform_id');const recordId=f.get('record_id');const existing=rows.find(r=>r.id===recordId);const payload={entry_type:f.get('entry_type'),category:f.get('category').trim(),description:f.get('description')||null,amount,currency:f.get('currency'),occurred_on:f.get('occurred_on'),platform_id:selectedPlatform&&selectedPlatform!=='all'?selectedPlatform:null,agency_id:existing?.agency_id||(profile.role==='subagency_owner'?profile.agency_id:null),entered_by:existing?.entered_by||profile.id};const query=recordId?db.from('financial_entries').update(payload).eq('id',recordId):db.from('financial_entries').insert(payload);const {error}=await query;if(error)return msg(error.message,true);msg(recordId?'Finans kaydı güncellendi.':'Finans kaydı eklendi.');renderFinance();});
  page.querySelectorAll('[data-edit-finance]').forEach(button=>button.addEventListener('click',()=>{const r=rows.find(x=>x.id===button.dataset.editFinance);if(!r)return;form.elements.record_id.value=r.id;form.elements.entry_type.value=r.entry_type;form.elements.category.value=r.category||'';form.elements.amount.value=String(r.amount||0).replace('.',',');form.elements.currency.value=r.currency||'GBP';form.elements.occurred_on.value=r.occurred_on||'';form.elements.platform_id.value=r.platform_id||'';form.elements.description.value=r.description||'';document.querySelector('#finance-form-title').textContent='Gelir / gider kaydını düzenle';document.querySelector('#finance-save').textContent='Değişiklikleri kaydet';document.querySelector('#create-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  page.querySelectorAll('[data-delete-finance]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu gelir / gider kaydını silmek istiyor musun?'))return;const {error}=await db.from('financial_entries').delete().eq('id',button.dataset.deleteFinance);if(error)return msg(error.message,true);msg('Finans kaydı silindi.');renderFinance();}));
}

function monthDates() {
  const now=new Date();
  return {start:dateInputValue(new Date(now.getFullYear(),now.getMonth(),1)),end:dateInputValue(new Date(now.getFullYear(),now.getMonth()+1,0))};
}

async function renderMyPaymentStatus() {
  if(!['assistant','consultant','host','room_assistant'].includes(profile.role)) {
    page.innerHTML=titleBlock('Ödeme Durumum','Bu bölüm çalışan hesaplarına açıktır.')+`<div class="empty">Bu kullanıcı rolü için ödeme durumu bulunmuyor.</div>`;
    return;
  }
  const {data,error}=await db.rpc('my_employee_payment_status');
  if(error)return page.innerHTML=titleBlock('Ödeme Durumum','Yalnızca sana ait ödeme durumu.')+`<div class="empty">${esc(error.message)}<br>Ödeme tablosu SQL güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  const rows=data||[];
  page.innerHTML=`${titleBlock('Ödeme Durumum','Kendi haftalık ve aylık ödeme dönemlerinin durumunu görüntüle.')}<article class="card"><p>Bu ekranda yalnızca ödendi / ödenmedi bilgisi görünür. Tutar, IBAN, cüzdan ve diğer çalışan bilgileri paylaşılmaz.</p>${table(['Dönem','Başlangıç – bitiş','Durum'],rows.map(r=>`<tr><td>${r.period_type==='weekly'?'Haftalık':'Aylık'}</td><td>${niceDate(r.period_start)} – ${niceDate(r.period_end)}</td><td><span class="pill ${r.is_paid?'':'review'}">${r.is_paid?'Ödendi':'Ödenmedi'}</span></td></tr>`),'Henüz hesabına bağlı bir ödeme dönemi yok.')}</article>`;
}

async function renderEmployeePayments() {
  if(profile.role!=='admin') {
    page.innerHTML=titleBlock('Çalışan Ödeme Tablosu','Bu bilgiler yalnızca yöneticiye açıktır.')+`<div class="empty">Ödeme bilgilerini görüntüleme yetkin yok.</div>`;
    return;
  }
  const activePlatforms=platforms.filter(p=>p.status==='active');
  const [{data:employees,error:employeeError},{data:cycleData,error:cycleError},{data:paymentData,error:paymentError}]=await Promise.all([
    db.from('employee_payees').select('*,platforms(name)').order('full_name'),
    db.from('employee_payment_cycles').select('*').order('period_end',{ascending:false}).limit(2000),
    db.from('employee_payments').select('id,cycle_id,amount,paid_on,note').order('paid_on',{ascending:false}).limit(5000),
  ]);
  const loadError=employeeError||cycleError||paymentError;
  if(loadError)return page.innerHTML=titleBlock('Çalışan Ödeme Tablosu','Uygulama gruplarına göre özel ödeme takibi.')+`<div class="empty">${esc(loadError.message)}<br>Ödeme tablosu için SQL güncellemesini çalıştır.</div>`;
  await loadProfiles();
  const people=employees||[],cycles=cycleData||[],payments=paymentData||[];
  const paymentMap=new Map();payments.forEach(p=>{if(!paymentMap.has(p.cycle_id))paymentMap.set(p.cycle_id,[]);paymentMap.get(p.cycle_id).push(p);});
  const cycleFor=(employeeId,kind)=>cycles.find(c=>c.employee_id===employeeId&&c.period_type===kind);
  const cycleSummary=(cycle)=>{
    if(!cycle)return '<span class="small">Henüz ödeme yok</span>';
    const paid=(paymentMap.get(cycle.id)||[]).reduce((sum,p)=>sum+Number(p.amount||0),0);
    const remaining=Math.max(0,Number(cycle.amount_due)-paid);
    return `<span class="pill ${remaining?'review':''}">${remaining?'Kalan '+esc(money(remaining,cycle.currency)):'Ödendi'}</span><small class="small payment-period">${niceDate(cycle.period_start)} – ${niceDate(cycle.period_end)}</small>`;
  };
  const personOptions=profiles.filter(p=>p.active&&['assistant','consultant','host','room_assistant'].includes(p.role));
  const renderPeopleGroup=(groupTitle,group)=>`<section class="card payment-group"><div class="payment-group-title"><h2>${esc(groupTitle)}</h2><span class="pill">${group.length} çalışan</span></div>${table(groupTitle.startsWith('Kayıt Asistanları')?['Çalışan','Çalışan no','Telefon','Aylık ödeme','Kayıt primi','Asgari ücret','Borç bilgisi','IBAN','Binance TRC20','Aylık durumu','Haftalık durumu','İşlem']:['Çalışan','Çalışan no','Telefon','Ödenen aylık','Ödenecek haftalık','Asgari ücret','Borç bilgisi','IBAN','Binance TRC20','Aylık durumu','Haftalık durumu','İşlem'],group.map(person=>{const monthly=cycleFor(person.id,'monthly'),weekly=cycleFor(person.id,'weekly');return `<tr><td><strong>${esc(person.full_name)}</strong><small class="small payment-period">${person.profile_id?'Panel hesabıyla eşleştirildi':'Panel hesabı eşleştirilmedi'}</small></td><td>${esc(person.employee_number||'—')}</td><td>${esc(person.phone||'—')}</td><td>${person.employee_type==='assistant'?'—':esc(money(person.monthly_amount,person.currency))}</td><td>${person.employee_type==='assistant'?'25 / 30 / 35 TL · haftalık basamağa göre':esc(money(person.weekly_amount,person.currency))}</td><td>${person.minimum_wage?'Evet':'Hayır'}</td><td>${esc(person.debt_note||'—')}</td><td class="private-value">${esc(person.iban||'—')}</td><td class="private-value">${esc(person.binance_trc20||'—')}</td><td>${cycleSummary(monthly)}</td><td>${cycleSummary(weekly)}</td><td><div class="payment-actions"><button class="button" data-add-payment="${person.id}">Ödeme ekle</button><button class="button" data-payment-history="${person.id}">Geçmiş</button><button class="button" data-edit-payee="${person.id}">Düzenle</button><button class="button" data-delete-payee="${person.id}">Sil</button></div></td></tr>`;}),'Bu grupta henüz çalışan eklenmedi.')}</section>`;
  const assistantPeople=people.filter(p=>p.employee_type==='assistant');
  const platformPeople=people.filter(p=>p.employee_type!=='assistant');
  page.innerHTML=`${titleBlock('Çalışan Ödeme Tablosu','Çalışanları aktif uygulamalar altında takip et; ödeme girişi otomatik olarak giderlere eklenir.','<button class="button primary" id="toggle-payee-form">＋ Çalışan ekle</button>')}
    <article id="payee-form-box" class="card hidden"><h2 id="payee-form-title">Çalışan ekle</h2><form id="payee-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Çalışan grubu<select name="employee_type"><option value="platform_worker">Uygulama çalışanı</option><option value="assistant">Kayıt asistanı · tüm uygulamalar</option></select></label><label class="field" id="payee-platform-field">Uygulama<select name="platform_id" required>${activePlatforms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Panel hesabıyla eşleştir<select name="profile_id"><option value="">Eşleştirme yok</option>${personOptions.map(p=>`<option value="${p.id}" data-role="${p.role}">${esc(visibleName(p))} · ${esc(roleName(p.role))}</option>`).join('')}</select><small class="small">Eşleştirilen çalışan yalnızca kendi ödeme durumunu görebilir.</small></label><label class="field">Çalışan adı soyadı<input name="full_name" required maxlength="160"></label><label class="field">Çalışan numarası<input name="employee_number" type="text" maxlength="80"></label><label class="field">Telefon<input name="phone" type="tel" maxlength="80"></label><label class="field">IBAN<input name="iban" type="text" maxlength="80" autocomplete="off"></label><label class="field">Binance TRC20 adresi<input name="binance_trc20" type="text" maxlength="160" autocomplete="off"></label><label class="field">Aylık ödeme<input name="monthly_amount" type="text" inputmode="decimal" placeholder="Örn. 1.234,56"></label><label class="field">Haftalık ödeme<input name="weekly_amount" type="text" inputmode="decimal" placeholder="Örn. 250,00"></label><label class="field">Para birimi<select name="currency"><option>USD</option><option>GBP</option><option>TRY</option><option>EUR</option></select></label><label class="field">Asgari ücret<select name="minimum_wage"><option value="false">Hayır</option><option value="true">Evet</option></select></label><label class="field">Durum<select name="status"><option value="active">Aktif</option><option value="inactive">Pasif</option></select></label><label class="field full">Borç bilgisi / not<textarea name="debt_note" rows="2" maxlength="1000"></textarea></label><div class="form-actions full"><button class="button primary" id="payee-save">Kaydet</button><button class="button" type="button" id="cancel-payee">Vazgeç</button></div></form></article>
    <article id="payment-form-box" class="card hidden"><h2>Ödeme girişi · <span id="payment-person-name"></span></h2><p>Her ödeme giderlere ayrı kayıt olarak eklenir. Kısmi ödeme girersen kalan tutar beklemede kalır.</p><div id="assistant-commission-summary" class="notice hidden"></div><form id="payment-form" class="form-grid"><input type="hidden" name="employee_id"><label class="field">Ödeme türü<select name="period_type"><option value="monthly">Aylık</option><option value="weekly">Haftalık</option></select></label><label class="field">Para birimi<select name="currency"><option>USD</option><option>GBP</option><option>TRY</option><option>EUR</option></select></label><label class="field">Dönem başlangıcı<input name="period_start" type="date" required></label><label class="field">Dönem bitişi<input name="period_end" type="date" required></label><label class="field">Bu dönem ödenecek tutar<input name="amount_due" type="text" inputmode="decimal" required></label><label class="field">Şimdi ödenen tutar<input name="amount" type="text" inputmode="decimal" required></label><label class="field">Ödeme tarihi<input name="paid_on" type="date" value="${today()}" required></label><label class="field full">Not (isteğe bağlı)<input name="note" maxlength="500"></label><div class="form-actions full"><button class="button primary" id="payment-save">Ödendi ve giderlere işle</button><button class="button" type="button" id="cancel-payment">Vazgeç</button></div></form></article>
    <article id="payment-history-box" class="card hidden"><div class="section-head"><h2 id="payment-history-title">Ödeme geçmişi</h2><button class="button" id="close-payment-history">Kapat</button></div><div id="payment-history-table"></div></article>
    <div class="payment-groups">${renderPeopleGroup('Kayıt Asistanları · Tüm uygulamalar',assistantPeople)}${activePlatforms.map(platform=>renderPeopleGroup(platform.name,platformPeople.filter(p=>p.platform_id===platform.id))).join('')||'<div class="empty">Aktif uygulama bulunamadı.</div>'}</div>`;

  const payeeForm=document.querySelector('#payee-form');
  document.querySelector('#toggle-payee-form').addEventListener('click',()=>document.querySelector('#payee-form-box').classList.toggle('hidden'));
  document.querySelector('#cancel-payee').addEventListener('click',()=>{payeeForm.reset();payeeForm.elements.record_id.value='';syncPayeeType();document.querySelector('#payee-form-title').textContent='Çalışan ekle';document.querySelector('#payee-save').textContent='Kaydet';document.querySelector('#payee-form-box').classList.add('hidden');});
  const typeField=payeeForm.elements.employee_type,platformField=payeeForm.elements.platform_id,profileField=payeeForm.elements.profile_id;
  const syncPayeeType=()=>{const isAssistant=typeField.value==='assistant';document.querySelector('#payee-platform-field').classList.toggle('hidden',isAssistant);platformField.required=!isAssistant;platformField.disabled=isAssistant;};
  typeField.addEventListener('change',syncPayeeType);syncPayeeType();
  profileField.addEventListener('change',()=>{const selectedRole=profileField.selectedOptions[0]?.dataset.role;if(selectedRole==='assistant'){typeField.value='assistant';syncPayeeType();}});
  payeeForm.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(payeeForm);const monthly=parseLocalizedAmount(f.get('monthly_amount')||'0'),weekly=parseLocalizedAmount(f.get('weekly_amount')||'0');if(!Number.isFinite(monthly)||monthly<0||!Number.isFinite(weekly)||weekly<0)return msg('Aylık ve haftalık ödeme tutarlarını kontrol et.',true);const rowId=f.get('record_id');const employeeType=f.get('employee_type');const payload={employee_type:employeeType,platform_id:employeeType==='assistant'?null:f.get('platform_id'),profile_id:f.get('profile_id')||null,full_name:String(f.get('full_name')).trim(),employee_number:String(f.get('employee_number')||'').trim()||null,phone:String(f.get('phone')||'').trim()||null,iban:String(f.get('iban')||'').trim()||null,binance_trc20:String(f.get('binance_trc20')||'').trim()||null,monthly_amount:monthly,weekly_amount:weekly,currency:f.get('currency'),minimum_wage:f.get('minimum_wage')==='true',debt_note:String(f.get('debt_note')||'').trim()||null,status:f.get('status'),updated_at:new Date().toISOString()};const query=rowId?db.from('employee_payees').update(payload).eq('id',rowId):db.from('employee_payees').insert(payload);const {error}=await query;if(error)return msg(error.message,true);msg(rowId?'Çalışan bilgileri güncellendi.':'Çalışan eklendi.');await renderEmployeePayments();});
  page.querySelectorAll('[data-edit-payee]').forEach(button=>button.addEventListener('click',()=>{const person=people.find(p=>p.id===button.dataset.editPayee);if(!person)return;payeeForm.elements.record_id.value=person.id;for(const key of ['employee_type','platform_id','profile_id','full_name','employee_number','phone','iban','binance_trc20','currency','status','debt_note'])payeeForm.elements[key].value=person[key]||'';payeeForm.elements.monthly_amount.value=String(person.monthly_amount||0).replace('.',',');payeeForm.elements.weekly_amount.value=String(person.weekly_amount||0).replace('.',',');payeeForm.elements.minimum_wage.value=String(!!person.minimum_wage);syncPayeeType();document.querySelector('#payee-form-title').textContent='Çalışan bilgilerini düzenle';document.querySelector('#payee-save').textContent='Değişiklikleri kaydet';document.querySelector('#payee-form-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  page.querySelectorAll('[data-delete-payee]').forEach(button=>button.addEventListener('click',async()=>{const person=people.find(p=>p.id===button.dataset.deletePayee);if(!person||!confirm(`${person.full_name} çalışan kaydını ve ödeme geçmişini silmek istiyor musun? Gider kayıtları korunur.`))return;const {error}=await db.from('employee_payees').delete().eq('id',person.id);if(error)return msg(error.message,true);msg('Çalışan ve ödeme geçmişi silindi. Önceki gider kayıtları korundu.');await renderEmployeePayments();}));
  page.querySelectorAll('[data-payment-history]').forEach(button=>button.addEventListener('click',()=>{const person=people.find(p=>p.id===button.dataset.paymentHistory);if(!person)return;const personCycles=cycles.filter(c=>c.employee_id===person.id);document.querySelector('#payment-history-title').textContent=`${person.full_name} · Ödeme geçmişi`;const historyRows=personCycles.flatMap(cycle=>{const cyclePayments=paymentMap.get(cycle.id)||[];const paid=cyclePayments.reduce((sum,p)=>sum+Number(p.amount||0),0);const remaining=Math.max(0,Number(cycle.amount_due)-paid);return cyclePayments.map(payment=>`<tr><td>${cycle.period_type==='weekly'?'Haftalık':'Aylık'}</td><td>${niceDate(cycle.period_start)} – ${niceDate(cycle.period_end)}</td><td>${niceDate(payment.paid_on)}</td><td>${esc(money(payment.amount,cycle.currency))}</td><td>${esc(money(remaining,cycle.currency))} kalan</td><td><button class="button" data-delete-payment="${payment.id}">Sil ve gideri geri al</button></td></tr>`);});document.querySelector('#payment-history-table').innerHTML=table(['Tür','Dönem','Ödeme tarihi','Ödenen','Dönem bakiyesi','İşlem'],historyRows,'Bu çalışan için henüz ödeme yok.');document.querySelector('#payment-history-box').classList.remove('hidden');document.querySelectorAll('[data-delete-payment]').forEach(deleteButton=>deleteButton.addEventListener('click',async()=>{if(!confirm('Bu ödeme ve ona bağlı gider kaydı silinsin mi?'))return;const {error}=await db.rpc('delete_employee_payment',{p_payment_id:deleteButton.dataset.deletePayment});if(error)return msg(error.message,true);msg('Ödeme ve bağlı gider kaydı silindi.');await renderEmployeePayments();}));window.scrollTo({top:document.querySelector('#payment-history-box').offsetTop,behavior:'smooth'});}));
  document.querySelector('#close-payment-history').addEventListener('click',()=>document.querySelector('#payment-history-box').classList.add('hidden'));
  const paymentForm=document.querySelector('#payment-form');
  let commissionLookup=0;
  const refreshAssistantCommission=async()=>{const lookup=++commissionLookup,person=people.find(p=>p.id===paymentForm.elements.employee_id.value);if(!person||person.employee_type!=='assistant')return;const start=paymentForm.elements.period_start.value,end=paymentForm.elements.period_end.value,summary=document.querySelector('#assistant-commission-summary');summary.classList.remove('hidden');summary.textContent='Haftalık performans raporları hesaplanıyor…';paymentForm.elements.amount_due.value='';paymentForm.elements.amount.value='';paymentForm.elements.currency.value='TRY';if(!person.profile_id){summary.textContent='Otomatik prim hesabı için bu kayıt asistanını panel hesabıyla eşleştir.';return;}if(!start||!end||end<start){summary.textContent='Hafta başlangıç ve bitiş tarihlerini kontrol et.';return;}const {data,error}=await db.from('performance_entries').select('registrations_count').eq('user_id',person.profile_id).eq('report_type','assistant').gte('period_start',start).lte('period_end',end);if(lookup!==commissionLookup)return;if(error){summary.textContent='Haftalık performans verisi alınamadı: '+error.message;return;}const count=(data||[]).reduce((sum,row)=>sum+Number(row.registrations_count||0),0);const rate=count>=101?35:count>=51?30:count>0?25:0;const total=count*rate;paymentForm.elements.amount_due.value=String(total).replace('.',',');paymentForm.elements.amount.value=String(total).replace('.',',');summary.innerHTML=`Bu hafta <strong>${count}</strong> kayıt × <strong>${rate} TL</strong> = <strong>${esc(money(total,'TRY'))}</strong>. Prim basamağı haftalık toplam kayıt sayısına göre tüm kayıtlara uygulanır.`;};
  const setPaymentDefaults=()=>{commissionLookup++;const person=people.find(p=>p.id===paymentForm.elements.employee_id.value);if(!person)return;const isAssistant=person.employee_type==='assistant';const periodField=paymentForm.elements.period_type;const selectedKind=periodField.value;periodField.innerHTML=isAssistant?'<option value="weekly">Haftalık kayıt primi</option>':'<option value="monthly">Aylık</option><option value="weekly">Haftalık</option>';const kind=isAssistant?'weekly':(selectedKind==='weekly'?'weekly':'monthly');periodField.value=kind;const range=kind==='weekly'?weekDates():monthDates();paymentForm.elements.period_start.value=range.start;paymentForm.elements.period_end.value=range.end;paymentForm.elements.amount.value='';paymentForm.elements.amount_due.readOnly=isAssistant;if(isAssistant){paymentForm.elements.currency.value='TRY';refreshAssistantCommission();}else{document.querySelector('#assistant-commission-summary').classList.add('hidden');paymentForm.elements.amount_due.value=String(kind==='weekly'?person.weekly_amount:person.monthly_amount).replace('.',',');paymentForm.elements.currency.value=person.currency||'USD';}};
  page.querySelectorAll('[data-add-payment]').forEach(button=>button.addEventListener('click',()=>{const person=people.find(p=>p.id===button.dataset.addPayment);if(!person)return;paymentForm.reset();paymentForm.elements.employee_id.value=person.id;document.querySelector('#payment-person-name').textContent=person.full_name;paymentForm.elements.paid_on.value=today();setPaymentDefaults();document.querySelector('#payment-form-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  paymentForm.elements.period_type.addEventListener('change',setPaymentDefaults);
  paymentForm.elements.period_start.addEventListener('change',()=>refreshAssistantCommission());
  paymentForm.elements.period_end.addEventListener('change',()=>refreshAssistantCommission());
  document.querySelector('#cancel-payment').addEventListener('click',()=>{paymentForm.reset();document.querySelector('#payment-form-box').classList.add('hidden');});
  paymentForm.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(paymentForm);const due=parseLocalizedAmount(f.get('amount_due')),amount=parseLocalizedAmount(f.get('amount'));if(!Number.isFinite(due)||due<=0||!Number.isFinite(amount)||amount<=0)return msg('Dönem tutarı ile ödenen tutarı kontrol et.',true);if(f.get('period_end')<f.get('period_start'))return msg('Dönem bitişi başlangıçtan önce olamaz.',true);if(f.get('period_type')==='weekly'&&!isMondayToSunday(f.get('period_start'),f.get('period_end')))return msg('Haftalık ödeme dönemi pazartesi başlamalı ve pazar bitmeli.',true);const save=document.querySelector('#payment-save');save.disabled=true;save.textContent='Kaydediliyor…';const {data,error}=await db.rpc('record_employee_payment',{p_employee_id:f.get('employee_id'),p_period_type:f.get('period_type'),p_period_start:f.get('period_start'),p_period_end:f.get('period_end'),p_amount_due:due,p_amount:amount,p_currency:f.get('currency'),p_paid_on:f.get('paid_on'),p_note:String(f.get('note')||'').trim()||null});save.disabled=false;save.textContent='Ödendi ve giderlere işle';if(error)return msg(error.message,true);const result=Array.isArray(data)?data[0]:data;document.querySelector('#payment-form-box').classList.add('hidden');msg(result?.is_paid?'Ödeme tamamlandı ve giderlere işlendi.':'Kısmi ödeme giderlere işlendi; kalan tutar beklemede.');await renderEmployeePayments();});
}

async function renderPerformance() {
  await loadProfiles();
  const {data,error}=await db.from('performance_entries').select('*,profiles!performance_entries_user_id_fkey(full_name,display_name),platforms(name),agencies(name)').order('period_start',{ascending:false}).limit(200);
  if(error) return page.innerHTML=titleBlock('Performans','Kişi ve ekip performans kayıtları.')+`<div class="empty">${esc(error.message)}<br>Veritabanı ilişkisi farklıysa performans listesi ilk kurulumda güncellenebilir.</div>`;
  const reportRole=profile.role==='admin'?'assistant':profile.role==='consultant'?'consultant':'assistant';
  const rows=(data||[]).filter(r=>profile.role==='admin'||profile.role==='subagency_owner'||(r.report_type||'assistant')===reportRole);
  const week=weekDates();
  const userSelect=(role)=>profile.role==='admin'
    ? `<label class="field">${role==='consultant'?'Danışman':'Kayıt asistanı'}<select name="user_id" required><option value="">Kişi seç</option>${profiles.filter(p=>p.active&&p.role===role).map(p=>`<option value="${p.id}">${esc(visibleName(p))}</option>`).join('')}</select></label>`
    : `<label class="field">${profile.role==='consultant'?'Danışman':'Kayıt asistanı'}<select name="user_id" required><option value="${profile.id}" selected>${esc(visibleName(profile))}</option></select></label>`;
  const assistantFields=`<div class="form-grid full"><label class="field">Alınan toplam numara<input name="phone_numbers_count" type="number" min="0" step="1" value="0" required></label><label class="field">Toplam alınan kayıt<input name="registrations_count" type="number" min="0" step="1" value="0" required></label></div>`;
  const consultantFields=`<div class="form-grid full"><label class="field">Bu hafta yapılan toplam kota<input name="quota_completed" type="number" min="0" step="1" value="0" required></label><label class="field">Arka plan kotası<input name="background_quota" type="number" min="0" step="1" value="0" required></label><label class="field full">Haftalık sorunlar<textarea name="weekly_issues" rows="3" placeholder="Bu hafta karşılaşılan sorunları yazın"></textarea></label><label class="field full">Çözüm önerileri<textarea name="solution_suggestions" rows="3" placeholder="Önerilen çözümleri yazın"></textarea></label></div>`;
  const initialType=profile.role==='consultant'?'consultant':'assistant';
  const adminType=profile.role==='admin'?`<label class="field">Rapor türü<select name="report_type"><option value="assistant">Kayıt asistanı haftalık raporu</option><option value="consultant">Danışman haftalık raporu</option></select></label>`:'';
  const fieldsFor=(role)=>`<input type="hidden" name="record_id">${userSelect(role)}<label class="field">Uygulama<select name="platform_id">${platformOptions('',true)}</select></label><label class="field">Hafta başlangıcı<input name="period_start" type="date" value="${week.start}" required></label><label class="field">Hafta bitişi<input name="period_end" type="date" value="${week.end}" required></label>${role==='consultant'?consultantFields:assistantFields}${profile.role==='admin'?`<div class="form-grid full"><label class="field">Yönetici ciro katkısı (isteğe bağlı)<input name="revenue_contribution" type="number" step="0.01" min="0" value="0"></label><label class="field">Para birimi<select name="currency"><option>GBP</option><option>TRY</option><option>EUR</option><option>USD</option></select></label></div>`:''}<div class="form-actions full"><button class="button primary" id="performance-save">Kaydet</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div>`;
  const adminForm=`<form id="performance-form" class="form-grid">${adminType}<div id="performance-fields" class="form-grid full">${fieldsFor(initialType)}</div></form>`;
  const selfForm=`<form id="performance-form" class="form-grid">${fieldsFor(initialType)}</form>`;
  const heading=profile.role==='consultant'?'Danışman haftalık raporu':profile.role==='admin'?'Haftalık ekip performansı':'Kayıt asistanı haftalık performansı';
  const subtitle=profile.role==='consultant'?'Danışmanlar kendi uygulamalarına ait haftalık kota, arka plan kotası, sorun ve çözüm raporunu girer.':'Kayıt asistanları yalnızca haftalık numara ve kayıt toplamlarını girer.';
  const makeRow=(r)=>{
    const kind=r.report_type||'assistant';
    const common=`<td>${esc(visibleName(r.profiles))}</td>${profile.role==='admin'||profile.role==='subagency_owner'?`<td>${kind==='consultant'?'Danışman':'Kayıt asistanı'}</td>`:''}<td>${esc(r.agencies?.name||'Merkez')}</td><td>${esc(r.platforms?.name||'Hepsi / Genel kayıt')}</td><td>${niceDate(r.period_start)} – ${niceDate(r.period_end)}</td>`;
    const canEdit=profile.role==='admin'||r.user_id===profile.id;
    const actions=`<td>${canEdit?`<button class="button" data-edit-performance="${r.id}">Düzenle</button>`:''}${profile.role==='admin'?` <button class="button" data-delete-performance="${r.id}">Sil</button>`:canEdit?'':'—'}</td>`;
    if(profile.role==='admin'||profile.role==='subagency_owner') return `<tr>${common}<td>${kind==='assistant'?Number(r.phone_numbers_count||0):'—'}</td><td>${kind==='assistant'?Number(r.registrations_count||0):'—'}</td><td>${kind==='consultant'?Number(r.quota_completed||0):'—'}</td><td>${kind==='consultant'?Number(r.background_quota||0):'—'}</td><td>${kind==='consultant'?esc(r.weekly_issues||'—'):'—'}</td><td>${kind==='consultant'?esc(r.solution_suggestions||'—'):'—'}</td>${profile.role==='admin'?`<td>${esc(money(r.revenue_contribution,r.currency))}</td>`:''}${actions}</tr>`;
    const detail=kind==='consultant'?`<td>${Number(r.quota_completed||0)}</td><td>${Number(r.background_quota||0)}</td><td>${esc(r.weekly_issues||'—')}</td><td>${esc(r.solution_suggestions||'—')}</td>`:`<td>${Number(r.phone_numbers_count||0)}</td><td>${Number(r.registrations_count||0)}</td>`;
    return `<tr>${common}${detail}${actions}</tr>`;
  };
  const columns=profile.role==='admin'||profile.role==='subagency_owner'?['Ad soyad','Rapor türü','Alt ajans','Uygulama','Hafta','Alınan toplam numara','Toplam alınan kayıt','Toplam kota','Arka plan kotası','Haftalık sorunlar','Çözüm önerileri',...(profile.role==='admin'?['Ciro katkısı']:[]),'İşlem']
    :reportRole==='consultant'?['Danışman','Alt ajans','Uygulama','Hafta','Toplam kota','Arka plan kotası','Haftalık sorunlar','Çözüm önerileri','İşlem']
    :['Kayıt asistanı','Alt ajans','Uygulama','Hafta','Alınan toplam numara','Toplam alınan kayıt','İşlem'];
  const filterable=profile.role==='admin'||profile.role==='subagency_owner';
  const initialVisibleRows=filterable?rows:rows.filter(r=>(r.report_type||'assistant')===reportRole);
  page.innerHTML=`${titleBlock('Performans',subtitle,'<button class="button primary" id="toggle-form">＋ Haftalık rapor gir</button>')}
    <article id="create-box" class="card hidden"><h2>${heading}</h2>${profile.role==='admin'?adminForm:selfForm}</article>
    ${filterable?`<div class="section-head"><strong>Haftalık raporlar</strong><label class="field" style="min-width:220px;margin:0"><span class="small">Rapor türü filtresi</span><select id="performance-filter"><option value="all">Tüm rapor türleri</option><option value="assistant">Kayıt asistanları</option><option value="consultant">Danışmanlar</option></select></label></div>`:''}
    <article class="card" id="performance-table-card">${table(columns,initialVisibleRows.map(makeRow),'Henüz haftalık performans kaydı yok.')}</article>`;
  wireFormToggle();
  const form=document.querySelector('#performance-form');
  let editingRecordId='', editingReportType='';
  const typeSelect=profile.role==='admin'?form.elements.report_type:null;
  const renderAdminFields=()=>{const role=typeSelect.value;document.querySelector('#performance-fields').innerHTML=fieldsFor(role);};
  if(profile.role==='admin') {
    typeSelect.addEventListener('change',renderAdminFields);
  }
  form.addEventListener('click',event=>{if(!event.target.closest('#cancel-form'))return;editingRecordId='';editingReportType='';form.reset();if(typeSelect){typeSelect.disabled=false;typeSelect.value='assistant';renderAdminFields();}document.querySelector('#performance-save').textContent='Kaydet';document.querySelector('#create-box h2').textContent=heading;document.querySelector('#create-box').classList.add('hidden');});
  const wirePerformanceRowActions=()=>{
    page.querySelectorAll('[data-edit-performance]').forEach(button=>button.addEventListener('click',()=>{const r=rows.find(x=>x.id===button.dataset.editPerformance);if(!r)return;editingRecordId=r.id;editingReportType=r.report_type||'assistant';if(typeSelect){typeSelect.value=editingReportType;typeSelect.dispatchEvent(new Event('change'));typeSelect.disabled=true;}form.elements.record_id.value=r.id;if(form.elements.user_id)form.elements.user_id.value=r.user_id;form.elements.platform_id.value=r.platform_id||'all';form.elements.period_start.value=r.period_start;form.elements.period_end.value=r.period_end;if(editingReportType==='assistant'){form.elements.phone_numbers_count.value=r.phone_numbers_count||0;form.elements.registrations_count.value=r.registrations_count||0;}else{form.elements.quota_completed.value=r.quota_completed||0;form.elements.background_quota.value=r.background_quota||0;form.elements.weekly_issues.value=r.weekly_issues||'';form.elements.solution_suggestions.value=r.solution_suggestions||'';}if(profile.role==='admin'){form.elements.revenue_contribution.value=r.revenue_contribution||0;form.elements.currency.value=r.currency||'GBP';}document.querySelector('#performance-save').textContent='Değişiklikleri kaydet';document.querySelector('#create-box h2').textContent='Haftalık raporu düzenle';document.querySelector('#create-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
    page.querySelectorAll('[data-delete-performance]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu haftalık performans kaydını silmek istiyor musun?'))return;const {error}=await db.from('performance_entries').delete().eq('id',button.dataset.deletePerformance);if(error)return msg(error.message,true);msg('Performans kaydı silindi.');renderPerformance();}));
  };
  wirePerformanceRowActions();
  if(filterable) document.querySelector('#performance-filter').addEventListener('change',event=>{const selected=event.currentTarget.value;const visible=selected==='all'?rows:rows.filter(r=>(r.report_type||'assistant')===selected);document.querySelector('#performance-table-card').innerHTML=table(columns,visible.map(makeRow),'Bu rapor türünde kayıt yok.');wirePerformanceRowActions();});
  form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form);const kind=editingReportType||(profile.role==='admin'?f.get('report_type'):initialType);const selectedUser=profile.role==='admin'?profiles.find(p=>p.id===f.get('user_id')):profile;if(!selectedUser)return msg('Önce kişiyi seç.',true);if(f.get('period_end')<f.get('period_start'))return msg('Hafta bitişi başlangıç tarihinden önce olamaz.',true);if(!isMondayToSunday(f.get('period_start'),f.get('period_end')))return msg('Haftalık performans dönemi pazartesi başlamalı ve pazar bitmeli.',true);
    const input={user_id:selectedUser.id,agency_id:selectedUser.agency_id||null,platform_id:f.get('platform_id')&&f.get('platform_id')!=='all'?f.get('platform_id'):null,period_start:f.get('period_start'),period_end:f.get('period_end'),report_type:kind,phone_numbers_count:kind==='assistant'?Number(f.get('phone_numbers_count')||0):0,applications_count:0,registrations_count:kind==='assistant'?Number(f.get('registrations_count')||0):0,active_creators_count:0,quota_completed:kind==='consultant'?Number(f.get('quota_completed')||0):0,background_quota:kind==='consultant'?Number(f.get('background_quota')||0):0,weekly_issues:kind==='consultant'?(f.get('weekly_issues')||null):null,solution_suggestions:kind==='consultant'?(f.get('solution_suggestions')||null):null,revenue_contribution:profile.role==='admin'?Number(f.get('revenue_contribution')||0):0,currency:profile.role==='admin'?f.get('currency'):'GBP',note:null,entered_by:profile.id};
    const query=editingRecordId?db.from('performance_entries').update(input).eq('id',editingRecordId):db.from('performance_entries').insert(input);const {error}=await query;if(error)return msg(error.message,true);msg(editingRecordId?'Performans raporu güncellendi.':'Haftalık rapor kaydedildi.');renderPerformance();});
}

async function renderReferrals(filters={}) {
  if(profile.role==='admin')await loadProfiles();
  const canManage=profile.role==='admin'||profile.role==='assistant';
  const week=weekDates();
  let allowedPlatforms=platforms.filter(p=>p.status==='active');
  if(profile.role==='consultant') {
    const {data:assignments,error:assignmentError}=await db.from('consultant_platforms').select('platform_id').eq('user_id',profile.id);
    if(assignmentError)return page.innerHTML=titleBlock('Referans Kayıtları','Yetkili olduğun uygulamaların referansları.')+`<div class="empty">${esc(assignmentError.message)}</div>`;
    const assigned=new Set((assignments||[]).map(r=>r.platform_id));
    allowedPlatforms=platforms.filter(p=>assigned.has(p.id));
  }
  const start=filters.start||week.start,end=filters.end||week.end;
  const selectedPlatform=filters.platform||'all';
  const platformFilter=profile.role==='consultant'
    ? `<option value="all">Tüm yetkili uygulamalar</option>${allowedPlatforms.map(p=>`<option value="${p.id}" ${selectedPlatform===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}`
    : `<option value="all">Tüm uygulamalar</option>${allowedPlatforms.map(p=>`<option value="${p.id}" ${selectedPlatform===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}`;
  let query=db.from('referral_entries').select('*,platforms(name)').gte('period_start',start).lte('period_end',end).order('period_start',{ascending:false}).order('created_at',{ascending:false}).limit(1000);
  if(selectedPlatform!=='all')query=query.eq('platform_id',selectedPlatform);
  const {data,error}=await query;
  if(error)return page.innerHTML=titleBlock('Referans Kayıtları','Haftalık referansları uygulamaya ve döneme göre incele.')+`<div class="empty">${esc(error.message)}<br>Referans kayıtları SQL güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  const records=data||[];
  const canEditRecord=r=>profile.role==='admin'||(profile.role==='assistant'&&r.submitted_by===profile.id);
  const canEditPayment=r=>profile.role==='admin'||profile.role==='consultant'||(profile.role==='assistant'&&r.submitted_by===profile.id);
  const tableRows=records.map(r=>{
    const recordActions=`${canEditRecord(r)?`<button class="button" data-edit-referral="${r.id}">Düzenle</button>`:''}${profile.role==='admin'?` <button class="button" data-delete-referral="${r.id}">Sil</button>`:''}`;
    const paymentStatus=r.referral_payment_status||'unknown',paymentText=paymentStatus==='paid'?`Referans Ödemesi Var · ${money(r.referral_payment_amount,r.referral_payment_currency||'TRY')}`:paymentStatus==='not_paid'?'Referans Ödemesi Yoktur':'Ödeme bilgisi girilmedi';
    const paymentCell=canEditPayment(r)?`<div class="payment-actions referral-payment-controls"><select data-referral-pay-status="${r.id}" aria-label="Referans ödeme durumu"><option value="unknown" ${paymentStatus==='unknown'?'selected':''}>Seçilmedi</option><option value="paid" ${paymentStatus==='paid'?'selected':''}>Referans Ödemesi Var</option><option value="not_paid" ${paymentStatus==='not_paid'?'selected':''}>Referans Ödemesi Yoktur</option></select><input data-referral-pay-amount="${r.id}" type="text" inputmode="decimal" aria-label="Referans ödeme tutarı" placeholder="Tutar" value="${paymentStatus==='paid'?esc(String(r.referral_payment_amount).replace('.',',')):''}"><select data-referral-pay-currency="${r.id}" aria-label="Para birimi"><option value="TRY" ${(r.referral_payment_currency||'TRY')==='TRY'?'selected':''}>TRY</option><option value="GBP" ${r.referral_payment_currency==='GBP'?'selected':''}>GBP</option><option value="USD" ${r.referral_payment_currency==='USD'?'selected':''}>USD</option><option value="EUR" ${r.referral_payment_currency==='EUR'?'selected':''}>EUR</option></select><button class="button" data-save-referral-payment="${r.id}">Kaydet</button></div>`:`<span>${esc(paymentText)}</span>`;
    return `<tr><td>${esc(r.platforms?.name||'—')}</td><td>${niceDate(r.period_start)} – ${niceDate(r.period_end)}</td><td>${esc(r.referred_creator_id)}</td><td>${esc(r.referred_creator_phone)}</td><td>${esc(r.referrer_name)}</td><td>${esc(r.referrer_phone)}</td><td>${esc(paymentText)}</td><td>${canEditPayment(r)?paymentCell:'—'}</td>${profile.role==='admin'?`<td>${esc(profiles.find(p=>p.id===r.submitted_by)?.display_name||profiles.find(p=>p.id===r.submitted_by)?.full_name||'—')}</td>`:''}<td>${recordActions||'—'}</td></tr>`;
  });
  const startValue=esc(start),endValue=esc(end),editingAllowed=canManage;
  page.innerHTML=`${titleBlock('Referans Kayıtları','Haftalık referans kayıtlarını uygulamaya göre gir ve filtrele.',editingAllowed?'<button class="button primary" id="toggle-referral-form">＋ Referans kaydı ekle</button>':'')}
    <article class="card"><div class="form-grid referral-filters"><label class="field">Uygulama<select id="referral-filter-platform">${platformFilter}</select></label><label class="field">Hafta başlangıcı<input id="referral-filter-start" type="date" value="${startValue}"></label><label class="field">Hafta bitişi<input id="referral-filter-end" type="date" value="${endValue}"></label><div class="form-actions"><button class="button primary" id="apply-referral-filters">Filtrele</button><span class="pill">${records.length} kayıt</span></div></div></article>
    ${editingAllowed?`<article id="referral-form-card" class="card hidden"><h2 id="referral-form-title">Referans kaydı ekle</h2><p>Üstte referansla gelen yayıncının bilgilerini, altta onu yönlendiren kişinin bilgilerini gir.</p><form id="referral-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Uygulama<select name="platform_id" required>${allowedPlatforms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Hafta başlangıcı<input name="period_start" type="date" value="${week.start}" required></label><label class="field">Hafta bitişi<input name="period_end" type="date" value="${week.end}" required></label><label class="field">Referansla gelen yayıncının ID’si<input name="referred_creator_id" required maxlength="80"></label><label class="field">Referansla gelen yayıncının iletişim telefonu<input name="referred_creator_phone" type="tel" required maxlength="80"></label><label class="field">Referans olan kişinin adı<input name="referrer_name" required maxlength="160"></label><label class="field">Referans olan kişinin telefonu<input name="referrer_phone" type="tel" required maxlength="80"></label><div class="form-actions full"><button class="button primary" id="referral-save">Kaydet</button><button class="button" type="button" id="cancel-referral">Vazgeç</button></div></form></article>`:''}
    <article class="card">${table(['Uygulama','Hafta','Referansla gelen yayıncı ID','Yayıncı iletişim telefonu','Referans olan kişinin adı','Referans olan kişinin telefonu','Referans ödeme bilgisi','Ödeme bilgisi işlemi',...(profile.role==='admin'?['Kaydı giren']:[]),'İşlem'],tableRows,'Bu hafta ve uygulama filtresinde referans kaydı yok.')}</article>`;
  document.querySelector('#apply-referral-filters').addEventListener('click',()=>renderReferrals({start:document.querySelector('#referral-filter-start').value,end:document.querySelector('#referral-filter-end').value,platform:document.querySelector('#referral-filter-platform').value}));
  page.querySelectorAll('[data-save-referral-payment]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.saveReferralPayment,status=page.querySelector(`[data-referral-pay-status="${id}"]`)?.value,currency=page.querySelector(`[data-referral-pay-currency="${id}"]`)?.value||'TRY',amountText=page.querySelector(`[data-referral-pay-amount="${id}"]`)?.value||'',amount=status==='paid'?parseLocalizedAmount(amountText):null;if(status==='paid'&&(!Number.isFinite(amount)||amount<=0))return msg('Referans ödemesi var seçildiğinde geçerli tutarı gir.',true);button.disabled=true;const {error:paymentError}=await db.rpc('set_referral_payment',{p_referral_id:id,p_status:status,p_amount:amount,p_currency:currency});if(paymentError){button.disabled=false;return msg(paymentError.message,true);}msg('Referans ödeme bilgisi kaydedildi.');await renderReferrals({start:document.querySelector('#referral-filter-start').value,end:document.querySelector('#referral-filter-end').value,platform:document.querySelector('#referral-filter-platform').value});}));
  if(!editingAllowed)return;
  const form=document.querySelector('#referral-form');
  document.querySelector('#toggle-referral-form').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';form.elements.period_start.value=week.start;form.elements.period_end.value=week.end;document.querySelector('#referral-form-title').textContent='Referans kaydı ekle';document.querySelector('#referral-save').textContent='Kaydet';document.querySelector('#referral-form-card').classList.toggle('hidden');});
  document.querySelector('#cancel-referral').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';document.querySelector('#referral-form-title').textContent='Referans kaydı ekle';document.querySelector('#referral-save').textContent='Kaydet';document.querySelector('#referral-form-card').classList.add('hidden');});
  form.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(form);if(f.get('period_end')<f.get('period_start'))return msg('Hafta bitişi başlangıç tarihinden önce olamaz.',true);if(!isMondayToSunday(f.get('period_start'),f.get('period_end')))return msg('Referans haftası pazartesi başlamalı ve pazar bitmeli.',true);const recordId=f.get('record_id');const payload={platform_id:f.get('platform_id'),period_start:f.get('period_start'),period_end:f.get('period_end'),referred_creator_id:String(f.get('referred_creator_id')).trim(),referred_creator_phone:String(f.get('referred_creator_phone')).trim(),referrer_name:String(f.get('referrer_name')).trim(),referrer_phone:String(f.get('referrer_phone')).trim(),submitted_by:recordId?records.find(r=>r.id===recordId)?.submitted_by||profile.id:profile.id,updated_at:new Date().toISOString()};const result=recordId?await db.from('referral_entries').update(payload).eq('id',recordId):await db.from('referral_entries').insert(payload);if(result.error)return msg(result.error.message,true);msg(recordId?'Referans kaydı güncellendi.':'Referans kaydı eklendi.');await renderReferrals({start:document.querySelector('#referral-filter-start').value,end:document.querySelector('#referral-filter-end').value,platform:document.querySelector('#referral-filter-platform').value});});
  page.querySelectorAll('[data-edit-referral]').forEach(button=>button.addEventListener('click',()=>{const record=records.find(r=>r.id===button.dataset.editReferral);if(!record)return;for(const key of ['record_id','platform_id','period_start','period_end','referred_creator_id','referred_creator_phone','referrer_name','referrer_phone'])form.elements[key].value=key==='record_id'?record.id:record[key]||'';document.querySelector('#referral-form-title').textContent='Referans kaydını düzenle';document.querySelector('#referral-save').textContent='Değişiklikleri kaydet';document.querySelector('#referral-form-card').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  page.querySelectorAll('[data-delete-referral]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu referans kaydını silmek istiyor musun?'))return;const {error:deleteError}=await db.from('referral_entries').delete().eq('id',button.dataset.deleteReferral);if(deleteError)return msg(deleteError.message,true);msg('Referans kaydı silindi.');await renderReferrals({start:document.querySelector('#referral-filter-start').value,end:document.querySelector('#referral-filter-end').value,platform:document.querySelector('#referral-filter-platform').value});}));
}

async function renderPkEvents(filters={}) {
  const isManager=['admin','consultant'].includes(profile.role);
  const allowedPlatforms=profile.role==='consultant'
    ? await (async()=>{const {data,error}=await db.from('consultant_platforms').select('platform_id').eq('user_id',profile.id);if(error)throw error;const ids=new Set((data||[]).map(x=>x.platform_id));return platforms.filter(p=>ids.has(p.id));})().catch(error=>{page.innerHTML=titleBlock('PK Takip','Sunucu programları ve afişleri.')+`<div class="empty">${esc(error.message)}</div>`;return null;})
    : platforms.filter(p=>p.status==='active');
  if(!allowedPlatforms)return;
  const dateStart=filters.start||shiftedLocalDate(-90);
  const dateEnd=filters.end||shiftedLocalDate(60);
  const selectedPlatform=filters.platform||'all';
  let query=db.from('pk_events').select('*,platforms(name)').gte('event_date',dateStart).lte('event_date',dateEnd).order('event_date',{ascending:true}).order('event_time',{ascending:true}).limit(1000);
  if(selectedPlatform!=='all')query=query.eq('platform_id',selectedPlatform);
  const {data,error}=await query;
  if(error)return page.innerHTML=titleBlock('PK Takip','Sunucu programları ve afişleri.')+`<div class="empty">${esc(error.message)}<br>PK Takip SQL güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  const events=data||[];
  const statusLabel={pending:'Onay bekliyor',approved:'Onaylandı',rejected:'Reddedildi',not_required:'Takip kodu / onay gerekmiyor'};
  const presentationLabel={not_started:'Henüz işaretlenmedi',performed:'Sunuldu',not_performed:'Sunulmadı'};
  const posterLinks=new Map();
  await Promise.all(events.filter(e=>e.poster_path).map(async event=>{const {data:signed}=await db.storage.from('pk-posters').createSignedUrl(event.poster_path,300);if(signed?.signedUrl)posterLinks.set(event.id,signed.signedUrl);}));
  const rows=events.map(event=>{
    const poster=posterLinks.get(event.id);
    const outcome=profile.role==='host'
      ? `<div class="payment-actions"><select data-pk-outcome="${event.id}" aria-label="PK sunum durumu"><option value="" ${!event.presentation_status||event.presentation_status==='not_started'?'selected':''}>Durum seç</option><option value="performed" ${event.presentation_status==='performed'?'selected':''}>Sunuldu</option><option value="not_performed" ${event.presentation_status==='not_performed'?'selected':''}>Sunulmadı</option></select><button class="button" data-save-pk-status="${event.id}">Durumu kaydet</button></div>`
      : `<span class="pill ${event.presentation_status==='performed'?'':event.presentation_status==='not_performed'?'review':'review'}">${esc(presentationLabel[event.presentation_status]||presentationLabel.not_started)}</span>`;
    return `<tr><td>${poster?`<a href="${esc(poster)}" target="_blank" rel="noopener"><img class="pk-poster-thumb" src="${esc(poster)}" alt="${esc(event.event_name)} PK afişi"></a>`:'Afiş yok'}</td><td>${esc(event.event_name)}</td><td>${esc(event.platforms?.name||'—')}</td><td>${niceDate(event.event_date)} · ${esc(String(event.event_time).slice(0,5))}</td><td>${(event.host_names||[]).map(esc).join(', ')||'—'}</td><td>${esc(event.tracking_code||'—')}</td><td><span class="pill ${event.approval_status==='approved'?'':'review'}">${esc(statusLabel[event.approval_status]||event.approval_status)}</span></td><td>${outcome}</td><td>${esc(event.notes||'—')}</td>${isManager?`<td><div class="payment-actions"><button class="button" data-edit-pk="${event.id}">Düzenle</button>${profile.role==='admin'?`<button class="button" data-delete-pk="${event.id}">Sil</button>`:''}</div></td>`:''}</tr>`;
  });
  const platformFilter=`<option value="all">Tüm uygulamalar</option>${allowedPlatforms.map(p=>`<option value="${p.id}" ${selectedPlatform===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}`;
  page.innerHTML=`${titleBlock('PK Takip',profile.role==='host'?'Sana atanmış PK programlarını, afişleri ve onay durumlarını gör.':'Uygulama, sunucu ve tarihe göre PK programlarını takip et.',isManager?'<button class="button primary" id="toggle-pk-form">＋ PK ekle</button>':'')}
    <article class="card"><div class="form-grid referral-filters"><label class="field">Uygulama<select id="pk-filter-platform">${platformFilter}</select></label><label class="field">Başlangıç<input id="pk-filter-start" type="date" value="${esc(dateStart)}"></label><label class="field">Bitiş<input id="pk-filter-end" type="date" value="${esc(dateEnd)}"></label><div class="form-actions"><button class="button primary" id="apply-pk-filters">Filtrele</button><span class="pill">${events.length} PK</span></div></div></article>
    ${isManager?`<article id="pk-form-card" class="card hidden"><h2 id="pk-form-title">PK ekle</h2><form id="pk-form" class="form-grid"><input type="hidden" name="record_id"><label class="field">Uygulama<select name="platform_id" required>${allowedPlatforms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">PK adı<input name="event_name" required maxlength="180"></label><label class="field">Tarih<input name="event_date" type="date" required></label><label class="field">Saat<input name="event_time" type="time" required></label><label class="field">Takip kodu (varsa)<input name="tracking_code" maxlength="120" placeholder="Örn. EVT-... · zorunlu değil"></label><label class="field">Afiş (JPG, PNG, WEBP veya GIF)<input name="poster" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label class="field">Afiş onay durumu<select name="approval_status"><option value="pending">Onay bekliyor</option><option value="approved">Onaylandı</option><option value="rejected">Reddedildi</option><option value="not_required">Takip kodu / onay gerekmiyor</option></select></label><label class="field full">Sunucu(lar)<div id="pk-host-options" class="platform-checks"><span class="small">Önce uygulama seç.</span></div><small class="small">Sunucuları önce Kullanıcı Yönetimi'nden oluşturup Çalışan Ödeme Tablosu'nda bu uygulamayla eşleştir.</small></label><label class="field full">Not (isteğe bağlı)<textarea name="notes" rows="2" maxlength="1000"></textarea></label><div class="form-actions full"><button class="button primary" id="pk-save">Kaydet</button><button class="button" type="button" id="cancel-pk">Vazgeç</button></div></form></article>`:''}
    <article class="card">${table(['Afiş','PK adı','Uygulama','Tarih / saat','Sunucu(lar)','EVT takip kodu','Afiş onayı','Sunum durumu','Not',...(isManager?['İşlem']:[])],rows,'Bu tarih aralığında PK programı yok.')}</article>`;
  document.querySelector('#apply-pk-filters').addEventListener('click',()=>renderPkEvents({platform:document.querySelector('#pk-filter-platform').value,start:document.querySelector('#pk-filter-start').value,end:document.querySelector('#pk-filter-end').value}));
  page.querySelectorAll('[data-save-pk-status]').forEach(button=>button.addEventListener('click',async()=>{const status=page.querySelector(`[data-pk-outcome="${button.dataset.savePkStatus}"]`)?.value;if(!status)return msg('Sunum durumunu seç.',true);button.disabled=true;const {error:saveError}=await db.rpc('pk_mark_presentation',{p_event_id:button.dataset.savePkStatus,p_status:status});if(saveError){button.disabled=false;return msg(saveError.message,true);}msg('PK sunum durumu kaydedildi.');await renderPkEvents({platform:document.querySelector('#pk-filter-platform').value,start:document.querySelector('#pk-filter-start').value,end:document.querySelector('#pk-filter-end').value});}));
  if(!isManager)return;
  const form=document.querySelector('#pk-form'),hostBox=document.querySelector('#pk-host-options');
  let selectedHostSnapshot=[];
  const loadHostChoices=async(platformId,selectedIds=[],savedNames=[])=>{hostBox.innerHTML='<span class="small">Sunucular yükleniyor…</span>';const {data,error:hostError}=await db.rpc('pk_hosts_for_platform',{p_platform_id:platformId});if(hostError){hostBox.innerHTML=`<span class="small">Sunucular alınamadı: ${esc(hostError.message)}</span>`;return;}const hosts=data||[];const known=new Set(hosts.map(h=>h.profile_id));selectedIds.forEach((id,index)=>{if(!known.has(id)&&savedNames[index])hosts.push({profile_id:id,display_label:savedNames[index],saved:true});});hostBox.innerHTML=hosts.map(host=>`<label class="platform-check"><input type="checkbox" name="host_profile_ids" value="${host.profile_id}" data-name="${esc(host.display_label)}" ${selectedIds.includes(host.profile_id)?'checked':''}><span>${esc(host.display_label)}${host.saved?' · önceki atama':''}</span></label>`).join('')||'<span class="small">Bu uygulamayla eşleştirilmiş sunucu hesabı yok.</span>';};
  form.elements.platform_id.addEventListener('change',()=>{selectedHostSnapshot=[];loadHostChoices(form.elements.platform_id.value);});
  document.querySelector('#toggle-pk-form').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';form.elements.event_date.value=today();form.elements.approval_status.value='pending';selectedHostSnapshot=[];document.querySelector('#pk-form-title').textContent='PK ekle';document.querySelector('#pk-save').textContent='Kaydet';document.querySelector('#pk-form-card').classList.toggle('hidden');loadHostChoices(form.elements.platform_id.value);});
  document.querySelector('#cancel-pk').addEventListener('click',()=>{form.reset();form.elements.record_id.value='';document.querySelector('#pk-form-title').textContent='PK ekle';document.querySelector('#pk-save').textContent='Kaydet';document.querySelector('#pk-form-card').classList.add('hidden');});
  form.addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(form),recordId=f.get('record_id'),file=f.get('poster'),hostInputs=[...hostBox.querySelectorAll('input[name="host_profile_ids"]:checked')];if(!hostInputs.length)return msg('En az bir sunucu seç.',true);if(file instanceof File&&file.size>20971520)return msg('Afiş dosyası 20 MB sınırını aşmamalı.',true);const hostIds=hostInputs.map(input=>input.value),hostNames=hostInputs.map(input=>input.dataset.name);const payload={platform_id:f.get('platform_id'),event_name:String(f.get('event_name')).trim(),event_date:f.get('event_date'),event_time:f.get('event_time'),tracking_code:String(f.get('tracking_code')||'').trim()||null,approval_status:f.get('approval_status'),host_profile_ids:hostIds,host_names:hostNames,notes:String(f.get('notes')||'').trim()||null,updated_at:new Date().toISOString()};let eventId=recordId,oldPath=events.find(x=>x.id===recordId)?.poster_path||null;if(recordId){const {error:saveError}=await db.from('pk_events').update(payload).eq('id',recordId);if(saveError)return msg(saveError.message,true);}else{const {data:createdId,error:createError}=await db.rpc('pk_create_event',{p_platform_id:payload.platform_id,p_event_name:payload.event_name,p_event_date:payload.event_date,p_event_time:payload.event_time,p_tracking_code:payload.tracking_code,p_approval_status:payload.approval_status,p_host_profile_ids:hostIds,p_host_names:hostNames,p_notes:payload.notes});if(createError)return msg(createError.message,true);eventId=createdId;}let newPath=oldPath;if(file instanceof File&&file.size){const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');newPath=`${eventId}/${crypto.randomUUID()}-${safeName}`;const {error:uploadError}=await db.storage.from('pk-posters').upload(newPath,file,{contentType:file.type,upsert:false});if(uploadError)return msg(`PK kaydı oluşturuldu ancak afiş yüklenemedi: ${uploadError.message}`,true);const {error:pathError}=await db.from('pk_events').update({poster_path:newPath}).eq('id',eventId);if(pathError){await db.storage.from('pk-posters').remove([newPath]);return msg(pathError.message,true);}if(oldPath)await db.storage.from('pk-posters').remove([oldPath]);}msg(recordId?'PK kaydı güncellendi.':'PK kaydı oluşturuldu.');await renderPkEvents({platform:document.querySelector('#pk-filter-platform').value,start:document.querySelector('#pk-filter-start').value,end:document.querySelector('#pk-filter-end').value});});
  page.querySelectorAll('[data-edit-pk]').forEach(button=>button.addEventListener('click',async()=>{const event=events.find(x=>x.id===button.dataset.editPk);if(!event)return;for(const key of ['record_id','platform_id','event_name','event_date','event_time','tracking_code','approval_status','notes'])form.elements[key].value=key==='record_id'?event.id:event[key]||'';selectedHostSnapshot=event.host_names||[];await loadHostChoices(event.platform_id,event.host_profile_ids||[],selectedHostSnapshot);document.querySelector('#pk-form-title').textContent='PK kaydını düzenle';document.querySelector('#pk-save').textContent='Değişiklikleri kaydet';document.querySelector('#pk-form-card').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  page.querySelectorAll('[data-delete-pk]').forEach(button=>button.addEventListener('click',async()=>{const event=events.find(x=>x.id===button.dataset.deletePk);if(!event||!confirm('PK kaydı ve afişi silinsin mi?'))return;if(event.poster_path){const {error:posterError}=await db.storage.from('pk-posters').remove([event.poster_path]);if(posterError)return msg(posterError.message,true);}const {error:deleteError}=await db.from('pk_events').delete().eq('id',event.id);if(deleteError)return msg(deleteError.message,true);msg('PK kaydı silindi.');await renderPkEvents({platform:document.querySelector('#pk-filter-platform').value,start:document.querySelector('#pk-filter-start').value,end:document.querySelector('#pk-filter-end').value});}));
}

async function renderHostPerformance() {
  const {data,error}=await db.from('pk_events').select('*,platforms(name)').eq('presentation_status','performed').order('event_date',{ascending:false}).order('event_time',{ascending:false}).limit(1000);
  const subtitle=profile.role==='host'?'Yalnızca sunumunu tamamladığın PK kayıtları.':profile.role==='consultant'?'Yetkili olduğun uygulamalardaki sunulmuş PK kayıtları.':'Tüm uygulamalarda sunulmuş PK kayıtları.';
  if(error)return page.innerHTML=titleBlock('Sunucu Performansı',subtitle)+`<div class="empty">${esc(error.message)}<br>Sunum durumu SQL güncellemesi henüz çalıştırılmamış olabilir.</div>`;
  const records=data||[],posterLinks=new Map();
  await Promise.all(records.filter(row=>row.poster_path).map(async row=>{const {data:signed}=await db.storage.from('pk-posters').createSignedUrl(row.poster_path,300);if(signed?.signedUrl)posterLinks.set(row.id,signed.signedUrl);}));
  const rows=records.map(row=>{const poster=posterLinks.get(row.id);return `<tr><td>${poster?`<a href="${esc(poster)}" target="_blank" rel="noopener"><img class="pk-poster-thumb" src="${esc(poster)}" alt="${esc(row.event_name)} PK afişi"></a>`:'Afiş yok'}</td><td>${esc(row.event_name)}</td><td>${esc(row.platforms?.name||'—')}</td><td>${niceDate(row.event_date)} · ${esc(String(row.event_time).slice(0,5))}</td><td>${esc((row.host_names||[]).join(', ')||'—')}</td><td>${esc(row.tracking_code||'—')}</td><td><span class="pill">Sunuldu</span></td></tr>`;});
  page.innerHTML=`${titleBlock('Sunucu Performansı',subtitle)}${cardMetric('Tamamlanan PK',records.length,profile.role==='host'?'Sana atanmış Sunuldu kayıtları':'Görüntüleme yetkindeki Sunuldu kayıtları')}<article class="card">${table(['Afiş','PK adı','Uygulama','Tarih / saat','Sunucu(lar)','EVT takip kodu','Sunum durumu'],rows,'Henüz Sunuldu olarak işaretlenmiş PK kaydı yok.')}</article>`;
}
async function renderUsers() {
  await loadProfiles();
  const {data:assignmentRows,error:assignmentError}=await db.from('consultant_platforms').select('user_id,platform_id');
  if(assignmentError)return page.innerHTML=titleBlock('Kullanıcı Yönetimi','Çalışan ve alt ajans hesaplarını yönet.')+`<div class="empty">${esc(assignmentError.message)}<br>Önce Raporlar güncellemesinin SQL dosyasını çalıştır.</div>`;
  const assignmentMap=new Map();(assignmentRows||[]).forEach(r=>{if(!assignmentMap.has(r.user_id))assignmentMap.set(r.user_id,[]);assignmentMap.get(r.user_id).push(r.platform_id);});
  const rows=profiles.map(p=>`<tr><td><strong>${esc(visibleName(p))}</strong><small class="small">${p.display_name?'Panelde görünen ad':'Ad soyad varsayılanı'}</small></td><td>${esc(p.username)}</td><td>${esc(p.email)}</td><td>${esc(p.phone||'—')}</td><td>${esc(roleName(p.role))}</td><td><span class="pill ${p.active?'':'review'}">${p.active?'Aktif':'Kapalı'}</span></td><td>${['consultant','room_assistant'].includes(p.role)?`<button class="button" data-assign-platforms="${p.id}">Uygulamaları ata</button> `:''}${p.id!==profile.id?`${p.active?`<button class="button" data-disable="${p.id}">Kapat</button>`:`<button class="button" data-activate="${p.id}">Aç</button>`} <button class="button" data-reset="${p.id}">Parola yenile</button> `:''}<button class="button" data-edit-display-name="${p.id}">Görünen adı düzenle</button></td></tr>`);
  page.innerHTML=`${titleBlock('Kullanıcı Yönetimi','Çalışan ve alt ajans hesaplarını yalnızca sen yönetebilirsin.','<button class="button primary" id="toggle-form">＋ Kullanıcı oluştur</button>')}
    <article id="assignment-box" class="card hidden"><h2 id="assignment-title">Uygulama yetkileri</h2><p>Atanan uygulamaların raporları ve operasyon kayıtları bu hesaba açılır.</p><div id="assigned-platforms" class="platform-checks"></div><div class="form-actions"><button class="button primary" id="save-platform-assignment">Yetkileri kaydet</button><button class="button" type="button" id="cancel-platform-assignment">Vazgeç</button></div></article>
    <article id="create-box" class="card hidden"><h2>Yeni hesap</h2><p>Geçici parolayı güvenli biçimde çalışana ilet. İlk girişte parola değişimi zorunlu olur.</p><form id="user-form" class="form-grid"><label class="field">Gerçek ad soyad<input name="full_name" required></label><label class="field">Telefon<input name="phone" type="tel"></label><label class="field">E-posta<input name="email" type="email" required></label><label class="field">Kullanıcı adı<input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+"></label><label class="field">Rol<select name="role"><option value="assistant">Asistan / Kayıtçı</option><option value="room_assistant">Oda Asistanı</option><option value="consultant">Danışman</option><option value="host">Sunucu</option><option value="subagency_owner">Alt ajans sahibi</option></select></label><label id="agency-field" class="field hidden">Ajans adı<input name="agency_name"></label><label class="field full">İlk giriş parolası<input name="password" type="password" minlength="12" autocomplete="new-password" required><small class="small">En az 12 karakter. İlk girişte değiştirilmesi istenir.</small></label><div class="form-actions full"><button class="button primary">Hesap oluştur</button><button class="button" type="button" id="cancel-form">Vazgeç</button></div></form></article>
    <article class="card">${table(['Panelde görünen ad','Kullanıcı adı','E-posta','Telefon','Rol','Hesap','İşlem'],rows,'Henüz personel hesabı yok.')}</article>`;
  wireFormToggle();
  const roleSelect=document.querySelector('#user-form [name="role"]');
  roleSelect.addEventListener('change',()=>document.querySelector('#agency-field').classList.toggle('hidden',roleSelect.value!=='subagency_owner'));
  document.querySelector('#user-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={action:'create',full_name:f.get('full_name'),phone:f.get('phone'),email:f.get('email'),username:f.get('username'),password:f.get('password'),role:f.get('role'),agency_name:f.get('agency_name')};const result=await invoke('manage-users',payload);if(!result.ok)return msg(result.error||'Hesap açılamadı.',true);msg(`Hesap oluşturuldu. Kullanıcı adı: ${result.username}`);await renderUsers();});
  page.querySelectorAll('[data-edit-display-name]').forEach(button=>button.addEventListener('click',async()=>{const person=profiles.find(p=>p.id===button.dataset.editDisplayName);if(!person)return;const value=prompt('Bu hesap için panelde görünecek adı yaz. Boş bırakırsan gerçek ad-soyad görünür.',person.display_name||person.full_name);if(value===null)return;const displayName=value.trim();if(displayName.length>80)return msg('Görünen ad en fazla 80 karakter olabilir.',true);const {error}=await db.from('profiles').update({display_name:displayName||null}).eq('id',person.id);if(error)return msg(error.message,true);msg('Panelde görünen ad güncellendi.');await renderUsers();if(person.id===profile.id){profile.display_name=displayName||null;document.querySelector('#user-name').textContent=visibleName(profile);document.querySelector('#user-avatar').textContent=visibleName(profile).split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();}}));
  let assignmentUserId='';
  page.querySelectorAll('[data-assign-platforms]').forEach(button=>button.addEventListener('click',()=>{assignmentUserId=button.dataset.assignPlatforms;const person=profiles.find(p=>p.id===assignmentUserId);document.querySelector('#assignment-title').textContent=`${visibleName(person)||roleName(person.role)} · Uygulama yetkileri`;const assigned=new Set(assignmentMap.get(assignmentUserId)||[]);document.querySelector('#assigned-platforms').innerHTML=platforms.map(p=>`<label class="platform-check"><input type="checkbox" value="${p.id}" ${assigned.has(p.id)?'checked':''}><span>${esc(p.name)}</span></label>`).join('')||'<div class="empty">Uygulama bulunamadı.</div>';document.querySelector('#assignment-box').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}));
  document.querySelector('#cancel-platform-assignment').addEventListener('click',()=>document.querySelector('#assignment-box').classList.add('hidden'));
  document.querySelector('#save-platform-assignment').addEventListener('click',async event=>{if(!assignmentUserId)return;const button=event.currentTarget;button.disabled=true;const selected=[...document.querySelectorAll('#assigned-platforms input:checked')].map(x=>x.value);const current=assignmentMap.get(assignmentUserId)||[];const added=selected.filter(id=>!current.includes(id));const removed=current.filter(id=>!selected.includes(id));if(added.length){const {error}=await db.from('consultant_platforms').insert(added.map(platform_id=>({user_id:assignmentUserId,platform_id,assigned_by:profile.id})));if(error){button.disabled=false;return msg(error.message,true);}}if(removed.length){const {error}=await db.from('consultant_platforms').delete().eq('user_id',assignmentUserId).in('platform_id',removed);if(error){button.disabled=false;return msg(error.message,true);}}msg('Danışmanın uygulama yetkileri güncellendi.');await renderUsers();});
  page.querySelectorAll('[data-disable]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu kişinin panel erişimini kapatmak istiyor musun?'))return;const result=await invoke('manage-users',{action:'deactivate',user_id:button.dataset.disable});if(!result.ok)return msg(result.error||'Erişim kapatılamadı.',true);msg('Hesap erişimi kapatıldı.');renderUsers();}));
  page.querySelectorAll('[data-activate]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Bu kişinin panel erişimini yeniden açmak istiyor musun?'))return;const result=await invoke('manage-users',{action:'activate',user_id:button.dataset.activate});if(!result.ok)return msg(result.error||'Hesap açılamadı.',true);msg('Hesap yeniden açıldı.');renderUsers();}));
  page.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',async()=>{const password=prompt('En az 12 karakterlik yeni geçici parolayı gir:');if(!password)return;if(password.length<12)return msg('Parola en az 12 karakter olmalı.',true);const result=await invoke('manage-users',{action:'reset_password',user_id:button.dataset.reset,password});if(!result.ok)return msg(result.error||'Parola değiştirilemedi.',true);msg('Parola yenilendi. Yeni geçici parolayı personele güvenli yoldan ilet.');}));
}

async function renderPlatform(platform) {
  const [{data:reports},{data:perf}] = await Promise.all([
    db.from('platform_reports').select('id').eq('platform_id',platform.id),
    db.from('performance_entries').select('revenue_contribution,currency').eq('platform_id',platform.id),
  ]);
  const revenue={};(perf||[]).forEach(p=>revenue[p.currency]=(revenue[p.currency]||0)+Number(p.revenue_contribution));
  const revenueLabel=Object.keys(revenue).length?Object.entries(revenue).map(([c,v])=>`${c}: ${money(v,c)}`).join(' · '):'Henüz ciro katkısı yok';
  page.innerHTML=`${titleBlock(platform.name,'Bu uygulamanın erişebildiğin rapor ve performans özeti.')}<div class="cards">${cardMetric('Uygulama durumu',statusName(platform.status),'Yönetici tarafından yönetilir')}${cardMetric('Erişebildiğin raporlar',(reports||[]).length,'Raporlar bölümünde görüntülenir')}${cardMetric('Ciro katkısı',revenueLabel,'Yetkili performans kayıtlarından')}</div><article class="card"><h2>Uygulama raporları</h2><p>Günlük ve haftalık dosyaları Raporlar bölümünden uygulamaya göre filtreleyebilirsin.</p><button class="button" data-open="reports">Raporlar bölümüne git</button></article>`;
  page.querySelector('[data-open="reports"]')?.addEventListener('click',()=>openPage('reports'));
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
const sidebar=document.querySelector('#sidebar');
const menuBackdrop=document.querySelector('#menu-backdrop');
function closeMenu(){sidebar.classList.remove('open');menuBackdrop?.classList.remove('open');}
document.querySelector('#menu-toggle').addEventListener('click',()=>{const opened=sidebar.classList.toggle('open');menuBackdrop?.classList.toggle('open',opened);});
menuBackdrop?.addEventListener('click',closeMenu);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
document.querySelector('#theme-toggle').addEventListener('click',event=>{
  const light=document.querySelector('#login').classList.toggle('light');
  event.currentTarget.querySelector('span').textContent=light?'Koyu':'Açık';
  event.currentTarget.setAttribute('aria-label',light?'Koyu temaya geç':'Açık temaya geç');
});
