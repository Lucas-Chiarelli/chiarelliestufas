
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
