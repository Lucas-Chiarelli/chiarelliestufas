
VIEWS.estufas = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">🏠 Estufas / Bancadas</h2>
      ${isAdmin()?'<button onclick="novaEstufa()" class="bg-green-700 text-white px-4 py-2 rounded">+ Nova estufa</button>':''}
    </div>
    <p class="text-sm text-gray-600 mb-4">Gerencie estufas, funcionários padrão e veja as bancadas.</p>
    <div class="grid md:grid-cols-2 gap-4">
      ${STATE.data.estufas.map(e => {
        const bcs = STATE.data.bancadas.filter(b => b.estufa_id === e.id).sort((a,b) => a.numero.localeCompare(b.numero, undefined, {numeric:true}));
        const fp = (e.funcionarios_padrao||[]).map(id => byId('funcionarios', id)).filter(Boolean);
        return `<div class="bg-white rounded-xl shadow p-4">
          <div class="flex justify-between items-start">
            <div>
              <h3 class="font-bold">${escapeHtml(e.nome)}</h3>
              <p class="text-xs text-gray-500">${SITIO_LABEL[e.sitio]||e.sitio} · ${bcs.length} bancadas</p>
            </div>
            ${isAdmin()?`<div class="flex gap-2 text-xs">
              <button onclick="gerenciarFuncs('${e.id}')" class="text-blue-700 hover:underline">funcionários</button>
              <button onclick="deletarEstufa('${e.id}')" class="text-red-600 hover:underline">excluir</button>
            </div>`:''}
          </div>
          <div class="mt-3 pb-2 border-b">
            <p class="text-xs text-gray-500 mb-1">Funcionários desta estufa:</p>
            ${fp.length === 0
              ? '<p class="text-xs text-gray-400 italic">Nenhum cadastrado</p>'
              : '<div class="flex flex-wrap gap-1">'+fp.map(f => '<span class="badge bg-blue-100 text-blue-800">'+escapeHtml(f.nome)+'</span>').join('')+'</div>'}
          </div>
          <div class="mt-3">
            <p class="text-xs text-gray-500 mb-1">Bancadas:</p>
            <div class="flex flex-wrap gap-1">
              ${bcs.map(b => {
                const f = byId('funcionarios', b.funcionario_id);
                return '<span class="badge bg-green-100 text-green-800" title="'+escapeHtml(f?.nome||'sem func.')+'">BC '+escapeHtml(b.numero)+'</span>';
              }).join('')}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
};

window.gerenciarFuncs = function(estufaId) {
  const e = byId('estufas', estufaId);
  const atuais = new Set(e.funcionarios_padrao || []);
  openModal('Funcionários da '+e.nome, `
    <p class="text-sm text-gray-600 mb-3">Marque os funcionários que trabalham nesta estufa.</p>
    <div class="space-y-2 max-h-80 overflow-y-auto border p-3 rounded">
      ${STATE.data.funcionarios.filter(f=>f.tipo==='por_muda').map(f => `
        <label class="flex items-center gap-2 hover:bg-gray-50 p-1 rounded cursor-pointer">
          <input type="checkbox" data-funcid="${f.id}" ${atuais.has(f.id)?'checked':''} class="gerenciarFuncCB">
          <span>${escapeHtml(f.nome)}</span>
        </label>
      `).join('')}
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
      <button onclick="salvarFuncsEstufa('${estufaId}')" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
    </div>
  `);
};
window.salvarFuncsEstufa = async function(estufaId) {
  const ids = [...$$('.gerenciarFuncCB')].filter(cb => cb.checked).map(cb => cb.dataset.funcid);
  await DB.update('estufas', estufaId, { funcionarios_padrao: ids });
  closeModal();
  setView('estufas');
  toast('Atualizado', 'success');
};

window.novaEstufa = function() {
  openModal('Nova estufa', `
    <form id="eForm" class="space-y-3">
      <div><label class="text-sm font-medium">Nome</label><input id="eNome" type="text" required class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Sítio</label>
        <select id="eSitio" required class="w-full mt-1 px-3 py-2 border rounded">
          <option value="sao_jose">São José</option><option value="bela_vista">Bela Vista</option><option value="santo_antonio">Santo Antônio</option>
        </select></div>
      <div><label class="text-sm font-medium">Nº de bancadas</label><input id="eNum" type="number" min="1" value="24" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#eForm').addEventListener('submit', async e => {
    e.preventDefault();
    await DB.insert('estufas', { nome: $('#eNome').value, sitio: $('#eSitio').value, num_bancadas: parseInt($('#eNum').value), funcionarios_padrao: [] });
    closeModal();
    setView('estufas');
  });
};
window.deletarEstufa = async function(id) {
  if (!confirm('Excluir estufa e todas as bancadas/lotes?')) return;
  const bcs = STATE.data.bancadas.filter(b => b.estufa_id === id).map(b => b.id);
  STATE.data.lotes = STATE.data.lotes.filter(l => !bcs.includes(l.bancada_id));
  STATE.data.bancadas = STATE.data.bancadas.filter(b => b.estufa_id !== id);
  await DB.remove('estufas', id);
  setView('estufas');
};

VIEWS.funcionarios = function() {
  $('#content').innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">👥 Funcionários</h2>
      ${isAdmin()?'<button onclick="novoFunc()" class="bg-green-700 text-white px-4 py-2 rounded">+ Novo funcionário</button>':''}
    </div>
    <div class="bg-white rounded-xl shadow overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr class="text-left">
        <th class="p-2">Nome</th><th>Tipo</th>
        <th class="text-right">Lotes</th><th class="text-right">Mudas</th>
        <th class="text-right">Salário fixo</th>
        ${isAdmin()?'<th></th>':''}
      </tr></thead>
      <tbody>${STATE.data.funcionarios.map(f => {
        const lts = STATE.data.lotes.filter(l => l.funcionario_id === f.id);
        const isFix = f.tipo === 'salario_fixo';
        return `<tr class="border-t hover:bg-gray-50">
          <td class="p-2 font-medium">${escapeHtml(f.nome)}</td>
          <td><span class="badge ${isFix?'bg-gray-200 text-gray-800':'bg-green-100 text-green-800'}">${isFix?'Salário fixo':'Por muda'}</span></td>
          <td class="text-right">${lts.length}</td>
          <td class="text-right">${fmtNum(lts.reduce((s,l)=>s+l.qtd,0))}</td>
          <td class="text-right font-mono">${isFix?fmtMoneyExato(f.salario_fixo):'-'}</td>
          ${isAdmin()?`<td class="text-right">
            <button onclick="editarFunc('${f.id}')" class="text-blue-700 text-xs hover:underline">editar</button>
            · <button onclick="deletarFunc('${f.id}')" class="text-red-600 text-xs hover:underline">excluir</button>
          </td>`:''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;
};

function formFunc(func) {
  const isNew = !func;
  func = func || { nome:'', tipo:'por_muda', salario_fixo:null };
  openModal(isNew?'Novo funcionário':'Editar funcionário', `
    <form id="fForm" class="space-y-3">
      <div><label class="text-sm font-medium">Nome</label><input id="fNome" type="text" required value="${escapeHtml(func.nome)}" class="w-full mt-1 px-3 py-2 border rounded"></div>
      <div><label class="text-sm font-medium">Tipo de pagamento</label>
        <select id="fTipo" class="w-full mt-1 px-3 py-2 border rounded">
          <option value="por_muda" ${func.tipo==='por_muda'?'selected':''}>Por muda</option>
          <option value="salario_fixo" ${func.tipo==='salario_fixo'?'selected':''}>Salário fixo mensal</option>
        </select></div>
      <div id="fSalDiv" class="${func.tipo==='salario_fixo'?'':'hidden'}">
        <label class="text-sm font-medium">Valor do salário fixo (R$)</label>
        <input id="fSal" type="number" step="0.01" value="${func.salario_fixo||''}" class="w-full mt-1 px-3 py-2 border rounded">
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-green-700 text-white rounded">Salvar</button>
      </div>
    </form>`);
  $('#fTipo').addEventListener('change', e => $('#fSalDiv').classList.toggle('hidden', e.target.value !== 'salario_fixo'));
  $('#fForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = { nome: $('#fNome').value.trim(), tipo: $('#fTipo').value, salario_fixo: $('#fTipo').value === 'salario_fixo' ? parseFloat($('#fSal').value)||0 : null };
    if (isNew) await DB.insert('funcionarios', payload);
    else await DB.update('funcionarios', func.id, payload);
    closeModal();
    setView('funcionarios');
  });
}
window.novoFunc = () => formFunc(null);
window.editarFunc = id => formFunc(byId('funcionarios', id));
window.deletarFunc = async id => { if (!confirm('Excluir?')) return; await DB.remove('funcionarios', id); setView('funcionarios'); };
