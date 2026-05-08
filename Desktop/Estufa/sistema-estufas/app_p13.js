
VIEWS.precos = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">💵 Preços por sítio</h2>
      ${isAdmin()?'<button onclick="novoPreco()" class="bg-green-700 text-white px-4 py-2 rounded">+ Novo preço</button>':''}
    </div>
    <div class="bg-yellow-50 p-3 rounded text-sm mb-4">
      <b>Como funciona:</b> cada preço tem uma <b>data de vigência</b>. Lotes plantados a partir dessa data usam o novo preço; lotes antigos mantêm o preço da época.
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left">
        <th class="p-2">Sítio</th><th>Vigência</th>
        <th class="text-right">Total/muda</th><th class="text-right">Retenção</th>
        <th class="text-right">Parcela mensal</th>
        ${isAdmin()?'<th></th>':''}
      </tr></thead>
      <tbody>${STATE.data.precos_sitio.sort((a,b)=>a.sitio.localeCompare(b.sitio)||b.vigencia_inicio.localeCompare(a.vigencia_inicio)).map(p => {
        const parc = (p.valor_total - p.valor_final) / 12;
        return `<tr class="border-t">
          <td class="p-2">${SITIO_LABEL[p.sitio]||p.sitio}</td>
          <td>${fmtDate(p.vigencia_inicio)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(p.valor_total)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(p.valor_final)}</td>
          <td class="text-right font-mono">${fmtMoneyExato(parc)}</td>
          ${isAdmin()?`<td><button onclick="deletarPreco('${p.id}')" class="text-red-600 text-xs hover:underline">excluir</button></td>`:''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

window.novoPreco = function() {
  openModal('Novo preço', `
    <form id="pForm" class="space-y-3">
      <div><label class="text-sm font-medium">Sítio</label>
        <select id="pSitio" required class="w-full mt-1 px-3 py-2 border rounded">
          <option value="sao_jose">São José</option><option value="bela_vista">Bela Vista</option><option value="santo_antonio">Santo Antônio</option>
        </select></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-sm font-medium">Valor total/muda</label><input id="pTot" type="number" step="0.01" required class="w-full mt-1 px-3 py-2 border rounded"></div>
        <div><label class="text-sm font-medium">Retenção</label><input id="pFin" type="number" step="0.01" value="0.15" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      </div>
      <div><label class="text-sm font-medium">Vigência a partir de</label><input id="pVig" type="date" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#pForm').addEventListener('submit', async e => {
    e.preventDefault();
    await DB.insert('precos_sitio', { sitio: $('#pSitio').value, valor_total: parseFloat($('#pTot').value), valor_final: parseFloat($('#pFin').value), vigencia_inicio: $('#pVig').value });
    closeModal();
    setView('precos');
  });
};
window.deletarPreco = async id => { if (!confirm('Excluir?')) return; await DB.remove('precos_sitio', id); setView('precos'); };

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
