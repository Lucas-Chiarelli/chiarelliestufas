
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
  if (idd <= 11) return { valor:parc, parcela:idd, motivo:'parcela mensal', valorUnitario:unit, valorTotal:vt, valorFinal:vf };
  if (idd === 12) return { valor:parc+ret, parcela:12, motivo:'parcela final + retencao', valorUnitario:unit, valorTotal:vt, valorFinal:vf };
  if (idd === 13) {
    const pago = STATE.data.parcelas_pagas.some(p => p.lote_id===lote.id && p.observacao && p.observacao.includes('retencao'));
    if (!pago) return { valor:ret, parcela:13, motivo:'retencao atrasada', valorUnitario:unit };
    return { valor:0, parcela:13, motivo:'ja pago', valorUnitario:unit };
  }
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

function lotesVencidos() {
  const today = new Date();
  return STATE.data.lotes
    .map(l => ({ ...l, idade: idadeMeses(l.data_plantio, today) }))
    .filter(l => l.idade > 13);
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
