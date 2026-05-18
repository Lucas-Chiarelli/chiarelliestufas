// ============================================================
// SISTEMA DE GESTAO DE ESTUFAS
// ============================================================
(function(){
if (window.__ESTUFAS_LOADED__) { console.warn('app.js carregado 2x'); return; }
window.__ESTUFAS_LOADED__ = true;

window.addEventListener('error', e => {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:#fee;border:2px solid #c00;padding:12px;font:12px monospace;color:#900;z-index:9999;border-radius:8px;max-height:200px;overflow:auto';
  div.innerHTML = '<b>Erro JS:</b> ' + (e.message || e.error?.message) + '<br>' + (e.filename||'') + ':' + (e.lineno||'');
  document.body.appendChild(div);
});

var STATE = { mode:'demo', supa:null, user:null, role:'admin', data:null, view:'dashboard' };
window.STATE = STATE;  // expor pra onclick/onchange inline
var SITIO_LABEL = { sao_jose:'São José', bela_vista:'Bela Vista', santo_antonio:'Santo Antônio' };

var DB = {
  _key: 'estufas_demo_v6',
  async loadAll() {
    if (STATE.mode === 'demo') {
      let raw = localStorage.getItem(this._key);
      let useSeed = !raw;
      if (raw && window.DEMO_SEED) {
        try {
          const cached = JSON.parse(raw);
          const cl = (cached.lotes||[]).length;
          const sl = (window.DEMO_SEED.lotes||[]).length;
          if (Math.abs(cl - sl) / Math.max(sl,1) > 0.2) useSeed = true;
        } catch(e) { useSeed = true; }
      }
      if (useSeed) {
        STATE.data = window.DEMO_SEED ? JSON.parse(JSON.stringify(window.DEMO_SEED)) : emptyData();
        this.persist();
      } else {
        STATE.data = JSON.parse(raw);
      }
      return STATE.data;
    }
    const tabs = ['estufas','funcionarios','bancadas','lotes','precos_sitio','clientes','estoque_movimentos','parcelas_pagas','alertas_exame'];
    STATE.data = {};
    for (const t of tabs) {
      const { data } = await STATE.supa.from(t).select('*');
      STATE.data[t] = data || [];
    }
    return STATE.data;
  },
  persist() { if (STATE.mode === 'demo') localStorage.setItem(this._key, JSON.stringify(STATE.data)); },
  async insert(table, row) {
    if (STATE.mode === 'demo') {
      row.id = row.id || crypto.randomUUID();
      STATE.data[table].push(row);
      this.persist();
      return row;
    }
    const { data } = await STATE.supa.from(table).insert(row).select().single();
    STATE.data[table].push(data);
    return data;
  },
  async update(table, id, patch) {
    if (STATE.mode === 'demo') {
      const i = STATE.data[table].findIndex(r => r.id === id);
      if (i < 0) throw new Error('not found');
      STATE.data[table][i] = { ...STATE.data[table][i], ...patch };
      this.persist();
      return STATE.data[table][i];
    }
    const { data } = await STATE.supa.from(table).update(patch).eq('id', id).select().single();
    const i = STATE.data[table].findIndex(r => r.id === id);
    if (i >= 0) STATE.data[table][i] = data;
    return data;
  },
  async remove(table, id) {
    if (STATE.mode === 'demo') {
      STATE.data[table] = STATE.data[table].filter(r => r.id !== id);
      this.persist();
      return;
    }
    await STATE.supa.from(table).delete().eq('id', id);
    STATE.data[table] = STATE.data[table].filter(r => r.id !== id);
  },
};

function emptyData() {
  return { estufas:[], funcionarios:[], bancadas:[], lotes:[],
    precos_sitio:[
      {id:crypto.randomUUID(),sitio:'sao_jose',valor_total:1.30,valor_final:0.15,vigencia_inicio:'2024-01-01'},
      {id:crypto.randomUUID(),sitio:'bela_vista',valor_total:1.35,valor_final:0.15,vigencia_inicio:'2024-01-01'},
      {id:crypto.randomUUID(),sitio:'santo_antonio',valor_total:1.35,valor_final:0.15,vigencia_inicio:'2024-01-01'}],
    clientes:[], estoque_movimentos:[], parcelas_pagas:[], alertas_exame:[] };
}

// ============================================================
// REGRAS DE NEGOCIO
// ============================================================
function qtdEnxertos(l) { return l.tipo === 'inter_enxerto' ? l.qtd*2 : l.qtd; }
function qtdPortaEnxertos(l) { return l.qtd; }

function getPrecoLote(lote, sitio) {
  const ps = STATE.data.precos_sitio.filter(p => p.sitio === sitio && p.vigencia_inicio <= lote.data_plantio)
    .sort((a,b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio));
  return ps[0] || { valor_total:1.30, valor_final:0.15 };
}

function idadeMeses(dPlantio, ref) {
  const p = new Date(dPlantio), r = new Date(ref);
  let m = (r.getFullYear()-p.getFullYear())*12 + (r.getMonth()-p.getMonth());
  if (r.getDate() < p.getDate()) m--;
  return m;
}

// Regra de pagamento (CORRIGIDA):
//   meses 1..12: parcela mensal = (valor_total - valor_final) / 12 * qtd  (R$ 0,0958/mês São José)
//   mes 13:      paga SOMENTE a retenção = valor_final * qtd  (R$ 0,15/muda)
//   mes 14+:     bancada SAI da folha (não paga mais)
// Exemplo: plantio 01/01/2026 → jan/2026..dez/2026 = parcela; jan/2027 = retenção; fev/2027 = sai
function valorPagamentoLoteMes(lote, ano, mes) {
  const b = byId('bancadas', lote.bancada_id);
  if (!b) return { valor:0, parcela:0, motivo:'sem bancada', valorUnitario:0 };
  const e = byId('estufas', b.estufa_id);
  if (!e) return { valor:0, parcela:0, motivo:'sem estufa', valorUnitario:0 };
  const preco = getPrecoLote(lote, e.sitio);
  const ref = new Date(ano, mes, 0);
  const idd = idadeMeses(lote.data_plantio, ref);
  if (idd < 1) return { valor:0, parcela:idd, motivo:'antes do inicio', valorUnitario:0 };
  const vt = Number(preco.valor_total), vf = Number(preco.valor_final);
  const unit = (vt - vf) / 12;
  const parc = unit * lote.qtd;
  const ret = vf * lote.qtd;
  // 1..12 = parcela mensal normal (sem retenção)
  if (idd <= 12) return { valor:parc, parcela:idd, motivo:'parcela mensal', valorUnitario:unit, valorTotal:vt, valorFinal:vf };
  // 13 = SÓ retenção
  if (idd === 13) return { valor:ret, parcela:13, motivo:'retencao final', valorUnitario:unit, valorTotal:vt, valorFinal:vf };
  // 14+ = sai da folha
  return { valor:0, parcela:idd, motivo:'vencido (>13 meses)', valorUnitario:unit };
}

function calcularPagamentoFuncionario(funcId, ano, mes) {
  const f = byId('funcionarios', funcId);
  if (f && f.tipo === 'salario_fixo' && f.salario_fixo) {
    return { total:Number(f.salario_fixo), detalhes:[], tipoPagamento:'salario_fixo' };
  }
  const lotes = STATE.data.lotes.filter(l => l.funcionario_id === funcId);
  let total = 0;
  const detalhes = [];
  for (const l of lotes) {
    const c = valorPagamentoLoteMes(l, ano, mes);
    if (c.valor > 0) {
      const b = byId('bancadas', l.bancada_id);
      const e = b ? byId('estufas', b.estufa_id) : null;
      detalhes.push({ lote:l, bancada:b, estufa:e, ...c });
      total += c.valor;
    }
  }
  return { total, detalhes, tipoPagamento:'por_muda' };
}

function lotesParaExame() {
  const today = new Date();
  return STATE.data.lotes
    .filter(l => l.data_enxerto)
    .map(l => {
      const dE = new Date(l.data_enxerto);
      return { ...l, diasDesdeEnxerto: Math.floor((today - dE)/86400000) };
    })
    .filter(l => l.diasDesdeEnxerto >= 50);
}

// Vencido = mais de 13 meses (já passou da retenção do mês 13)
function lotesVencidos() {
  const today = new Date();
  return STATE.data.lotes
    .map(l => ({ ...l, idade: idadeMeses(l.data_plantio, today) }))
    .filter(l => l.idade > 13);
}

// Status de bancada: ativa | finalizando(12) | retencao(13) | vencida(>13) | vazia
function statusBancada(bancada) {
  const today = new Date();
  const lotes = STATE.data.lotes.filter(l => l.bancada_id === bancada.id);
  if (lotes.length === 0) return { tipo:'vazia', cor:'bg-gray-100 text-gray-600 border-gray-300', label:'vazia', detalhe:'sem lote cadastrado' };
  const idades = lotes.map(l => idadeMeses(l.data_plantio, today));
  const minIdade = Math.min(...idades);
  const maxIdade = Math.max(...idades);
  if (minIdade > 13) return { tipo:'vencida', cor:'bg-red-100 text-red-800 border-red-300', label:'só vencidos', detalhe:`+${maxIdade}m, replantar` };
  if (minIdade === 13) return { tipo:'retencao', cor:'bg-orange-100 text-orange-800 border-orange-300', label:'retenção', detalhe:`${minIdade}-${maxIdade}m, paga 0,15` };
  if (minIdade === 12) return { tipo:'final', cor:'bg-yellow-100 text-yellow-800 border-yellow-300', label:'última parcela', detalhe:`${minIdade}-${maxIdade}m` };
  return { tipo:'ativa', cor:'bg-green-100 text-green-800 border-green-300', label:'ativa', detalhe:`${minIdade}-${maxIdade}m` };
}

// Lista bancadas vazias (sem produção ativa) - inclui slots não cadastrados
function bancadasVazias() {
  const result = [];
  for (const e of STATE.data.estufas) {
    const existentes = STATE.data.bancadas.filter(b => b.estufa_id === e.id);
    // Bancadas existentes vazias ou só com vencidos
    for (const b of existentes) {
      const s = statusBancada(b);
      if (s.tipo === 'vazia' || s.tipo === 'vencida') {
        result.push({ estufa:e, bancada:b, status:s, slot:false });
      }
    }
    // Slots não cadastrados (1..num_bancadas)
    const numerosCadastrados = new Set(existentes.map(b => b.numero));
    const total = e.num_bancadas || 24;
    for (let i = 1; i <= total; i++) {
      const num = String(i);
      if (!numerosCadastrados.has(num)) {
        result.push({ estufa:e, bancada: {numero:num, _slot:true}, status:{tipo:'vazia', cor:'bg-gray-100 text-gray-600 border-gray-300', label:'slot livre', detalhe:'nunca cadastrada'}, slot:true });
      }
    }
  }
  return result;
}

function nomesMes(m) { return ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][m]; }

// ============================================================
// HELPERS UI
// ============================================================
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => el.querySelectorAll(q);
const byId = (table, id) => STATE.data[table].find(r => r.id === id);
const fmtMoneyExato = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtUnitario = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:8, maximumFractionDigits:8});
const fmtMoney = fmtMoneyExato;
const fmtDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString('pt-BR') : '-';
const fmtNum = n => Number(n||0).toLocaleString('pt-BR');
const escapeHtml = s => (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, type='info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'fixed bottom-4 right-4 px-4 py-2 rounded shadow-lg z-50 ' +
    (type==='error' ? 'bg-red-700 text-white' : type==='success' ? 'bg-green-700 text-white' : 'bg-gray-900 text-white');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;
function isAdmin() { return STATE.role === 'admin'; }

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
window.setView = setView;
window.DB = DB;
window.byId = byId;

// ============================================================
// DASHBOARD
// ============================================================
VIEWS.dashboard = function() {
  const today = new Date();
  const ano = today.getFullYear();
  const mes = today.getMonth() + 1;
  const totalLotes = STATE.data.lotes.length;
  const totalMudas = STATE.data.lotes.reduce((s,l)=>s+l.qtd,0);
  const totalEnxertos = STATE.data.lotes.reduce((s,l)=>s+qtdEnxertos(l),0);
  let pagTotal=0, pagFix=0, pagMuda=0;
  for (const f of STATE.data.funcionarios) {
    const c = calcularPagamentoFuncionario(f.id, ano, mes);
    pagTotal += c.total;
    if (c.tipoPagamento==='salario_fixo') pagFix += c.total; else pagMuda += c.total;
  }
  const alertasAtivos = lotesParaExame();
  const venc = lotesVencidos();
  const totMudasVenc = venc.reduce((s,l)=>s+l.qtd,0);
  const porSitio = {};
  for (const e of STATE.data.estufas) porSitio[e.sitio] = porSitio[e.sitio] || 0;
  for (const l of STATE.data.lotes) {
    const b = byId('bancadas', l.bancada_id);
    const e = b ? byId('estufas', b.estufa_id) : null;
    if (e) porSitio[e.sitio] = (porSitio[e.sitio]||0) + l.qtd;
  }

  $('#content').innerHTML = `
    <div class="flex flex-wrap items-baseline justify-between mb-1">
      <h2 class="text-2xl font-bold">Dashboard</h2>
      <p class="text-sm text-gray-500">${today.toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}</p>
    </div>
    <p class="text-sm text-gray-500 mb-4">Visão geral · ${nomesMes(mes)}/${ano}</p>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Porta-enxertos</div><div class="text-2xl font-bold text-green-700">${fmtNum(totalMudas)}</div><div class="text-xs text-gray-400 mt-1">em ${totalLotes} lotes</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Enxertos</div><div class="text-2xl font-bold text-emerald-700">${fmtNum(totalEnxertos)}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">A pagar este mês</div><div class="text-2xl font-bold text-blue-700">${fmtMoneyExato(pagTotal)}</div><div class="text-xs text-gray-400 mt-1">${fmtMoneyExato(pagMuda)} muda + ${fmtMoneyExato(pagFix)} fixo</div></div>
      <div class="bg-white p-4 rounded-xl shadow cursor-pointer hover:bg-red-50" onclick="setView('vencidos')"><div class="text-xs text-gray-500 uppercase">Bancadas vencidas</div><div class="text-2xl font-bold text-red-700">${venc.length}</div><div class="text-xs text-gray-400 mt-1">${fmtNum(totMudasVenc)} mudas (>13m)</div></div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-2 gap-3 mb-4">
      <div class="bg-white p-4 rounded-xl shadow cursor-pointer hover:bg-blue-50" onclick="setView('vazias')">
        <div class="text-xs text-gray-500 uppercase">📭 Bancadas vazias</div>
        <div class="text-2xl font-bold text-blue-700">${bancadasVazias().length}</div>
        <div class="text-xs text-gray-400 mt-1">precisam de plantio — clique para ver</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-xs text-gray-500 uppercase">⏰ Alertas exame</div>
        <div class="text-2xl font-bold text-orange-700">${alertasAtivos.length}</div>
        <div class="text-xs text-gray-400 mt-1">lotes com >50d do enxerto</div>
      </div>
    </div>

    <div class="grid md:grid-cols-3 gap-4 mb-4">
      <div class="bg-white p-4 rounded-xl shadow md:col-span-2">
        <h3 class="font-bold mb-2">Por sítio</h3>
        ${Object.entries(porSitio).map(([s,q]) => {
          const max = Math.max(...Object.values(porSitio), 1);
          return `<div class="mb-2"><div class="flex justify-between text-sm mb-1"><span>${SITIO_LABEL[s]||s}</span><span class="font-bold">${fmtNum(q)} mudas</span></div><div class="bg-gray-100 rounded h-2"><div class="bg-green-600 h-full rounded" style="width:${(q/max*100).toFixed(1)}%"></div></div></div>`;
        }).join('')}
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <h3 class="font-bold mb-2">⏰ Alertas de exame</h3>
        ${alertasAtivos.length === 0
          ? '<p class="text-sm text-gray-500">Nenhum lote pendente.</p>'
          : '<div class="space-y-1 text-sm">' + alertasAtivos.slice(0,5).map(a => {
              const b = byId('bancadas', a.bancada_id);
              const e = b ? byId('estufas', b.estufa_id) : null;
              return `<div class="flex justify-between border-b py-1"><span><b>${e?.nome||'?'}</b> · BC ${b?.numero||'?'}</span><span class="text-orange-700 font-bold">${a.diasDesdeEnxerto}d</span></div>`;
            }).join('') + '</div>'}
      </div>
    </div>

    <div class="bg-white p-4 rounded-xl shadow">
      <div class="flex items-baseline justify-between mb-2">
        <h3 class="font-bold">💰 Pagamentos — ${nomesMes(mes)}/${ano}</h3>
        <button onclick="setView('pag_resumo')" class="text-sm text-blue-700 hover:underline">Ver detalhes →</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="border-b text-left text-xs uppercase text-gray-500">
          <th class="py-2">Funcionário</th><th>Tipo</th><th class="text-right">Mudas</th>
          <th class="text-right">Total</th><th class="text-right no-print">Ações</th>
        </tr></thead>
        <tbody>
          ${STATE.data.funcionarios
            .map(f => ({ f, c: calcularPagamentoFuncionario(f.id, ano, mes) }))
            .sort((a,b) => b.c.total - a.c.total)
            .map(({f,c}) => {
              const mudas = c.detalhes.reduce((s,d)=>s+d.lote.qtd,0);
              return `<tr class="border-b hover:bg-gray-50">
                <td class="py-2 font-medium">${escapeHtml(f.nome)}</td>
                <td><span class="badge ${c.tipoPagamento==='salario_fixo'?'bg-gray-200 text-gray-800':'bg-green-100 text-green-800'}">${c.tipoPagamento==='salario_fixo'?'Fixo':'Por muda'}</span></td>
                <td class="text-right">${fmtNum(mudas)}</td>
                <td class="text-right font-mono">${fmtMoneyExato(c.total)}</td>
                <td class="text-right no-print"><button onclick="STATE.pagFunc='${f.id}';setView('pag_funcionario')" class="text-blue-700 hover:underline text-xs">Ver folha</button></td>
              </tr>`;
            }).join('')}
          <tr class="bg-green-50 font-bold">
            <td class="py-2" colspan="3">TOTAL</td>
            <td class="text-right font-mono text-green-800">${fmtMoneyExato(pagTotal)}</td>
            <td class="no-print"></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
};

// ============================================================
// BANCADAS VAZIAS (sem produção ativa)
// ============================================================
VIEWS.vazias = function() {
  const vazias = bancadasVazias();
  // Agrupar por estufa
  const porE = {};
  for (const v of vazias) {
    const k = v.estufa.id;
    porE[k] = porE[k] || { estufa:v.estufa, items:[] };
    porE[k].items.push(v);
  }
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">📭 Bancadas vazias</h2>
      ${isAdmin()?'<button onclick="novoLote()" class="bg-green-700 text-white px-4 py-2 rounded">+ Plantar lote</button>':''}
    </div>
    <div class="bg-blue-50 border border-blue-200 p-3 rounded mb-4 text-sm">
      <p><b>${vazias.length} bancadas precisando de plantio.</b></p>
      <p class="text-blue-800 mt-1">Inclui: bancadas com lotes só vencidos (>13m) que precisam ser replantadas + slots cadastrados sem nenhum lote + slots esperados pela estufa (1 até nº de bancadas) que ainda não têm cadastro.</p>
    </div>
    ${Object.values(porE).length === 0 ? '<div class="bg-white p-8 rounded-xl shadow text-center text-gray-500">Nenhuma bancada vazia. Tudo plantado! ✅</div>' :
      Object.values(porE).sort((a,b) => a.estufa.nome.localeCompare(b.estufa.nome)).map(g => `
        <div class="bg-white rounded-xl shadow mb-4 overflow-hidden">
          <div class="p-3 bg-gray-50 border-b">
            <h3 class="font-bold">${escapeHtml(g.estufa.nome)} <span class="text-sm font-normal text-gray-500">${SITIO_LABEL[g.estufa.sitio]||''} · ${g.items.length} vazias</span></h3>
          </div>
          <div class="p-4 flex flex-wrap gap-2">
            ${g.items.sort((a,b) => a.bancada.numero.localeCompare(b.bancada.numero, undefined, {numeric:true})).map(v => `
              <div class="${v.status.cor} border rounded-lg p-3 min-w-[120px]">
                <div class="font-mono font-bold text-lg">BC ${escapeHtml(v.bancada.numero)}</div>
                <div class="text-xs">${v.status.label}</div>
                <div class="text-xs text-gray-500">${v.status.detalhe}</div>
                ${isAdmin() && !v.slot ? `<button onclick="editarBancadaVazia('${v.bancada.id}','${v.estufa.id}')" class="mt-2 w-full text-xs bg-white hover:bg-gray-50 border rounded px-2 py-1">Plantar / Excluir</button>` :
                isAdmin() ? `<button onclick="plantarBancada('${v.estufa.id}','${escapeHtml(v.bancada.numero)}')" class="mt-2 w-full text-xs bg-green-600 text-white rounded px-2 py-1">+ Plantar aqui</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
  `;
};

window.editarBancadaVazia = function(bancadaId, estufaId) {
  const b = byId('bancadas', bancadaId);
  // Mostra todos os lotes (provavelmente vencidos) e oferece opcoes
  const lotes = STATE.data.lotes.filter(l => l.bancada_id === bancadaId);
  openModal(`BC ${b.numero} — ações`, `
    <p class="text-sm text-gray-600 mb-3">${lotes.length===0 ? 'Esta bancada não tem nenhum lote.' : 'Esta bancada tem '+lotes.length+' lote(s) vencido(s):'}</p>
    ${lotes.length > 0 ? `
      <div class="space-y-2 mb-4">
        ${lotes.map(l => {
          const idade = idadeMeses(l.data_plantio, new Date());
          return `<div class="bg-gray-50 p-2 rounded text-sm flex items-center justify-between">
            <div>
              <div class="font-medium">${escapeHtml(l.porta_enxerto||'-')} / ${escapeHtml(l.variedade||'-')}</div>
              <div class="text-xs text-gray-500">${fmtNum(l.qtd)} mudas · plantio ${fmtDate(l.data_plantio)} · ${idade}m</div>
            </div>
            <button onclick="if(confirm('Excluir este lote?')){DB.remove('lotes','${l.id}').then(()=>{closeModal();setView('vazias');})}" class="text-red-700 text-xs hover:underline">excluir</button>
          </div>`;
        }).join('')}
      </div>
    ` : ''}
    <div class="flex justify-end gap-2 pt-2">
      <button onclick="closeModal()" class="px-4 py-2 border rounded">Fechar</button>
      <button onclick="plantarBancada('${estufaId}','${escapeHtml(b.numero)}')" class="px-4 py-2 bg-green-700 text-white rounded">+ Plantar novo lote</button>
    </div>
  `);
};

window.plantarBancada = function(estufaId, numero) {
  closeModal();
  // Pre-fill dados no formLote
  const fake = { qtd:0, tipo:'muda_normal', data_plantio: new Date().toISOString().slice(0,10) };
  formLote(fake);
  // Aguarda modal abrir e preenche
  setTimeout(() => {
    if ($('#lEstufa')) $('#lEstufa').value = estufaId;
    if ($('#lBancada')) $('#lBancada').value = numero;
    rebuildFuncSelect(estufaId, null);
  }, 50);
};

// ============================================================
// VENCIDOS (>13m) - tela com edicao
// ============================================================
VIEWS.vencidos = function() {
  const venc = lotesVencidos();
  const totMudas = venc.reduce((s,l)=>s+l.qtd,0);
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">⚠️ Bancadas vencidas (>13 meses)</h2>
    </div>
    <div class="bg-yellow-50 border border-yellow-200 p-3 rounded mb-4 text-sm">
      <p><b>${venc.length} lotes vencidos · ${fmtNum(totMudas)} mudas.</b></p>
      <p class="text-yellow-800 mt-1">Vencido = passou de 13 meses desde o plantio. Pelo regulamento, não recebe mais pagamento. Você pode editar a data de plantio (caso esteja errada) ou excluir/registrar saída.</p>
    </div>

    ${venc.length === 0 ? '<div class="bg-white p-8 rounded-xl shadow text-center text-gray-500">Nenhum lote vencido. ✅</div>' : `
    <div class="bg-white rounded-xl shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-600">
          <tr>
            <th class="p-2 text-left">Estufa</th>
            <th class="p-2 text-left">BC</th>
            <th class="p-2 text-left">Funcionário</th>
            <th class="p-2 text-left">Porta-enxerto</th>
            <th class="p-2 text-left">Variedade</th>
            <th class="p-2 text-right">Qtd</th>
            <th class="p-2 text-center">Plantio</th>
            <th class="p-2 text-right">Idade</th>
            <th class="p-2 text-center no-print">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${venc.sort((a,b) => b.idade - a.idade).map(l => {
            const b = byId('bancadas', l.bancada_id);
            const e = b ? byId('estufas', b.estufa_id) : null;
            const f = byId('funcionarios', l.funcionario_id);
            return `<tr class="border-t hover:bg-red-50">
              <td class="p-2">${escapeHtml(e?.nome||'?')}</td>
              <td class="p-2 font-mono">${escapeHtml(b?.numero||'?')}</td>
              <td class="p-2">${escapeHtml(f?.nome||'-')}</td>
              <td class="p-2">${escapeHtml(l.porta_enxerto||'-')}</td>
              <td class="p-2">${escapeHtml(l.variedade||'-')}</td>
              <td class="p-2 text-right">${fmtNum(l.qtd)}</td>
              <td class="p-2 text-center">${fmtDate(l.data_plantio)}</td>
              <td class="p-2 text-right text-red-700 font-bold">${l.idade}m</td>
              <td class="p-2 text-center no-print">
                <button onclick="editarLote('${l.id}')" class="text-blue-700 hover:underline text-xs">editar</button>
                · <button onclick="novaSaida('${l.id}')" class="text-green-700 hover:underline text-xs">saída</button>
                · <button onclick="deletarLote('${l.id}')" class="text-red-700 hover:underline text-xs">excluir</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`}
  `;
};

// ============================================================
// LOTES
// ============================================================
VIEWS.lotes = function() {
  const lotes = STATE.data.lotes.slice().sort((a,b) => b.data_plantio.localeCompare(a.data_plantio));
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">Lotes / Plantios</h2>
      ${isAdmin()?'<button onclick="novoLote()" class="bg-green-700 text-white px-4 py-2 rounded">+ Novo lote</button>':''}
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50">
          <tr class="text-left">
            <th class="p-2">Estufa</th><th>BC</th><th>Qtd</th><th>Porta-enxerto</th><th>Variedade</th>
            <th>Plantio</th><th>Idade</th><th>Funcionário</th><th>Status</th>
            ${isAdmin()?'<th></th>':''}
          </tr>
        </thead>
        <tbody>
          ${lotes.map(l => {
            const b = byId('bancadas', l.bancada_id);
            const e = b ? byId('estufas', b.estufa_id) : null;
            const f = byId('funcionarios', l.funcionario_id);
            const idade = idadeMeses(l.data_plantio, new Date());
            let status = `<span class="badge bg-green-100 text-green-800">${idade}m ativo</span>`;
            if (idade === 12) status = `<span class="badge bg-yellow-100 text-yellow-800">${idade}m última parcela</span>`;
            if (idade === 13) status = `<span class="badge bg-orange-100 text-orange-800">${idade}m retenção</span>`;
            if (idade > 13) status = `<span class="badge bg-red-100 text-red-800">${idade}m vencido</span>`;
            return `<tr class="border-t hover:bg-gray-50">
              <td class="p-2">${escapeHtml(e?.nome||'?')}</td>
              <td>${escapeHtml(b?.numero||'?')}</td>
              <td>${fmtNum(l.qtd)}</td>
              <td>${escapeHtml(l.porta_enxerto||'-')}</td>
              <td>${escapeHtml(l.variedade||'-')}</td>
              <td>${fmtDate(l.data_plantio)}</td>
              <td>${idade}m</td>
              <td>${escapeHtml(f?.nome||'-')}</td>
              <td>${status}</td>
              ${isAdmin()?`<td><button onclick="editarLote('${l.id}')" class="text-blue-700 text-xs hover:underline">editar</button> · <button onclick="deletarLote('${l.id}')" class="text-red-700 text-xs hover:underline">excluir</button></td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
};

window.novoLote = () => formLote(null);
window.editarLote = (id) => formLote(byId('lotes', id));
window.deletarLote = async function(id) {
  if (!confirm('Excluir este lote?')) return;
  await DB.remove('lotes', id);
  setView(STATE.view);
  toast('Lote excluído', 'success');
};

function funcionariosPorEstufa(estufaId) {
  const e = byId('estufas', estufaId);
  if (e && e.funcionarios_padrao && e.funcionarios_padrao.length) {
    return e.funcionarios_padrao.map(id => byId('funcionarios', id)).filter(Boolean);
  }
  const ids = new Set();
  STATE.data.bancadas.filter(b => b.estufa_id === estufaId).forEach(b => { if (b.funcionario_id) ids.add(b.funcionario_id); });
  return [...ids].map(id => byId('funcionarios', id)).filter(Boolean);
}

function rebuildFuncSelect(estufaId, currentVal) {
  const sel = $('#lFunc');
  if (!sel) return;
  const padrao = funcionariosPorEstufa(estufaId);
  const padraoIds = new Set(padrao.map(f => f.id));
  const outros = STATE.data.funcionarios.filter(f => !padraoIds.has(f.id));
  let html = '<option value="">— sem funcionário —</option>';
  if (padrao.length) {
    html += '<optgroup label="Funcionários desta estufa">';
    html += padrao.map(f => '<option value="'+f.id+'"'+(f.id===currentVal?' selected':'')+'>'+escapeHtml(f.nome)+'</option>').join('');
    html += '</optgroup>';
  }
  html += '<optgroup label="Outros funcionários">';
  html += outros.map(f => '<option value="'+f.id+'"'+(f.id===currentVal?' selected':'')+'>'+escapeHtml(f.nome)+'</option>').join('');
  html += '</optgroup>';
  sel.innerHTML = html;
  if (!currentVal && padrao.length === 1) sel.value = padrao[0].id;
}

function formLote(lote) {
  const isNew = !lote;
  lote = lote || { qtd:0, tipo:'muda_normal', data_plantio: new Date().toISOString().slice(0,10) };
  openModal(isNew?'Novo lote':'Editar lote', `
    <form id="loteForm" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium">Estufa</label>
          <select id="lEstufa" required class="w-full mt-1 px-3 py-2 border rounded">
            ${STATE.data.estufas.map(e => '<option value="'+e.id+'">'+escapeHtml(e.nome)+' ('+SITIO_LABEL[e.sitio]+')</option>').join('')}
          </select>
        </div>
        <div>
          <label class="text-sm font-medium">Bancada</label>
          <input id="lBancada" type="text" required placeholder="ex: 12B" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium">Quantidade de mudas</label>
          <input id="lQtd" type="number" min="1" required value="${lote.qtd||''}" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
        <div>
          <label class="text-sm font-medium">Funcionário</label>
          <select id="lFunc" class="w-full mt-1 px-3 py-2 border rounded"><option value="">— sem funcionário —</option></select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium">Porta-enxerto</label>
          <input id="lPorta" type="text" value="${escapeHtml(lote.porta_enxerto||'')}" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
        <div>
          <label class="text-sm font-medium">Variedade (copa)</label>
          <input id="lVar" type="text" value="${escapeHtml(lote.variedade||'')}" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="text-sm font-medium">Tipo</label>
          <select id="lTipo" class="w-full mt-1 px-3 py-2 border rounded">
            <option value="muda_normal" ${lote.tipo==='muda_normal'?'selected':''}>Muda normal</option>
            <option value="inter_enxerto" ${lote.tipo==='inter_enxerto'?'selected':''}>Inter-enxerto</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium">Data de plantio</label>
          <input id="lPlantio" type="date" required value="${lote.data_plantio||''}" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
        <div>
          <label class="text-sm font-medium">Data do enxerto</label>
          <input id="lEnxerto" type="date" value="${lote.data_enxerto||''}" class="w-full mt-1 px-3 py-2 border rounded">
        </div>
      </div>
      <div>
        <label class="text-sm font-medium">Nº Processo da bancada</label>
        <input id="lProcesso" type="text" placeholder="ex: 20251257 (em branco usa o padrão da estufa)" value="${escapeHtml(lote.bancada_id ? (byId('bancadas', lote.bancada_id)?.processo || '') : '')}" class="w-full mt-1 px-3 py-2 border rounded">
        <p class="text-xs text-gray-500 mt-1">Esse número aparece nas plaquinhas. Se ficar em branco, usa o padrão da configuração de plaquinhas.</p>
      </div>
      <div class="flex justify-end gap-2 pt-3">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>
  `);
  if (lote.bancada_id) {
    const b = byId('bancadas', lote.bancada_id);
    if (b) { $('#lEstufa').value = b.estufa_id; $('#lBancada').value = b.numero; }
  }
  rebuildFuncSelect($('#lEstufa').value, lote.funcionario_id);
  $('#lEstufa').addEventListener('change', () => rebuildFuncSelect($('#lEstufa').value, null));
  $('#loteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const estufaId = $('#lEstufa').value;
    const bancadaNum = $('#lBancada').value.trim();
    let bancada = STATE.data.bancadas.find(b => b.estufa_id === estufaId && b.numero === bancadaNum);
    if (!bancada) bancada = await DB.insert('bancadas', { estufa_id: estufaId, numero: bancadaNum, funcionario_id: $('#lFunc').value || null });
    const payload = {
      bancada_id: bancada.id,
      funcionario_id: $('#lFunc').value || null,
      qtd: parseInt($('#lQtd').value),
      porta_enxerto: $('#lPorta').value || null,
      variedade: $('#lVar').value || null,
      tipo: $('#lTipo').value,
      data_plantio: $('#lPlantio').value,
      data_enxerto: $('#lEnxerto').value || null,
    };
    if (isNew) await DB.insert('lotes', payload);
    else await DB.update('lotes', lote.id, payload);
    closeModal();
    setView(STATE.view);
    toast('Salvo', 'success');
  });
}

// ============================================================
// PAGAMENTOS - 4 ABAS
// ============================================================
function painelVerificacao(detalhes) {
  const porSitio = {};
  for (const d of detalhes) {
    const s = d.estufa?.sitio;
    if (!s) continue;
    porSitio[s] = porSitio[s] || { mudas:0, valor:0, valorUnit: d.valorUnitario||0 };
    porSitio[s].mudas += d.lote.qtd;
    porSitio[s].valor += d.valor;
  }
  const total = Object.values(porSitio).reduce((s,g)=>s+g.valor,0);
  return `
    <div class="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <h4 class="font-bold text-blue-900 mb-2 text-sm">🔍 Verificação do cálculo</h4>
      <table class="w-full text-xs">
        <thead class="text-blue-800">
          <tr class="border-b border-blue-200">
            <th class="text-left py-1">Sítio</th>
            <th class="text-right">Mudas</th>
            <th class="text-center">×</th>
            <th class="text-right">Valor unit. (R$/mês)</th>
            <th class="text-center">=</th>
            <th class="text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(porSitio).map(([s,g]) => {
            const esp = g.mudas * g.valorUnit;
            const ok = Math.abs(esp - g.valor) < 0.01;
            return `<tr class="border-b border-blue-100">
              <td class="py-1">${SITIO_LABEL[s]||s}</td>
              <td class="text-right">${fmtNum(g.mudas)}</td>
              <td class="text-center text-gray-500">×</td>
              <td class="text-right font-mono">${fmtUnitario(g.valorUnit)}</td>
              <td class="text-center text-gray-500">=</td>
              <td class="text-right font-mono ${ok?'':'text-red-700'}">${fmtMoneyExato(g.valor)}${ok?' ✅':' ⚠️'}</td>
            </tr>`;
          }).join('')}
          <tr class="font-bold">
            <td class="py-2">TOTAL</td>
            <td colspan="4"></td>
            <td class="text-right font-mono text-blue-800">${fmtMoneyExato(total)}</td>
          </tr>
        </tbody>
      </table>
      <p class="text-xs text-blue-700 mt-2">Fórmula: <b>meses 1–12</b>: (preço − retenção) ÷ 12 × qtd. <b>Mês 13</b>: só retenção (R$ 0,15 × qtd). <b>Mês 14+</b>: bancada sai da folha.</p>
    </div>
  `;
}

VIEWS.pag_resumo = function() {
  const r = getRefMes();
  let total=0, totalFixos=0, totalMudas=0;
  const linhas = STATE.data.funcionarios.map(f => {
    const c = calcularPagamentoFuncionario(f.id, r.ano, r.mes);
    if (c.tipoPagamento==='salario_fixo') totalFixos += c.total;
    else totalMudas += c.total;
    total += c.total;
    return { f, c };
  }).sort((a,b) => b.c.total - a.c.total);

  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">💰 Resumo geral de pagamento</h2>
    <p class="text-sm text-gray-500 mb-4">${nomesMes(r.mes)}/${r.ano}</p>
    <div class="bg-white p-3 rounded-xl shadow mb-4 flex flex-wrap items-center gap-3">
      <div><label class="text-xs text-gray-500 block">Mês</label>${selectorMes("setView('pag_resumo')")}</div>
      <div class="flex-1"></div>
      <button onclick="window.print()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm">🖨️ Imprimir</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500">Total geral</div><div class="text-2xl font-bold text-green-700">${fmtMoneyExato(total)}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500">Por muda</div><div class="text-2xl font-bold text-blue-700">${fmtMoneyExato(totalMudas)}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500">Salários fixos</div><div class="text-2xl font-bold text-gray-700">${fmtMoneyExato(totalFixos)}</div></div>
    </div>
    <div class="bg-white rounded-xl shadow overflow-hidden print-area">
      <div class="p-4 border-b"><h3 class="font-bold">Folha de pagamento — ${nomesMes(r.mes)}/${r.ano}</h3></div>
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-600">
          <tr><th class="p-3 text-left">Funcionário</th><th class="p-3 text-left">Tipo</th>
            <th class="p-3 text-right">Bancadas</th><th class="p-3 text-right">Mudas</th>
            <th class="p-3 text-right">Conferência</th>
            <th class="p-3 text-right">Total</th><th class="no-print"></th></tr>
        </thead>
        <tbody>
          ${linhas.map(({f,c}) => {
            let confer = '';
            if (c.tipoPagamento === 'por_muda' && c.detalhes.length) {
              const ps = {};
              for (const d of c.detalhes) {
                const s = d.estufa?.sitio;
                ps[s] = ps[s] || { mudas:0, unit: d.valorUnitario||0 };
                ps[s].mudas += d.lote.qtd;
              }
              confer = '<span class="text-xs text-gray-600 font-mono">' + Object.entries(ps).map(([s,g]) => fmtNum(g.mudas)+'×'+fmtUnitario(g.unit).slice(0,5)).join(' + ') + '</span>';
            }
            return `<tr class="border-t hover:bg-gray-50">
              <td class="p-3 font-medium">${escapeHtml(f.nome)}</td>
              <td class="p-3"><span class="badge ${c.tipoPagamento==='salario_fixo'?'bg-gray-200 text-gray-800':'bg-green-100 text-green-800'}">${c.tipoPagamento==='salario_fixo'?'Salário fixo':'Por muda'}</span></td>
              <td class="p-3 text-right">${c.detalhes.length}</td>
              <td class="p-3 text-right">${fmtNum(c.detalhes.reduce((s,d)=>s+d.lote.qtd,0))}</td>
              <td class="p-3 text-right">${confer}</td>
              <td class="p-3 text-right font-mono font-semibold">${fmtMoneyExato(c.total)}</td>
              <td class="no-print text-right pr-3"><button onclick="STATE.pagFunc='${f.id}';setView('pag_funcionario')" class="text-blue-700 hover:underline text-xs">Ver folha</button></td>
            </tr>`;
          }).join('')}
          <tr class="bg-green-100 font-bold">
            <td class="p-3" colspan="5">TOTAL GERAL</td>
            <td class="p-3 text-right font-mono text-green-800">${fmtMoneyExato(total)}</td>
            <td class="no-print"></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
};
VIEWS.pagamentos = VIEWS.pag_resumo;

VIEWS.pag_funcionario = function() {
  const r = getRefMes();
  STATE.pagFunc = STATE.pagFunc || (STATE.data.funcionarios[0]?.id || '');
  const f = byId('funcionarios', STATE.pagFunc);
  const c = f ? calcularPagamentoFuncionario(f.id, r.ano, r.mes) : null;
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">👤 Pagamento por funcionário</h2>
    <p class="text-sm text-gray-500 mb-4">Folha individual com bancadas, valores unitários exatos e total a receber.</p>
    <div class="bg-white p-3 rounded-xl shadow mb-4 flex flex-wrap items-center gap-3">
      <div>
        <label class="text-xs text-gray-500 block">Funcionário</label>
        <select onchange="STATE.pagFunc=this.value;setView('pag_funcionario')" class="px-3 py-2 border rounded text-sm">
          ${STATE.data.funcionarios.map(x => '<option value="'+x.id+'"'+(x.id===STATE.pagFunc?' selected':'')+'>'+escapeHtml(x.nome)+'</option>').join('')}
        </select>
      </div>
      <div>
        <label class="text-xs text-gray-500 block">Mês</label>
        ${selectorMes("setView('pag_funcionario')")}
      </div>
      <div class="flex-1"></div>
      <button onclick="window.print()" class="bg-green-700 hover:bg-green-800 text-white px-4 py-2 rounded text-sm">🖨️ Imprimir folha</button>
    </div>
    <div class="bg-white rounded-xl shadow p-6 print-area" id="folhaInd"></div>
  `;
  if (f && c) $('#folhaInd').innerHTML = renderFolhaIndividual(f, c, r.ano, r.mes);
};

window.abrirFolhaPagamento = function(funcId, ano, mes) {
  STATE.pagFunc = funcId;
  STATE.refMes = ano + '-' + String(mes).padStart(2,'0');
  setView('pag_funcionario');
};

function renderFolhaIndividual(f, c, ano, mes) {
  if (c.tipoPagamento === 'salario_fixo') {
    return `
      <div class="text-center mb-4">
        <h2 class="text-xl font-bold">FOLHA DE PAGAMENTO</h2>
        <p class="text-lg">${escapeHtml(f.nome)}</p>
        <p class="text-sm text-gray-600">Referência: ${nomesMes(mes)} / ${ano}</p>
      </div>
      <div class="bg-gray-50 border rounded-xl p-6 text-center">
        <p class="text-sm text-gray-600 mb-1">Funcionário com salário fixo mensal</p>
        <p class="text-4xl font-bold text-green-800">${fmtMoneyExato(f.salario_fixo)}</p>
      </div>
      <div class="mt-12 grid grid-cols-2 gap-8 text-sm">
        <div class="text-center"><div class="border-t border-gray-400 pt-2">Funcionário</div></div>
        <div class="text-center"><div class="border-t border-gray-400 pt-2">Responsável</div></div>
      </div>`;
  }
  const porEstufa = {};
  for (const d of c.detalhes) {
    const k = d.estufa?.id || '?';
    porEstufa[k] = porEstufa[k] || { estufa:d.estufa, items:[], subtotal:0, mudas:0, enxertos:0 };
    porEstufa[k].items.push(d);
    porEstufa[k].subtotal += d.valor;
    porEstufa[k].mudas += d.lote.qtd;
    porEstufa[k].enxertos += qtdEnxertos(d.lote);
  }
  return `
    <div class="text-center mb-4">
      <h2 class="text-xl font-bold">FOLHA DE PAGAMENTO</h2>
      <p class="text-lg">${escapeHtml(f.nome)}</p>
      <p class="text-sm text-gray-600">Referência: ${nomesMes(mes)} / ${ano}</p>
    </div>
    ${Object.values(porEstufa).map(g => `
      <h4 class="font-bold mt-4 bg-gray-100 p-2 rounded">
        ${escapeHtml(g.estufa?.nome||'?')}
        <span class="text-xs font-normal text-gray-600 ml-2">${SITIO_LABEL[g.estufa?.sitio]||''}</span>
      </h4>
      <table class="w-full text-xs border mb-2">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left border">BC</th>
            <th class="p-2 text-right border">Qtd porta-enx.</th>
            <th class="p-2 text-right border">Qtd enxertos</th>
            <th class="p-2 text-left border">Porta-enxerto</th>
            <th class="p-2 text-left border">Variedade</th>
            <th class="p-2 text-center border">Plantio</th>
            <th class="p-2 text-center border">Parcela</th>
            <th class="p-2 text-right border">Valor unit.</th>
            <th class="p-2 text-right border">Valor total</th>
          </tr>
        </thead>
        <tbody>
          ${g.items.map(d => `<tr>
            <td class="p-2 border font-mono">${escapeHtml(d.bancada?.numero||'?')}</td>
            <td class="p-2 border text-right">${fmtNum(d.lote.qtd)}</td>
            <td class="p-2 border text-right">${fmtNum(qtdEnxertos(d.lote))}</td>
            <td class="p-2 border">${escapeHtml(d.lote.porta_enxerto||'-')}</td>
            <td class="p-2 border">${escapeHtml(d.lote.variedade||'-')}</td>
            <td class="p-2 border text-center">${fmtDate(d.lote.data_plantio)}</td>
            <td class="p-2 border text-center">${d.parcela}/12${d.motivo.includes('retencao')?' <b class="text-red-700">+RET</b>':''}</td>
            <td class="p-2 border text-right font-mono">${fmtUnitario(d.valorUnitario)}</td>
            <td class="p-2 border text-right font-mono font-semibold">${fmtMoneyExato(d.valor)}</td>
          </tr>`).join('')}
          <tr class="bg-gray-100 font-bold">
            <td class="p-2 border">Subtotal</td>
            <td class="p-2 border text-right">${fmtNum(g.mudas)}</td>
            <td class="p-2 border text-right">${fmtNum(g.enxertos)}</td>
            <td colspan="5" class="border"></td>
            <td class="p-2 border text-right font-mono">${fmtMoneyExato(g.subtotal)}</td>
          </tr>
        </tbody>
      </table>
    `).join('')}
    <div class="bg-green-100 p-4 rounded-xl mt-4 flex justify-between items-baseline">
      <span class="text-sm font-medium">TOTAL A RECEBER:</span>
      <span class="text-3xl font-bold text-green-800">${fmtMoneyExato(c.total)}</span>
    </div>
    ${painelVerificacao(c.detalhes)}
    <div class="mt-12 grid grid-cols-2 gap-8 text-sm">
      <div class="text-center"><div class="border-t border-gray-400 pt-2">Funcionário</div></div>
      <div class="text-center"><div class="border-t border-gray-400 pt-2">Responsável</div></div>
    </div>
  `;
}

VIEWS.pag_estufa = function() {
  const r = getRefMes();
  const grupos = {};
  for (const e of STATE.data.estufas) grupos[e.id] = { estufa:e, total:0, mudas:0, enxertos:0, lotes:0, funcs:new Set() };
  for (const l of STATE.data.lotes) {
    const b = byId('bancadas', l.bancada_id);
    if (!b) continue;
    const g = grupos[b.estufa_id];
    if (!g) continue;
    const c = valorPagamentoLoteMes(l, r.ano, r.mes);
    g.total += c.valor; g.mudas += l.qtd; g.enxertos += qtdEnxertos(l); g.lotes++;
    if (l.funcionario_id) g.funcs.add(l.funcionario_id);
  }
  const totalGeral = Object.values(grupos).reduce((s,g)=>s+g.total,0);
  const sitios = {};
  for (const g of Object.values(grupos)) {
    const s = g.estufa.sitio;
    sitios[s] = sitios[s] || { total:0, mudas:0, estufas:0 };
    sitios[s].total += g.total; sitios[s].mudas += g.mudas; sitios[s].estufas++;
  }
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">🏠 Pagamento por estufa</h2>
    <div class="bg-white p-3 rounded-xl shadow mb-4 flex flex-wrap items-center gap-3">
      <div><label class="text-xs text-gray-500 block">Mês</label>${selectorMes("setView('pag_estufa')")}</div>
      <div class="flex-1"></div>
      <button onclick="window.print()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm">🖨️ Imprimir</button>
    </div>
    <div class="grid md:grid-cols-3 gap-3 mb-4">
      ${Object.entries(sitios).map(([s,d]) => `
        <div class="bg-white p-4 rounded-xl shadow">
          <div class="text-xs text-gray-500">${SITIO_LABEL[s]||s}</div>
          <div class="text-xl font-bold text-green-700">${fmtMoneyExato(d.total)}</div>
          <div class="text-xs text-gray-500 mt-1">${d.estufas} estufas · ${fmtNum(d.mudas)} mudas</div>
        </div>`).join('')}
    </div>
    <div class="bg-white rounded-xl shadow overflow-hidden print-area">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-600">
          <tr><th class="p-3 text-left">Estufa</th><th class="p-3 text-left">Sítio</th>
            <th class="p-3 text-right">Lotes</th><th class="p-3 text-right">Mudas</th>
            <th class="p-3 text-right">Enxertos</th><th class="p-3 text-right">Funcionários</th>
            <th class="p-3 text-right">Total a pagar</th></tr>
        </thead>
        <tbody>
          ${Object.values(grupos).sort((a,b)=>b.total-a.total).map(g => `<tr class="border-t hover:bg-gray-50">
            <td class="p-3 font-medium">${escapeHtml(g.estufa.nome)}</td>
            <td class="p-3 text-gray-600">${SITIO_LABEL[g.estufa.sitio]||g.estufa.sitio}</td>
            <td class="p-3 text-right">${g.lotes}</td>
            <td class="p-3 text-right">${fmtNum(g.mudas)}</td>
            <td class="p-3 text-right">${fmtNum(g.enxertos)}</td>
            <td class="p-3 text-right">${g.funcs.size}</td>
            <td class="p-3 text-right font-mono font-semibold">${fmtMoneyExato(g.total)}</td>
          </tr>`).join('')}
          <tr class="bg-green-100 font-bold">
            <td class="p-3" colspan="6">TOTAL GERAL</td>
            <td class="p-3 text-right font-mono text-green-800">${fmtMoneyExato(totalGeral)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
};

VIEWS.pag_mensal = function() {
  const today = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    meses.push({ ano:d.getFullYear(), mes:d.getMonth()+1, label: nomesMes(d.getMonth()+1).slice(0,3)+'/'+String(d.getFullYear()).slice(2) });
  }
  const totaisMes = meses.map(({ano,mes,label}) => {
    let total=0;
    for (const f of STATE.data.funcionarios) total += calcularPagamentoFuncionario(f.id, ano, mes).total;
    return { ano, mes, label, total };
  });
  const max = Math.max(...totaisMes.map(t=>t.total), 1);
  const funcs = STATE.data.funcionarios.filter(f => f.tipo === 'por_muda');
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">📅 Totais mensais</h2>
    <p class="text-sm text-gray-500 mb-4">Últimos 12 meses.</p>
    <div class="bg-white p-4 rounded-xl shadow mb-4">
      <h3 class="font-bold mb-3">Total a pagar por mês</h3>
      <div class="space-y-2">
        ${totaisMes.map(t => `
          <div class="flex items-center gap-3">
            <div class="w-16 text-xs text-gray-600">${t.label}</div>
            <div class="flex-1 bg-gray-100 rounded h-6 relative overflow-hidden">
              <div class="bg-green-600 h-full" style="width:${(t.total/max*100).toFixed(1)}%"></div>
              <div class="absolute inset-0 flex items-center px-2 text-xs font-mono">${fmtMoneyExato(t.total)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto print-area">
      <div class="p-4 border-b"><h3 class="font-bold">Detalhamento por funcionário (R$)</h3></div>
      <table class="w-full text-xs">
        <thead class="bg-gray-50">
          <tr><th class="p-2 text-left sticky left-0 bg-gray-50">Funcionário</th>
            ${meses.map(m => '<th class="p-2 text-right">'+m.label+'</th>').join('')}
            <th class="p-2 text-right bg-green-50">Total 12m</th></tr>
        </thead>
        <tbody>
          ${funcs.map(f => {
            const vals = meses.map(({ano,mes}) => calcularPagamentoFuncionario(f.id, ano, mes).total);
            const tot = vals.reduce((s,v)=>s+v,0);
            return `<tr class="border-t hover:bg-gray-50">
              <td class="p-2 font-medium sticky left-0 bg-white">${escapeHtml(f.nome)}</td>
              ${vals.map(v => '<td class="p-2 text-right font-mono '+(v>0?'':'text-gray-400')+'">'+(v>0?fmtMoneyExato(v).replace('R$ ',''):'-')+'</td>').join('')}
              <td class="p-2 text-right font-mono font-semibold bg-green-50">${fmtMoneyExato(tot).replace('R$ ','')}</td>
            </tr>`;
          }).join('')}
          <tr class="bg-green-100 font-bold">
            <td class="p-2 sticky left-0 bg-green-100">TOTAL</td>
            ${totaisMes.map(t => '<td class="p-2 text-right font-mono">'+fmtMoneyExato(t.total).replace('R$ ','')+'</td>').join('')}
            <td class="p-2 text-right font-mono bg-green-200">${fmtMoneyExato(totaisMes.reduce((s,t)=>s+t.total,0)).replace('R$ ','')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
};

// ============================================================
// VISAO GERAL com 3 abas
// ============================================================
function linhaLote(lote, ano, mes) {
  const b = byId('bancadas', lote.bancada_id);
  const e = b ? byId('estufas', b.estufa_id) : null;
  const f = byId('funcionarios', lote.funcionario_id);
  const c = valorPagamentoLoteMes(lote, ano, mes);
  return { lote, bancada:b, estufa:e, funcionario:f, qtdEnxertos:qtdEnxertos(lote), qtdPorta:qtdPortaEnxertos(lote),
    valorUnitario: c.valorUnitario||0, valorTotal: c.valor, parcela:c.parcela, motivo:c.motivo };
}

VIEWS.visao_geral = function() {
  const r = getRefMes();
  STATE.vgTab = STATE.vgTab || 'estufa';
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">📋 Visão geral</h2>
    <p class="text-sm text-gray-500 mb-4">Todas as bancadas, enxertos, porta-enxertos e valores.</p>
    <div class="bg-white p-3 rounded-xl shadow mb-4 flex flex-wrap items-center gap-3">
      <div><label class="text-xs text-gray-500 block">Mês de referência</label>${selectorMes("setView('visao_geral')")}</div>
      <div class="flex-1"></div>
      <button onclick="window.print()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm">🖨️ Imprimir</button>
    </div>
    <div class="bg-white rounded-xl shadow overflow-hidden">
      <div class="border-b flex">
        ${[['estufa','Por Estufa','🏠'],['bancada','Por Bancada','📐'],['funcionario','Por Funcionário','👤']].map(([k,l,i]) => `
          <button onclick="STATE.vgTab='${k}';setView('visao_geral')" class="px-4 py-3 text-sm border-b-2 ${STATE.vgTab===k?'border-green-700 text-green-800 font-semibold':'border-transparent text-gray-500 hover:text-gray-800'}">${i} ${l}</button>
        `).join('')}
      </div>
      <div class="p-4">${vgRender(r.ano, r.mes)}</div>
    </div>
  `;
};

function vgHeader() {
  return `<thead class="bg-gray-50 text-xs uppercase text-gray-600">
    <tr>
      <th class="p-2 text-left">Estufa</th><th class="p-2 text-left">Bancada</th>
      <th class="p-2 text-left">Funcionário</th>
      <th class="p-2 text-right">Qtd porta-enxertos</th>
      <th class="p-2 text-right">Qtd enxertos</th>
      <th class="p-2 text-left">Variedade</th>
      <th class="p-2 text-center">Parcela</th>
      <th class="p-2 text-right">Valor unitário (R$/muda·mês)</th>
      <th class="p-2 text-right">Valor total a receber</th>
    </tr>
  </thead>`;
}

function vgRow(x) {
  return `<tr class="border-t hover:bg-gray-50">
    <td class="p-2">${escapeHtml(x.estufa?.nome||'?')}</td>
    <td class="p-2 font-mono">BC ${escapeHtml(x.bancada?.numero||'?')}</td>
    <td class="p-2">${escapeHtml(x.funcionario?.nome||'-')}</td>
    <td class="p-2 text-right">${fmtNum(x.qtdPorta)}</td>
    <td class="p-2 text-right">${fmtNum(x.qtdEnxertos)}${x.lote.tipo==='inter_enxerto'?' <span class="badge bg-purple-100 text-purple-800">2x</span>':''}</td>
    <td class="p-2 text-xs text-gray-600">${escapeHtml(x.lote.porta_enxerto||'-')} / ${escapeHtml(x.lote.variedade||'-')}</td>
    <td class="p-2 text-center text-xs">${x.parcela||'-'}/12</td>
    <td class="p-2 text-right font-mono text-xs">${fmtUnitario(x.valorUnitario)}</td>
    <td class="p-2 text-right font-mono font-semibold">${fmtMoneyExato(x.valorTotal)}</td>
  </tr>`;
}

function vgRender(ano, mes) {
  const linhas = STATE.data.lotes.map(l => linhaLote(l, ano, mes)).filter(x => x.valorTotal > 0 || x.lote.qtd > 0);
  if (STATE.vgTab === 'bancada') return vgPorBancada(linhas);
  if (STATE.vgTab === 'funcionario') return vgPorFuncionario(linhas);
  return vgPorEstufa(linhas);
}

function vgPorEstufa(linhas) {
  const grupos = {};
  for (const x of linhas) {
    const k = x.estufa?.id || '?';
    grupos[k] = grupos[k] || { estufa:x.estufa, items:[], total:0, mudas:0, enxertos:0 };
    grupos[k].items.push(x);
    grupos[k].total += x.valorTotal;
    grupos[k].mudas += x.qtdPorta;
    grupos[k].enxertos += x.qtdEnxertos;
  }
  const totalGeral = Object.values(grupos).reduce((s,g)=>s+g.total,0);
  return Object.values(grupos).sort((a,b) => (a.estufa?.nome||'').localeCompare(b.estufa?.nome||'')).map(g => `
    <div class="mb-6">
      <div class="flex flex-wrap items-baseline justify-between bg-green-50 p-3 rounded">
        <h3 class="font-bold text-lg">${escapeHtml(g.estufa?.nome||'?')}<span class="text-xs text-gray-500 ml-2">${SITIO_LABEL[g.estufa?.sitio]||''}</span></h3>
        <div class="text-sm space-x-4">
          <span>${fmtNum(g.mudas)} porta-enxertos</span>
          <span>${fmtNum(g.enxertos)} enxertos</span>
          <span class="font-bold text-green-800">${fmtMoneyExato(g.total)}</span>
        </div>
      </div>
      <table class="w-full text-sm mt-2">${vgHeader()}<tbody>
        ${g.items.sort((a,b) => (a.bancada?.numero||'').localeCompare(b.bancada?.numero||'',undefined,{numeric:true})).map(vgRow).join('')}
      </tbody></table>
    </div>`).join('') + `
    <div class="mt-4 p-4 bg-green-100 rounded-xl flex justify-between items-baseline">
      <span class="font-bold text-lg">TOTAL GERAL</span>
      <span class="font-mono text-2xl text-green-800 font-bold">${fmtMoneyExato(totalGeral)}</span>
    </div>`;
}

function vgPorBancada(linhas) {
  const total = linhas.reduce((s,x)=>s+x.valorTotal,0);
  return `<table class="w-full text-sm">${vgHeader()}<tbody>
    ${linhas.sort((a,b) => (a.estufa?.nome||'').localeCompare(b.estufa?.nome||'') || (a.bancada?.numero||'').localeCompare(b.bancada?.numero||'',undefined,{numeric:true})).map(vgRow).join('')}
  </tbody><tfoot><tr class="bg-green-100 font-bold"><td colspan="8" class="p-3 text-right">TOTAL</td><td class="p-3 text-right font-mono">${fmtMoneyExato(total)}</td></tr></tfoot></table>`;
}

function vgPorFuncionario(linhas) {
  const grupos = {};
  for (const x of linhas) {
    const k = x.funcionario?.id || '?';
    grupos[k] = grupos[k] || { funcionario:x.funcionario, items:[], total:0, mudas:0, enxertos:0 };
    grupos[k].items.push(x);
    grupos[k].total += x.valorTotal;
    grupos[k].mudas += x.qtdPorta;
    grupos[k].enxertos += x.qtdEnxertos;
  }
  const totalGeral = Object.values(grupos).reduce((s,g)=>s+g.total,0);
  return Object.values(grupos).sort((a,b) => b.total - a.total).map(g => `
    <div class="mb-6">
      <div class="flex flex-wrap items-baseline justify-between bg-blue-50 p-3 rounded">
        <h3 class="font-bold text-lg">${escapeHtml(g.funcionario?.nome||'?')}</h3>
        <div class="text-sm space-x-4">
          <span>${g.items.length} bancadas</span>
          <span>${fmtNum(g.mudas)} mudas</span>
          <span class="font-bold text-blue-800">${fmtMoneyExato(g.total)}</span>
        </div>
      </div>
      <table class="w-full text-sm mt-2">${vgHeader()}<tbody>${g.items.map(vgRow).join('')}</tbody></table>
    </div>`).join('') + `
    <div class="mt-4 p-4 bg-green-100 rounded-xl flex justify-between items-baseline">
      <span class="font-bold text-lg">TOTAL GERAL</span>
      <span class="font-mono text-2xl text-green-800 font-bold">${fmtMoneyExato(totalGeral)}</span>
    </div>`;
}

// ============================================================
// CONSULTA / FILTROS
// ============================================================
VIEWS.consulta = function() {
  STATE.consF = STATE.consF || { porta:'', variedade:'', estufa:'', funcionario:'' };
  const portas = [...new Set(STATE.data.lotes.map(l=>l.porta_enxerto).filter(Boolean))].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  const vars = [...new Set(STATE.data.lotes.map(l=>l.variedade).filter(Boolean))].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1">🔎 Consulta / Filtros</h2>
    <p class="text-sm text-gray-500 mb-4">Filtre lotes por porta-enxerto, variedade, estufa ou funcionário e veja totais.</p>
    <div class="bg-white p-4 rounded-xl shadow mb-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="text-xs text-gray-500 uppercase">Porta-enxerto</label>
          <input id="cPorta" list="portasList" placeholder="ex: Citrumelo" value="${escapeHtml(STATE.consF.porta)}" class="w-full mt-1 px-3 py-2 border rounded text-sm">
          <datalist id="portasList">${portas.map(p => '<option value="'+escapeHtml(p)+'">').join('')}</datalist>
        </div>
        <div>
          <label class="text-xs text-gray-500 uppercase">Variedade</label>
          <input id="cVar" list="varsList" placeholder="ex: americana" value="${escapeHtml(STATE.consF.variedade)}" class="w-full mt-1 px-3 py-2 border rounded text-sm">
          <datalist id="varsList">${vars.map(v => '<option value="'+escapeHtml(v)+'">').join('')}</datalist>
        </div>
        <div>
          <label class="text-xs text-gray-500 uppercase">Estufa</label>
          <select id="cEstufa" class="w-full mt-1 px-3 py-2 border rounded text-sm">
            <option value="">— todas —</option>
            ${STATE.data.estufas.map(e => '<option value="'+e.id+'"'+(e.id===STATE.consF.estufa?' selected':'')+'>'+escapeHtml(e.nome)+'</option>').join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500 uppercase">Funcionário</label>
          <select id="cFunc" class="w-full mt-1 px-3 py-2 border rounded text-sm">
            <option value="">— todos —</option>
            ${STATE.data.funcionarios.map(f => '<option value="'+f.id+'"'+(f.id===STATE.consF.funcionario?' selected':'')+'>'+escapeHtml(f.nome)+'</option>').join('')}
          </select>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button onclick="aplicarConsulta()" class="bg-green-700 text-white px-4 py-2 rounded text-sm">🔎 Buscar</button>
        <button onclick="limparConsulta()" class="bg-gray-100 text-gray-700 px-4 py-2 rounded text-sm">Limpar</button>
        <button onclick="window.print()" class="bg-gray-100 text-gray-700 px-4 py-2 rounded text-sm ml-auto">🖨️ Imprimir</button>
      </div>
    </div>
    <div id="cResult"></div>
  `;
  renderConsulta();
};

window.aplicarConsulta = function() {
  STATE.consF = { porta:$('#cPorta').value.trim(), variedade:$('#cVar').value.trim(), estufa:$('#cEstufa').value, funcionario:$('#cFunc').value };
  renderConsulta();
};
window.limparConsulta = function() {
  STATE.consF = { porta:'', variedade:'', estufa:'', funcionario:'' };
  setView('consulta');
};

function renderConsulta() {
  const f = STATE.consF;
  const lotes = STATE.data.lotes.filter(l => {
    const b = byId('bancadas', l.bancada_id);
    if (!b) return false;
    if (f.porta && !(l.porta_enxerto||'').toLowerCase().includes(f.porta.toLowerCase())) return false;
    if (f.variedade && !(l.variedade||'').toLowerCase().includes(f.variedade.toLowerCase())) return false;
    if (f.estufa && b.estufa_id !== f.estufa) return false;
    if (f.funcionario && l.funcionario_id !== f.funcionario) return false;
    return true;
  });
  const r = getRefMes();
  let totMudas=0, totEnx=0, totVal=0;
  const porE={}, porP={}, porV={}, porF={};
  for (const l of lotes) {
    const b = byId('bancadas', l.bancada_id);
    const e = b ? byId('estufas', b.estufa_id) : null;
    const fu = byId('funcionarios', l.funcionario_id);
    const c = valorPagamentoLoteMes(l, r.ano, r.mes);
    totMudas += l.qtd; totEnx += qtdEnxertos(l); totVal += c.valor;
    if (e) { porE[e.id] = porE[e.id]||{nome:e.nome,mudas:0,valor:0,lotes:0}; porE[e.id].mudas+=l.qtd; porE[e.id].valor+=c.valor; porE[e.id].lotes++; }
    const p = l.porta_enxerto || '(sem)';
    porP[p] = porP[p]||{mudas:0,valor:0,lotes:0}; porP[p].mudas+=l.qtd; porP[p].valor+=c.valor; porP[p].lotes++;
    const v = l.variedade || '(sem)';
    porV[v] = porV[v]||{mudas:0,valor:0,lotes:0}; porV[v].mudas+=l.qtd; porV[v].valor+=c.valor; porV[v].lotes++;
    if (fu) { porF[fu.id] = porF[fu.id]||{nome:fu.nome,mudas:0,valor:0,lotes:0}; porF[fu.id].mudas+=l.qtd; porF[fu.id].valor+=c.valor; porF[fu.id].lotes++; }
  }
  if (lotes.length === 0) {
    $('#cResult').innerHTML = '<div class="bg-white p-8 rounded-xl shadow text-center text-gray-500">Nenhum lote encontrado.</div>';
    return;
  }

  // Breakdown porta-enxerto × variedade (sem enxerto vs cada copa)
  const cruz = {};  // chave = porta_enxerto, valor = { semEnxerto: {...}, copas: {variedade: {...}} }
  for (const l of lotes) {
    const p = l.porta_enxerto || '(sem porta-enxerto)';
    cruz[p] = cruz[p] || { total:{mudas:0,valor:0,lotes:0}, semEnxerto:{mudas:0,valor:0,lotes:0}, copas:{} };
    const c = valorPagamentoLoteMes(l, r.ano, r.mes);
    cruz[p].total.mudas += l.qtd; cruz[p].total.valor += c.valor; cruz[p].total.lotes++;
    if (!l.variedade) {
      cruz[p].semEnxerto.mudas += l.qtd;
      cruz[p].semEnxerto.valor += c.valor;
      cruz[p].semEnxerto.lotes++;
    } else {
      cruz[p].copas[l.variedade] = cruz[p].copas[l.variedade] || {mudas:0,valor:0,lotes:0};
      cruz[p].copas[l.variedade].mudas += l.qtd;
      cruz[p].copas[l.variedade].valor += c.valor;
      cruz[p].copas[l.variedade].lotes++;
    }
  }

  function tbl(title, rows, getName) {
    return `<div class="bg-white p-4 rounded-xl shadow"><h3 class="font-bold mb-2">${title}</h3>
      <table class="w-full text-sm"><thead class="text-xs text-gray-500 uppercase border-b"><tr>
        <th class="text-left py-1">Item</th><th class="text-right">Lotes</th><th class="text-right">Mudas</th><th class="text-right">Valor</th>
      </tr></thead><tbody>${rows.sort((a,b)=>b[1].mudas-a[1].mudas).map(([k,g]) =>
        `<tr class="border-b"><td class="py-1">${escapeHtml(getName?getName(k,g):k)}</td><td class="text-right">${g.lotes}</td><td class="text-right">${fmtNum(g.mudas)}</td><td class="text-right font-mono">${fmtMoneyExato(g.valor)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  $('#cResult').innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Lotes</div><div class="text-2xl font-bold">${lotes.length}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Porta-enxertos</div><div class="text-2xl font-bold text-green-700">${fmtNum(totMudas)}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Enxertos</div><div class="text-2xl font-bold text-emerald-700">${fmtNum(totEnx)}</div></div>
      <div class="bg-white p-4 rounded-xl shadow"><div class="text-xs text-gray-500 uppercase">Valor ${nomesMes(r.mes).slice(0,3)}/${r.ano}</div><div class="text-2xl font-bold text-blue-700">${fmtMoneyExato(totVal)}</div></div>
    </div>
    <div class="grid md:grid-cols-2 gap-4 mb-4">
      ${tbl('Por estufa', Object.entries(porE), (k,g)=>g.nome)}
      ${tbl('Por porta-enxerto', Object.entries(porP))}
      ${tbl('Por variedade (copa)', Object.entries(porV))}
      ${tbl('Por funcionário', Object.entries(porF), (k,g)=>g.nome)}
    </div>

    <div class="bg-white rounded-xl shadow mb-4 overflow-hidden">
      <div class="p-4 border-b">
        <h3 class="font-bold">🌱 Porta-enxerto × Copa (com vs sem enxerto)</h3>
        <p class="text-xs text-gray-500 mt-1">Para cada porta-enxerto: quantos ainda <b>sem copa</b> e quantos já enxertados, separados por variedade.</p>
      </div>
      <div class="p-4 space-y-4">
        ${Object.entries(cruz).sort((a,b) => b[1].total.mudas - a[1].total.mudas).map(([porta, g]) => `
          <div class="border rounded-lg overflow-hidden">
            <div class="bg-green-50 px-3 py-2 flex justify-between items-baseline">
              <h4 class="font-bold">${escapeHtml(porta)}</h4>
              <span class="text-sm">${fmtNum(g.total.mudas)} mudas total · <span class="font-mono text-green-800 font-semibold">${fmtMoneyExato(g.total.valor)}</span></span>
            </div>
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th class="p-2 text-left">Status</th>
                  <th class="p-2 text-right">Lotes</th>
                  <th class="p-2 text-right">Mudas</th>
                  <th class="p-2 text-right">Valor mês</th>
                </tr>
              </thead>
              <tbody>
                ${g.semEnxerto.mudas > 0 ? `<tr class="border-t bg-yellow-50">
                  <td class="p-2"><span class="badge bg-yellow-200 text-yellow-900">⚠️ SEM ENXERTO</span> <span class="text-xs text-gray-600">(porta-enxerto sem copa)</span></td>
                  <td class="p-2 text-right">${g.semEnxerto.lotes}</td>
                  <td class="p-2 text-right font-bold">${fmtNum(g.semEnxerto.mudas)}</td>
                  <td class="p-2 text-right font-mono">${fmtMoneyExato(g.semEnxerto.valor)}</td>
                </tr>` : ''}
                ${Object.entries(g.copas).sort((a,b) => b[1].mudas - a[1].mudas).map(([cop, x]) => `
                  <tr class="border-t hover:bg-gray-50">
                    <td class="p-2"><span class="badge bg-green-100 text-green-800">✓ enxertado</span> <span>${escapeHtml(cop)}</span></td>
                    <td class="p-2 text-right">${x.lotes}</td>
                    <td class="p-2 text-right">${fmtNum(x.mudas)}</td>
                    <td class="p-2 text-right font-mono">${fmtMoneyExato(x.valor)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto print-area">
      <div class="p-4 border-b"><h3 class="font-bold">Lotes encontrados (${lotes.length})</h3></div>
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-600">
          <tr><th class="p-2 text-left">Estufa</th><th class="p-2 text-left">BC</th>
            <th class="p-2 text-left">Funcionário</th>
            <th class="p-2 text-left">Porta-enxerto</th><th class="p-2 text-left">Variedade</th>
            <th class="p-2 text-right">Qtd</th><th class="p-2 text-center">Plantio</th>
            <th class="p-2 text-right">Valor mês</th></tr>
        </thead>
        <tbody>
          ${lotes.map(l => {
            const b = byId('bancadas', l.bancada_id);
            const e = b ? byId('estufas', b.estufa_id) : null;
            const fu = byId('funcionarios', l.funcionario_id);
            const c = valorPagamentoLoteMes(l, r.ano, r.mes);
            return `<tr class="border-t hover:bg-gray-50">
              <td class="p-2">${escapeHtml(e?.nome||'?')}</td>
              <td class="p-2 font-mono">${escapeHtml(b?.numero||'?')}</td>
              <td class="p-2">${escapeHtml(fu?.nome||'-')}</td>
              <td class="p-2">${escapeHtml(l.porta_enxerto||'-')}</td>
              <td class="p-2">${escapeHtml(l.variedade||'-')}</td>
              <td class="p-2 text-right">${fmtNum(l.qtd)}</td>
              <td class="p-2 text-center">${fmtDate(l.data_plantio)}</td>
              <td class="p-2 text-right font-mono">${fmtMoneyExato(c.valor)}</td>
            </tr>`;
          }).join('')}
          <tr class="bg-green-100 font-bold">
            <td class="p-2" colspan="5">TOTAL</td>
            <td class="p-2 text-right">${fmtNum(totMudas)}</td><td></td>
            <td class="p-2 text-right font-mono">${fmtMoneyExato(totVal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================
// ESTOQUE / VENDAS / ALERTAS / ESTUFAS / FUNCIONARIOS / PRECOS
// ============================================================
VIEWS.estoque = function() {
  const lotes = STATE.data.lotes.map(l => {
    const b = byId('bancadas', l.bancada_id);
    const e = b ? byId('estufas', b.estufa_id) : null;
    const saidas = STATE.data.estoque_movimentos.filter(m => m.lote_id === l.id && m.tipo !== 'entrada').reduce((s,m)=>s+m.qtd,0);
    return { l, b, e, disponivel: l.qtd - saidas };
  }).filter(x => x.disponivel > 0).sort((a,b) => (a.e?.nome||'').localeCompare(b.e?.nome||''));
  const totalDisp = lotes.reduce((s,x)=>s+x.disponivel,0);
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-4">📦 Estoque atual</h2>
    <div class="bg-white p-4 rounded-xl shadow mb-4"><div class="text-sm text-gray-500">Total disponível</div><div class="text-3xl font-bold text-green-700">${fmtNum(totalDisp)} mudas</div></div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left">
        <th class="p-2">Estufa</th><th>BC</th><th>Porta-enxerto</th><th>Variedade</th>
        <th class="text-right">Inicial</th><th class="text-right">Disponível</th><th>Plantio</th>
        ${isAdmin()?'<th></th>':''}
      </tr></thead>
      <tbody>${lotes.map(({l,b,e,disponivel}) => `<tr class="border-t hover:bg-gray-50">
        <td class="p-2">${escapeHtml(e?.nome||'?')}</td>
        <td>${escapeHtml(b?.numero||'?')}</td>
        <td>${escapeHtml(l.porta_enxerto||'-')}</td>
        <td>${escapeHtml(l.variedade||'-')}</td>
        <td class="text-right">${fmtNum(l.qtd)}</td>
        <td class="text-right font-bold">${fmtNum(disponivel)}</td>
        <td>${fmtDate(l.data_plantio)}</td>
        ${isAdmin()?`<td><button onclick="novaSaida('${l.id}')" class="text-blue-700 text-xs hover:underline">saída</button></td>`:''}
      </tr>`).join('')}</tbody>
    </table></div>
  `;
};

VIEWS.vendas = function() {
  const movs = STATE.data.estoque_movimentos.filter(m => m.tipo !== 'entrada').sort((a,b) => (b.data||'').localeCompare(a.data||''));
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">🛒 Vendas / Saídas</h2>
      ${isAdmin()?'<button onclick="novaSaida()" class="bg-green-700 text-white px-4 py-2 rounded">+ Nova saída</button>':''}
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left"><th class="p-2">Data</th><th>Tipo</th><th>Lote</th><th class="text-right">Qtd</th><th>Cliente</th><th>Obs.</th></tr></thead>
      <tbody>${movs.length===0?'<tr><td colspan="6" class="p-4 text-center text-gray-500">Nenhuma saída</td></tr>':movs.map(m => {
        const l = byId('lotes', m.lote_id);
        const b = l ? byId('bancadas', l.bancada_id) : null;
        const e = b ? byId('estufas', b.estufa_id) : null;
        const c = byId('clientes', m.cliente_id);
        return `<tr class="border-t">
          <td class="p-2">${fmtDate(m.data)}</td>
          <td>${m.tipo==='saida_total'?'Total':'Parcial'}</td>
          <td>${escapeHtml(e?.nome||'?')} BC ${escapeHtml(b?.numero||'?')}</td>
          <td class="text-right">${fmtNum(m.qtd)}</td>
          <td>${escapeHtml(c?.nome||'-')}</td>
          <td>${escapeHtml(m.observacao||'')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

window.novaSaida = function(loteId=null) {
  if (!isAdmin()) { toast('Apenas admin','error'); return; }
  const lotes = STATE.data.lotes.map(l => {
    const b = byId('bancadas', l.bancada_id);
    const e = b ? byId('estufas', b.estufa_id) : null;
    return { l, b, e, label: (e?.nome||'?')+' BC '+(b?.numero||'?')+' ('+(l.porta_enxerto||'-')+' / '+(l.variedade||'-')+' - '+l.qtd+')' };
  });
  openModal('Nova saída', `
    <form id="saidaForm" class="space-y-3">
      <div><label class="text-sm font-medium">Lote</label>
        <select id="sLote" required class="w-full mt-1 px-3 py-2 border rounded">
          ${lotes.map(x => '<option value="'+x.l.id+'"'+(x.l.id===loteId?' selected':'')+'>'+escapeHtml(x.label)+'</option>').join('')}
        </select></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-sm font-medium">Tipo</label>
          <select id="sTipo" class="w-full mt-1 px-3 py-2 border rounded">
            <option value="saida_parcial">Parcial</option><option value="saida_total">Total (bancada inteira)</option>
          </select></div>
        <div><label class="text-sm font-medium">Quantidade</label>
          <input id="sQtd" type="number" min="1" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      </div>
      <div><label class="text-sm font-medium">Cliente (opcional)</label>
        <input id="sCliente" type="text" placeholder="Nome do cliente" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Data</label>
        <input id="sData" type="date" required value="${new Date().toISOString().slice(0,10)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Observação</label>
        <textarea id="sObs" rows="2" class="w-full mt-1 px-3 py-2 border rounded"></textarea></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>
  `);
  $('#saidaForm').addEventListener('submit', async e => {
    e.preventDefault();
    let cliId = null;
    if ($('#sCliente').value.trim()) {
      const exist = STATE.data.clientes.find(c => c.nome.toLowerCase() === $('#sCliente').value.trim().toLowerCase());
      cliId = exist?.id || (await DB.insert('clientes', { nome: $('#sCliente').value.trim() })).id;
    }
    await DB.insert('estoque_movimentos', { lote_id: $('#sLote').value, tipo: $('#sTipo').value, qtd: parseInt($('#sQtd').value), cliente_id: cliId, data: $('#sData').value, observacao: $('#sObs').value || null });
    closeModal();
    setView('vendas');
    toast('Saída registrada', 'success');
  });
};

VIEWS.alertas = function() {
  const list = lotesParaExame();
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-4">⏰ Alertas — Mudas para exame</h2>
    <p class="text-sm text-gray-600 mb-4">Lotes com mais de 50 dias desde o enxerto. Cadastre a "data do enxerto" no lote para gerar alerta.</p>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left"><th class="p-2">Estufa</th><th>BC</th><th>Qtd</th><th>Porta-enxerto</th><th>Variedade</th><th>Data enxerto</th><th class="text-right">Dias</th></tr></thead>
      <tbody>${list.length===0?'<tr><td colspan="7" class="p-4 text-center text-gray-500">Nenhum alerta. Cadastre data do enxerto nos lotes.</td></tr>':list.map(l => {
        const b = byId('bancadas', l.bancada_id);
        const e = b ? byId('estufas', b.estufa_id) : null;
        return `<tr class="border-t hover:bg-orange-50">
          <td class="p-2">${escapeHtml(e?.nome||'?')}</td>
          <td>${escapeHtml(b?.numero||'?')}</td>
          <td>${fmtNum(l.qtd)}</td>
          <td>${escapeHtml(l.porta_enxerto||'-')}</td>
          <td>${escapeHtml(l.variedade||'-')}</td>
          <td>${fmtDate(l.data_enxerto)}</td>
          <td class="text-right font-bold text-orange-700">${l.diasDesdeEnxerto}d</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

VIEWS.estufas = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">🏠 Estufas / Bancadas</h2>
      ${isAdmin()?'<button onclick="novaEstufa()" class="bg-green-700 text-white px-4 py-2 rounded">+ Nova estufa</button>':''}
    </div>
    <p class="text-sm text-gray-600 mb-4">Gerencie estufas, funcionários padrão e veja as bancadas.</p>
    <div class="grid md:grid-cols-2 gap-4">
      ${STATE.data.estufas.map(e => {
        const bcs = STATE.data.bancadas.filter(b => b.estufa_id === e.id).sort((a,b) => a.numero.localeCompare(b.numero, undefined, {numeric:true}));
        const fp = (e.funcionarios_padrao||[]).map(id => byId('funcionarios', id)).filter(Boolean);
        return `<div class="bg-white rounded-xl shadow p-4">
          <div class="flex justify-between items-start">
            <div>
              <h3 class="font-bold">${escapeHtml(e.nome)}</h3>
              <p class="text-xs text-gray-500">${SITIO_LABEL[e.sitio]||e.sitio} · ${bcs.length} bancadas</p>
            </div>
            ${isAdmin()?`<div class="flex gap-2 text-xs">
              <button onclick="gerenciarFuncs('${e.id}')" class="text-blue-700 hover:underline">funcionários</button>
              <button onclick="deletarEstufa('${e.id}')" class="text-red-600 hover:underline">excluir</button>
            </div>`:''}
          </div>
          <div class="mt-3 pb-2 border-b">
            <p class="text-xs text-gray-500 mb-1">Funcionários desta estufa:</p>
            ${fp.length === 0
              ? '<p class="text-xs text-gray-400 italic">Nenhum cadastrado</p>'
              : '<div class="flex flex-wrap gap-1">'+fp.map(f => '<span class="badge bg-blue-100 text-blue-800">'+escapeHtml(f.nome)+'</span>').join('')+'</div>'}
          </div>
          <div class="mt-3">
            <p class="text-xs text-gray-500 mb-1">Bancadas (<span class="inline-block w-2 h-2 bg-green-500 rounded-full"></span> ativa, <span class="inline-block w-2 h-2 bg-yellow-500 rounded-full"></span> vencendo, <span class="inline-block w-2 h-2 bg-red-500 rounded-full"></span> vencida, <span class="inline-block w-2 h-2 bg-gray-400 rounded-full"></span> vazia):</p>
            <div class="flex flex-wrap gap-1">
              ${bcs.map(b => {
                const f = byId('funcionarios', b.funcionario_id);
                const s = statusBancada(b);
                return '<span class="badge '+s.cor.replace('border-','').replace(/border-[a-z]+-\d+ ?/g,'')+'" title="'+escapeHtml(f?.nome||'sem func.')+' — '+s.label+' '+s.detalhe+'">BC '+escapeHtml(b.numero)+'</span>';
              }).join('')}
              ${(() => {
                // Slots não cadastrados
                const numerosCadastrados = new Set(bcs.map(b => b.numero));
                const total = e.num_bancadas || 24;
                const slots = [];
                for (let i = 1; i <= total; i++) {
                  if (!numerosCadastrados.has(String(i))) slots.push(i);
                }
                return slots.length === 0 ? '' : slots.map(n => '<span class="badge bg-gray-100 text-gray-500" title="slot livre">BC '+n+'</span>').join('');
              })()}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
};

window.gerenciarFuncs = function(estufaId) {
  const e = byId('estufas', estufaId);
  const atuais = new Set(e.funcionarios_padrao || []);
  openModal('Funcionários da '+e.nome, `
    <p class="text-sm text-gray-600 mb-3">Marque os funcionários que trabalham nesta estufa.</p>
    <div class="space-y-2 max-h-80 overflow-y-auto border p-3 rounded">
      ${STATE.data.funcionarios.filter(f=>f.tipo==='por_muda').map(f => `
        <label class="flex items-center gap-2 hover:bg-gray-50 p-1 rounded cursor-pointer">
          <input type="checkbox" data-funcid="${f.id}" ${atuais.has(f.id)?'checked':''} class="gerenciarFuncCB">
          <span>${escapeHtml(f.nome)}</span>
        </label>
      `).join('')}
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
      <button onclick="salvarFuncsEstufa('${estufaId}')" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
    </div>
  `);
};
window.salvarFuncsEstufa = async function(estufaId) {
  const ids = [...$$('.gerenciarFuncCB')].filter(cb => cb.checked).map(cb => cb.dataset.funcid);
  await DB.update('estufas', estufaId, { funcionarios_padrao: ids });
  closeModal();
  setView('estufas');
  toast('Atualizado', 'success');
};

window.novaEstufa = function() {
  openModal('Nova estufa', `
    <form id="eForm" class="space-y-3">
      <div><label class="text-sm font-medium">Nome</label><input id="eNome" type="text" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Sítio</label>
        <select id="eSitio" required class="w-full mt-1 px-3 py-2 border rounded">
          <option value="sao_jose">São José</option><option value="bela_vista">Bela Vista</option><option value="santo_antonio">Santo Antônio</option>
        </select></div>
      <div><label class="text-sm font-medium">Nº de bancadas</label><input id="eNum" type="number" min="1" value="24" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#eForm').addEventListener('submit', async e => {
    e.preventDefault();
    await DB.insert('estufas', { nome: $('#eNome').value, sitio: $('#eSitio').value, num_bancadas: parseInt($('#eNum').value), funcionarios_padrao: [] });
    closeModal();
    setView('estufas');
  });
};
window.deletarEstufa = async function(id) {
  if (!confirm('Excluir estufa e todas as bancadas/lotes?')) return;
  const bcs = STATE.data.bancadas.filter(b => b.estufa_id === id).map(b => b.id);
  STATE.data.lotes = STATE.data.lotes.filter(l => !bcs.includes(l.bancada_id));
  STATE.data.bancadas = STATE.data.bancadas.filter(b => b.estufa_id !== id);
  await DB.remove('estufas', id);
  setView('estufas');
};

VIEWS.funcionarios = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">👥 Funcionários</h2>
      ${isAdmin()?'<button onclick="novoFunc()" class="bg-green-700 text-white px-4 py-2 rounded">+ Novo funcionário</button>':''}
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left">
        <th class="p-2">Nome</th><th>Tipo</th>
        <th class="text-right">Lotes</th><th class="text-right">Mudas</th>
        <th class="text-right">Salário fixo</th>
        ${isAdmin()?'<th></th>':''}
      </tr></thead>
      <tbody>${STATE.data.funcionarios.map(f => {
        const lts = STATE.data.lotes.filter(l => l.funcionario_id === f.id);
        const isFix = f.tipo === 'salario_fixo';
        return `<tr class="border-t hover:bg-gray-50">
          <td class="p-2 font-medium">${escapeHtml(f.nome)}</td>
          <td><span class="badge ${isFix?'bg-gray-200 text-gray-800':'bg-green-100 text-green-800'}">${isFix?'Salário fixo':'Por muda'}</span></td>
          <td class="text-right">${lts.length}</td>
          <td class="text-right">${fmtNum(lts.reduce((s,l)=>s+l.qtd,0))}</td>
          <td class="text-right font-mono">${isFix?fmtMoneyExato(f.salario_fixo):'-'}</td>
          ${isAdmin()?`<td class="text-right">
            <button onclick="editarFunc('${f.id}')" class="text-blue-700 text-xs hover:underline">editar</button>
            · <button onclick="deletarFunc('${f.id}')" class="text-red-600 text-xs hover:underline">excluir</button>
          </td>`:''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

function formFunc(func) {
  const isNew = !func;
  func = func || { nome:'', tipo:'por_muda', salario_fixo:null };
  openModal(isNew?'Novo funcionário':'Editar funcionário', `
    <form id="fForm" class="space-y-3">
      <div><label class="text-sm font-medium">Nome</label><input id="fNome" type="text" required value="${escapeHtml(func.nome)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Tipo de pagamento</label>
        <select id="fTipo" class="w-full mt-1 px-3 py-2 border rounded">
          <option value="por_muda" ${func.tipo==='por_muda'?'selected':''}>Por muda</option>
          <option value="salario_fixo" ${func.tipo==='salario_fixo'?'selected':''}>Salário fixo mensal</option>
        </select></div>
      <div id="fSalDiv" class="${func.tipo==='salario_fixo'?'':'hidden'}">
        <label class="text-sm font-medium">Valor do salário fixo (R$)</label>
        <input id="fSal" type="number" step="0.01" value="${func.salario_fixo||''}" class="w-full mt-1 px-3 py-2 border rounded">
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#fTipo').addEventListener('change', e => $('#fSalDiv').classList.toggle('hidden', e.target.value !== 'salario_fixo'));
  $('#fForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = { nome: $('#fNome').value.trim(), tipo: $('#fTipo').value, salario_fixo: $('#fTipo').value === 'salario_fixo' ? parseFloat($('#fSal').value)||0 : null };
    if (isNew) await DB.insert('funcionarios', payload);
    else await DB.update('funcionarios', func.id, payload);
    closeModal();
    setView('funcionarios');
  });
}
window.novoFunc = () => formFunc(null);
window.editarFunc = id => formFunc(byId('funcionarios', id));
window.deletarFunc = async id => { if (!confirm('Excluir?')) return; await DB.remove('funcionarios', id); setView('funcionarios'); };

VIEWS.precos = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">💵 Preços por sítio</h2>
      ${isAdmin()?'<button onclick="novoPreco()" class="bg-green-700 text-white px-4 py-2 rounded">+ Novo preço</button>':''}
    </div>
    <div class="bg-yellow-50 p-3 rounded text-sm mb-4">
      <b>Como funciona:</b> cada preço tem uma <b>data de vigência</b>. Lotes plantados a partir dessa data usam o novo preço; lotes antigos mantêm o preço da época.
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left">
        <th class="p-2">Sítio</th><th>Vigência</th>
        <th class="text-right">Total/muda</th><th class="text-right">Retenção</th>
        <th class="text-right">Parcela mensal</th>
        ${isAdmin()?'<th></th>':''}
      </tr></thead>
      <tbody>${STATE.data.precos_sitio.sort((a,b)=>a.sitio.localeCompare(b.sitio)||b.vigencia_inicio.localeCompare(a.vigencia_inicio)).map(p => {
        const parc = (p.valor_total - p.valor_final) / 12;
        return `<tr class="border-t">
          <td class="p-2">${SITIO_LABEL[p.sitio]||p.sitio}</td>
          <td>${fmtDate(p.vigencia_inicio)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(p.valor_total)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(p.valor_final)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(parc)}</td>
          ${isAdmin()?`<td><button onclick="deletarPreco('${p.id}')" class="text-red-600 text-xs hover:underline">excluir</button></td>`:''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

window.novoPreco = function() {
  openModal('Novo preço', `
    <form id="pForm" class="space-y-3">
      <div><label class="text-sm font-medium">Sítio</label>
        <select id="pSitio" required class="w-full mt-1 px-3 py-2 border rounded">
          <option value="sao_jose">São José</option><option value="bela_vista">Bela Vista</option><option value="santo_antonio">Santo Antônio</option>
        </select></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-sm font-medium">Valor total/muda</label><input id="pTot" type="number" step="0.01" required class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-sm font-medium">Retenção</label><input id="pFin" type="number" step="0.01" value="0.15" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      </div>
      <div><label class="text-sm font-medium">Vigência a partir de</label><input id="pVig" type="date" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#pForm').addEventListener('submit', async e => {
    e.preventDefault();
    await DB.insert('precos_sitio', { sitio: $('#pSitio').value, valor_total: parseFloat($('#pTot').value), valor_final: parseFloat($('#pFin').value), vigencia_inicio: $('#pVig').value });
    closeModal();
    setView('precos');
  });
};
window.deletarPreco = async id => { if (!confirm('Excluir?')) return; await DB.remove('precos_sitio', id); setView('precos'); };

// ============================================================
// PLAQUINHAS / ETIQUETAS (impressão MAPA)
// ============================================================
function getCfgPlaq() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('estufas_cfg_plaq') || '{}'); } catch(e){}
  return Object.assign({
    produtor: 'José Inacio Rosa',
    propriedade: 'Sitio São José',
    municipio: 'Monte Azul Paulista',
    processo: '20251257',
    lote: '0'
  }, cfg);
}
function setCfgPlaq(cfg) { localStorage.setItem('estufas_cfg_plaq', JSON.stringify(cfg)); }

VIEWS.plaquinhas = function() {
  STATE.plaqEst = STATE.plaqEst || (STATE.data.estufas[0]?.id || '');
  STATE.plaqSel = STATE.plaqSel || {};
  const e = byId('estufas', STATE.plaqEst);
  const bcs = e ? STATE.data.bancadas.filter(b => b.estufa_id === e.id)
    .sort((a,b) => a.numero.localeCompare(b.numero, undefined, {numeric:true})) : [];
  const cfg = getCfgPlaq();
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-1 no-print">🏷️ Plaquinhas / Etiquetas</h2>
    <p class="text-sm text-gray-500 mb-4 no-print">Selecione estufa e bancadas para gerar etiquetas no formato MAPA (croqui de produção). Imprime 2 por linha.</p>

    <div class="bg-white p-4 rounded-xl shadow mb-4 no-print">
      <h3 class="font-bold mb-3 text-sm">Dados fixos da propriedade</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div><label class="text-xs text-gray-500">Produtor</label><input id="pPdr" type="text" value="${escapeHtml(cfg.produtor)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-xs text-gray-500">Propriedade</label><input id="pPrp" type="text" value="${escapeHtml(cfg.propriedade)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-xs text-gray-500">Município</label><input id="pMun" type="text" value="${escapeHtml(cfg.municipio)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-xs text-gray-500">Nº Processo</label><input id="pPrc" type="text" value="${escapeHtml(cfg.processo)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-xs text-gray-500">Lote</label><input id="pLot" type="text" value="${escapeHtml(cfg.lote)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div class="flex items-end"><button onclick="salvarCfgPlaq()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm">Salvar dados fixos</button></div>
      </div>
    </div>

    <div class="bg-white p-4 rounded-xl shadow mb-4 no-print">
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-500 block">Estufa</label>
          <select onchange="STATE.plaqEst=this.value;STATE.plaqSel={};setView('plaquinhas')" class="px-3 py-2 border rounded text-sm">
            ${STATE.data.estufas.map(x => '<option value="'+x.id+'"'+(x.id===STATE.plaqEst?' selected':'')+'>'+escapeHtml(x.nome)+'</option>').join('')}
          </select>
        </div>
        <div class="flex-1"></div>
        <button onclick="plaqMarcarTodas(true)" class="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded text-sm">✓ Marcar todas</button>
        <button onclick="plaqMarcarTodas(false)" class="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded text-sm">✗ Desmarcar</button>
        <button onclick="gerarPlaquinhas()" class="bg-green-700 text-white px-4 py-2 rounded text-sm">🏷️ Gerar plaquinhas</button>
      </div>

      <p class="text-xs text-gray-500 mb-2">Marque as bancadas que vão gerar etiqueta. Cada uma pode ter seu próprio Nº de Processo (deixe em branco para usar o padrão da estufa):</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        ${bcs.map(b => {
          const lotes = STATE.data.lotes.filter(l => l.bancada_id === b.id);
          const tem = lotes.length > 0;
          const procAtual = STATE.plaqProc?.[b.id] ?? (b.processo || '');
          return `<label class="flex items-start gap-2 p-2 border rounded ${tem?'hover:bg-green-50':'opacity-50'} ${STATE.plaqSel[b.id]?'bg-green-50 border-green-400':''}">
            <input type="checkbox" ${tem?'':'disabled'} ${STATE.plaqSel[b.id]?'checked':''} onchange="STATE.plaqSel['${b.id}']=this.checked;setView('plaquinhas')" class="mt-1 cursor-pointer">
            <div class="flex-1 text-sm">
              <div class="font-mono font-bold">BC ${escapeHtml(b.numero)}</div>
              ${lotes.map(l => '<div class="text-xs text-gray-600">'+escapeHtml(l.porta_enxerto||'-')+' / '+escapeHtml(l.variedade||'sem enxerto')+' · '+fmtNum(l.qtd)+'</div>').join('')}
              ${!tem?'<div class="text-xs text-gray-400 italic">sem lote</div>':''}
              ${tem ? `<div class="mt-1 flex items-center gap-1"><span class="text-xs text-gray-500">Nº Proc.:</span><input type="text" value="${escapeHtml(procAtual)}" placeholder="${escapeHtml(cfg.processo)}" onchange="salvarProcBancada('${b.id}', this.value)" class="flex-1 px-1 py-0.5 text-xs border rounded font-mono" onclick="event.preventDefault();event.stopPropagation()"></div>` : ''}
            </div>
          </label>`;
        }).join('')}
      </div>
    </div>

    <div id="plaqResult"></div>
  `;
};

window.salvarProcBancada = async function(bancadaId, valor) {
  STATE.plaqProc = STATE.plaqProc || {};
  STATE.plaqProc[bancadaId] = valor;
  // Persiste no banco também (assim fica salvo entre sessões)
  try { await DB.update('bancadas', bancadaId, { processo: valor || null }); } catch(e) { console.error(e); }
  toast('Nº Processo da bancada salvo', 'success');
};

window.salvarCfgPlaq = function() {
  setCfgPlaq({
    produtor: $('#pPdr').value, propriedade: $('#pPrp').value, municipio: $('#pMun').value,
    processo: $('#pPrc').value, lote: $('#pLot').value
  });
  toast('Dados salvos', 'success');
};

window.plaqMarcarTodas = function(marcar) {
  const e = byId('estufas', STATE.plaqEst);
  if (!e) return;
  const bcs = STATE.data.bancadas.filter(b => b.estufa_id === e.id);
  STATE.plaqSel = STATE.plaqSel || {};
  for (const b of bcs) {
    const tem = STATE.data.lotes.some(l => l.bancada_id === b.id);
    if (tem) STATE.plaqSel[b.id] = marcar;
  }
  setView('plaquinhas');
};

window.gerarPlaquinhas = function() {
  const cfg = {
    produtor: $('#pPdr').value, propriedade: $('#pPrp').value, municipio: $('#pMun').value,
    processo: $('#pPrc').value, lote: $('#pLot').value
  };
  setCfgPlaq(cfg);
  const e = byId('estufas', STATE.plaqEst);
  const bancadasSel = Object.keys(STATE.plaqSel).filter(id => STATE.plaqSel[id]);
  if (bancadasSel.length === 0) { toast('Selecione ao menos 1 bancada', 'error'); return; }
  // Para cada bancada selecionada, gera UMA etiqueta por lote
  const etiquetas = [];
  for (const bid of bancadasSel) {
    const b = byId('bancadas', bid);
    if (!b) continue;
    const lotes = STATE.data.lotes.filter(l => l.bancada_id === bid);
    for (const l of lotes) etiquetas.push({ estufa:e, bancada:b, lote:l });
  }
  if (etiquetas.length === 0) { toast('Bancadas sem lotes', 'error'); return; }

  function renderEtiqueta(et) {
    const l = et.lote;
    // Cada bancada pode ter seu próprio Nº Processo (override do padrão)
    const procBancada = (STATE.plaqProc?.[et.bancada.id]) || et.bancada.processo || cfg.processo;
    return `
      <div class="border-2 border-black p-2 text-xs" style="page-break-inside:avoid">
        <div class="grid grid-cols-[1fr_60px] gap-1">
          <div class="space-y-1">
            <div><b>Produtor:</b> ${escapeHtml(cfg.produtor)}</div>
            <div><b>Propriedade:</b> ${escapeHtml(cfg.propriedade)}</div>
            <div class="flex gap-2"><span><b>Nº Processo:</b> ${escapeHtml(procBancada)}</span><span><b>Lote:</b> ${escapeHtml(cfg.lote)}</span></div>
            <div class="flex gap-2"><span><b>Bancada:</b> ${escapeHtml(et.bancada.numero)}</span><span><b>Quantidade:</b> ${fmtNum(l.qtd)}</span></div>
            <div class="border-t pt-1 mt-1"><b>Porta enxerto:</b> <span class="float-right text-[10px]"><b>Data plantio:</b> ${fmtDate(l.data_plantio)}</span></div>
            <div class="pl-3"><b>Espécie:</b> ${escapeHtml((l.porta_enxerto||'').split(' ')[0] || '-')}</div>
            <div class="pl-3"><b>Cultivar:</b> ${escapeHtml(l.porta_enxerto||'-')}</div>
            <div class="border-t pt-1 mt-1"><b>Enxertia:</b> <span class="float-right text-[10px]"><b>Data enxertia:</b> ${fmtDate(l.data_enxerto)}</span></div>
            <div class="pl-3"><b>Espécie:</b> ${escapeHtml(l.variedade ? 'Laranja' : '—')}</div>
            <div class="pl-3"><b>Cultivar:</b> ${escapeHtml(l.variedade || 'sem enxerto')}</div>
          </div>
          <div class="flex flex-col items-center justify-center bg-gray-100 border border-gray-400 rounded p-1">
            <div class="text-[8px] font-bold">ESTUFA</div>
            <div class="text-[8px]">N°</div>
            <div class="text-3xl font-black">${escapeHtml(et.estufa.nome.replace(/[^0-9]/g,'') || '?')}</div>
            <div class="text-[8px] mt-1">BC</div>
            <div class="text-xl font-bold">${escapeHtml(et.bancada.numero)}</div>
          </div>
        </div>
      </div>`;
  }

  $('#plaqResult').innerHTML = `
    <div class="mb-3 no-print flex items-center justify-between bg-blue-50 border border-blue-200 p-3 rounded">
      <span class="text-sm"><b>${etiquetas.length}</b> etiquetas geradas. Confira e clique em imprimir.</span>
      <button onclick="window.print()" class="bg-green-700 text-white px-4 py-2 rounded text-sm">🖨️ Imprimir</button>
    </div>
    <div class="bg-white p-4 rounded-xl shadow print-area">
      <div class="text-center mb-3 print-area">
        <h3 class="font-bold">PLANO DE PRODUÇÃO — ${escapeHtml(cfg.propriedade)}</h3>
        <p class="text-xs text-gray-600">${escapeHtml(cfg.municipio)} · Nº Processo ${escapeHtml(cfg.processo)} · Estufa ${escapeHtml(e.nome)}</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${etiquetas.map(renderEtiqueta).join('')}
      </div>
    </div>
  `;
  window.scrollTo({ top: $('#plaqResult').offsetTop, behavior: 'smooth' });
};

VIEWS.importar = function() {
  $('#content').innerHTML = `
    <h2 class="text-2xl font-bold mb-4">📤 Importar Excel</h2>
    <div class="bg-white p-4 rounded-xl shadow mb-4">
      <p class="text-sm text-gray-600 mb-3">Selecione um arquivo .xlsx, .xls ou .ods.</p>
      <input type="file" id="impFile" accept=".xlsx,.xls,.ods,.csv" class="block">
      <div id="impSheets" class="mt-4"></div>
      <div id="impMap" class="mt-4"></div>
      <div id="impResult" class="mt-4"></div>
    </div>
  `;
  let workbook = null;
  $('#impFile').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type:'array', cellDates: true });
    $('#impSheets').innerHTML = `
      <label class="text-sm font-medium">Aba</label>
      <select id="impSheet" class="px-3 py-2 border rounded ml-2">
        ${workbook.SheetNames.map(s => '<option>'+escapeHtml(s)+'</option>').join('')}
      </select>
      <button id="impLoadSheet" class="ml-2 bg-green-700 text-white px-4 py-2 rounded">Carregar</button>
    `;
    $('#impLoadSheet').onclick = () => loadSheet(workbook);
  });

  function loadSheet(wb) {
    const sheet = wb.Sheets[$('#impSheet').value];
    const json = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
    const headerRow = json.findIndex(r => r.some(c => /banca|bancada|qtd|quantidade/i.test(String(c))));
    const headers = headerRow >= 0 ? json[headerRow] : json[0];
    const rows = json.slice(headerRow+1);
    function guess(key, h) {
      const s = String(h||'').toLowerCase();
      return ({bc:/bc|banca|bancada/.test(s),qtd:/qtd|quant/.test(s),porta:/porta/.test(s),var:/vari/.test(s),plantio:/plantio|data/.test(s),nome:/nome|funcion/.test(s)})[key];
    }
    $('#impMap').innerHTML = `
      <h4 class="font-bold mb-2">Mapear colunas</h4>
      <div class="grid grid-cols-2 gap-2 text-sm">
        ${[['bc','Bancada'],['qtd','Quantidade'],['porta','Porta-enxerto'],['var','Variedade'],['plantio','Plantio'],['nome','Funcionário']].map(([k,lbl])=>`
          <div><label>${lbl}</label>
            <select id="map_${k}" class="w-full px-2 py-1 border rounded">
              <option value="-1">— ignorar —</option>
              ${headers.map((h,i)=>'<option value="'+i+'"'+(guess(k,h)?' selected':'')+'>'+escapeHtml(String(h))+'</option>').join('')}
            </select></div>
        `).join('')}
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><label>Estufa destino</label>
          <select id="impEst" class="w-full px-2 py-1 border rounded">
            ${STATE.data.estufas.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.nome)+'</option>').join('')}
          </select></div>
        <div><label>Funcionário padrão</label>
          <select id="impFunc" class="w-full px-2 py-1 border rounded">
            <option value="">—</option>
            ${STATE.data.funcionarios.map(f=>'<option value="'+f.id+'">'+escapeHtml(f.nome)+'</option>').join('')}
          </select></div>
      </div>
      <button id="impGo" class="mt-3 bg-green-700 text-white px-4 py-2 rounded">Importar lotes</button>
    `;
    $('#impGo').onclick = () => doImport(rows);
  }

  async function doImport(rows) {
    const map = {};
    ['bc','qtd','porta','var','plantio','nome'].forEach(k => map[k] = parseInt($('#map_'+k).value));
    const estufaId = $('#impEst').value;
    const funcDefault = $('#impFunc').value;
    let ok=0, skip=0;
    for (const r of rows) {
      const bc = String(r[map.bc]||'').trim();
      const qtd = parseInt(r[map.qtd]) || 0;
      if (!bc || qtd <= 0) { skip++; continue; }
      let plantio = r[map.plantio];
      if (plantio instanceof Date) plantio = plantio.toISOString().slice(0,10);
      else if (typeof plantio === 'number') plantio = new Date(Math.round((plantio - 25569) * 86400 * 1000)).toISOString().slice(0,10);
      else plantio = String(plantio||'');
      if (!/^\d{4}-\d{2}-\d{2}/.test(plantio)) { skip++; continue; }
      const nomeFunc = String(r[map.nome]||'').trim();
      let funcId = funcDefault || null;
      if (nomeFunc) {
        let f = STATE.data.funcionarios.find(x => x.nome.toLowerCase() === nomeFunc.toLowerCase());
        if (!f) f = await DB.insert('funcionarios', { nome:nomeFunc, tipo:'por_muda', salario_fixo:null });
        funcId = f.id;
      }
      let banc = STATE.data.bancadas.find(b => b.estufa_id === estufaId && b.numero === bc);
      if (!banc) banc = await DB.insert('bancadas', { estufa_id:estufaId, numero:bc, funcionario_id:funcId });
      await DB.insert('lotes', { bancada_id:banc.id, funcionario_id:funcId, qtd, porta_enxerto: String(r[map.porta]||'').trim() || null, variedade: String(r[map.var]||'').trim() || null, tipo:'muda_normal', data_plantio:plantio.slice(0,10), data_enxerto:null });
      ok++;
    }
    $('#impResult').innerHTML = '<div class="bg-green-50 p-3 rounded text-sm"><b>'+ok+'</b> importados, <b>'+skip+'</b> ignorados.</div>';
    toast('Importação OK', 'success');
  }
};

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

})();
fgSave').addEventListener('click', () => {
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

})();
