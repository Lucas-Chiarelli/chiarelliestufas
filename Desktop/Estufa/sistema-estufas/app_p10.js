
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
