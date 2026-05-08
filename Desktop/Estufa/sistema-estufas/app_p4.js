
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
      <div class="bg-white p-4 rounded-xl shadow cursor-pointer hover:bg-red-50" onclick="setView('vencidos')"><div class="text-xs text-gray-500 uppercase">Bancadas vencidas</div><div class="text-2xl font-bold text-red-700">${venc.length}</div><div class="text-xs text-gray-400 mt-1">${fmtNum(totMudasVenc)} mudas (>13m) — clique para ver</div></div>
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
