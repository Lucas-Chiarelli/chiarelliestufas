
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
