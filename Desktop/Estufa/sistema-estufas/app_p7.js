
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
