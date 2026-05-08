
// ============================================================
// BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const ok = await tryLoadConfig();
    if (ok) await enterApp(); else showLogin();
  } catch (e) {
    console.error('Bootstrap:', e);
    try { showLogin(); } catch(e2) {
      document.body.innerHTML = '<div style="padding:20px"><h2>Erro ao iniciar</h2><pre style="background:#fee;padding:10px;color:#900;font-size:12px">'+(e.stack||e.message)+'</pre></div>';
    }
  }
});

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginErr').classList.add('hidden');
  try { await doLogin($('#loginEmail').value, $('#loginPass').value); enterApp(); }
  catch (err) { $('#loginErr').textContent = err.message; $('#loginErr').classList.remove('hidden'); }
});

$('#signupBtn').addEventListener('click', async () => {
  $('#loginErr').classList.add('hidden');
  try {
    if (!$('#loginEmail').value || $('#loginPass').value.length < 6) throw new Error('Email + senha (mín 6 chars)');
    await doSignup($('#loginEmail').value, $('#loginPass').value);
  } catch (err) { $('#loginErr').textContent = err.message; $('#loginErr').classList.remove('hidden'); }
});

$('#logoutBtn').addEventListener('click', doLogout);

$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('Recarregar TODOS os dados da planilha?')) return;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('estufas_demo_v')) localStorage.removeItem(k);
  }
  toast('Recarregando...', 'success');
  setTimeout(() => location.reload(), 600);
});

$('#cfgBtn').addEventListener('click', () => {
  $('#loginScreen').classList.add('hidden');
  $('#cfgScreen').classList.remove('hidden');
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('estufas_supabase_cfg') || '{}'); } catch(e) {}
  $('#cfgUrl').value = cfg.url || '';
  $('#cfgKey').value = cfg.key || '';
});

$('#cfgSave').addEventListener('click', () => {
  const url = $('#cfgUrl').value.trim(), key = $('#cfgKey').value.trim();
  if (!url || !key) { toast('Preencha URL e key', 'error'); return; }
  if (typeof supabase === 'undefined') { toast('Supabase não carregou', 'error'); return; }
  localStorage.setItem('estufas_supabase_cfg', JSON.stringify({ url, key }));
  STATE.supa = supabase.createClient(url, key);
  STATE.mode = 'supabase';
  toast('Conectado. Faça login.', 'success');
  showLogin();
});

$('#cfgClear').addEventListener('click', () => {
  localStorage.removeItem('estufas_supabase_cfg');
  STATE.mode = 'demo'; STATE.supa = null;
  showLogin();
});

$$('.nav-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('hidden'));

}  // fim do guard __ESTUFAS_LOADED__
