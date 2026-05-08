
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
      <p class="text-xs text-blue-700 mt-2">Fórmula: (preço − retenção) ÷ 12 × qtd mudas. Subtotal pode ser maior se houver retenção do 12º mês.</p>
    </div>
  `;
}
