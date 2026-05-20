// ============================================================
// SISTEMA CHIARELLI ESTUFAS
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
// IMPORTAR
// ============================================================
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
