
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
