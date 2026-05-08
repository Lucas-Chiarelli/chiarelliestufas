
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
            if (idade >= 12 && idade <= 13) status = `<span class="badge bg-yellow-100 text-yellow-800">${idade}m vencendo</span>`;
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
