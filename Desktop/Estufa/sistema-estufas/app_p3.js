
// ============================================================
// AUTH
// ============================================================
async function tryLoadConfig() {
  if (typeof supabase === 'undefined') return false;
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem('estufas_supabase_cfg') || 'null'); } catch(e) {}
  if (cfg && cfg.url && cfg.key) {
    try {
      STATE.supa = supabase.createClient(cfg.url, cfg.key);
      const { data: { session } } = await STATE.supa.auth.getSession();
      if (session) {
        STATE.mode = 'supabase';
        STATE.user = session.user;
        const { data: profile } = await STATE.supa.from('user_profiles').select('*').eq('id', session.user.id).maybeSingle();
        STATE.role = profile?.role || 'viewer';
        return true;
      }
    } catch(e) { console.error(e); }
  }
  return false;
}

async function doLogin(email, pass) {
  if (STATE.mode === 'supabase' && STATE.supa) {
    const { data, error } = await STATE.supa.auth.signInWithPassword({ email, password:pass });
    if (error) throw error;
    STATE.user = data.user;
    const { data: profile } = await STATE.supa.from('user_profiles').select('*').eq('id', data.user.id).maybeSingle();
    STATE.role = profile?.role || 'viewer';
    return;
  }
  const users = JSON.parse(localStorage.getItem('estufas_demo_users') || '[]');
  const u = users.find(x => x.email === email && x.pass === pass);
  if (!u && users.length > 0) throw new Error('Email ou senha incorretos');
  if (users.length === 0) {
    users.push({ email, pass, role:'admin', nome:email });
    localStorage.setItem('estufas_demo_users', JSON.stringify(users));
    STATE.user = { email }; STATE.role = 'admin';
  } else {
    STATE.user = { email:u.email }; STATE.role = u.role;
  }
}

async function doSignup(email, pass) {
  if (STATE.mode === 'supabase' && STATE.supa) {
    const { error } = await STATE.supa.auth.signUp({ email, password:pass });
    if (error) throw error;
    toast('Conta criada. Verifique seu email e faça login.', 'success');
    return;
  }
  const users = JSON.parse(localStorage.getItem('estufas_demo_users') || '[]');
  if (users.find(x => x.email === email)) throw new Error('Email já existe');
  const role = users.length === 0 ? 'admin' : 'viewer';
  users.push({ email, pass, role, nome:email });
  localStorage.setItem('estufas_demo_users', JSON.stringify(users));
  toast('Conta criada (' + role + '). Faça login.', 'success');
}

async function doLogout() {
  if (STATE.mode === 'supabase' && STATE.supa) await STATE.supa.auth.signOut();
  STATE.user = null;
  showLogin();
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#cfgScreen').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
  $('#modeLabel').textContent = STATE.mode === 'supabase' ? 'Modo Online (Supabase)' : 'Modo Demo (local)';
}

async function enterApp() {
  $('#loginScreen').classList.add('hidden');
  $('#cfgScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userInfo').textContent = STATE.user.email;
  $('#roleBadge').textContent = STATE.role.toUpperCase();
  $('#roleBadge').className = 'badge ' + (STATE.role === 'admin' ? 'bg-yellow-400 text-yellow-900' : 'bg-blue-400 text-blue-900');
  await DB.loadAll();
  setView('dashboard');
}

function setView(view) {
  STATE.view = view;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const fn = VIEWS[view];
  if (fn) fn();
}

function getRefMes() {
  const v = STATE.refMes || (() => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();
  STATE.refMes = v;
  const [a,m] = v.split('-').map(Number);
  return { ano:a, mes:m, val:v };
}
function selectorMes(onChange='renderizar()') {
  const r = getRefMes();
  return '<input type="month" value="'+r.val+'" onchange="STATE.refMes=this.value;'+onChange+'" class="px-3 py-2 border rounded text-sm">';
}

var VIEWS = {};
