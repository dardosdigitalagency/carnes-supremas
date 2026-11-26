(async function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const clone = value => structuredClone(value);
  const categories = { res: 'Res', cerdo: 'Cerdo', pollo: 'Pollo', premium: 'Premium' };
  const state = { products: [], sheets: [], product: null, sheet: null, dirty: false, busy: false };
  let messageTimer;
  const field = name => $('#sheet-form').elements.namedItem(name);
  const safeImage = value => {
    const input = String(value || '');
    if (/^\/?(?:assets|uploads)\/[a-z0-9_./-]+$/i.test(input) && !input.split('/').some(part => part.startsWith('.'))) return input;
    try { const url = new URL(input); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch (_) {}
    return '';
  };
  function notify(message, error = false) {
    clearTimeout(messageTimer);
    $('#app-message').textContent = message;
    $('#app-message').classList.toggle('is-error', error);
    messageTimer = setTimeout(() => { $('#app-message').textContent = ''; }, error ? 12000 : 6000);
  }
  function setDirty(value = true) {
    state.dirty = value;
    $('#save-state').textContent = value ? 'Cambios sin guardar' : state.sheet?.updated_at ? `Guardado ${new Date(state.sheet.updated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Ficha nueva';
  }
  function confirmDiscard() { return !state.dirty || confirm('Tienes cambios sin guardar. ¿Quieres salir sin guardarlos?'); }
  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll('#sheet-form input, #sheet-form select, #sheet-form textarea, #sheet-form button, .editor-actions button, #back-library, #go-library, #logout').forEach(control => {
      if (value) { control.dataset.wasDisabled = String(control.disabled); control.disabled = true; }
      else { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled; }
    });
  }
  function statusFor(product) {
    if (product.archived) return { id: 'archived', text: 'Archivado' };
    const sheet = state.sheets.find(item => item.product_id === product.id);
    return sheet ? { id: sheet.status, text: sheet.status === 'published' ? 'Publicada' : 'Borrador' } : { id: 'empty', text: 'Sin ficha' };
  }
  function renderLibrary() {
    const query = $('#search').value.trim().toLocaleLowerCase('es-MX');
    const category = $('#category-filter').value;
    const filter = $('#status-filter').value;
    const active = state.products.filter(product => !product.archived);
    const published = state.sheets.filter(sheet => sheet.status === 'published' && active.some(product => product.id === sheet.product_id)).length;
    const drafts = state.sheets.filter(sheet => sheet.status === 'draft' && active.some(product => product.id === sheet.product_id)).length;
    $('#library-summary').innerHTML = `<span><strong>${active.length}</strong> productos</span><span><strong>${published}</strong> fichas publicadas</span><span><strong>${drafts}</strong> borradores</span>`;
    const products = state.products.filter(product => {
      const sheet = state.sheets.find(item => item.product_id === product.id);
      return (filter === 'archived' ? product.archived : !product.archived) && (!category || category === product.category) && (!filter || statusFor(product).id === filter) && (!query || `${product.name} ${sheet?.sku || ''}`.toLocaleLowerCase('es-MX').includes(query));
    }).sort((a, b) => a.sort_order - b.sort_order);
    $('#product-list').innerHTML = products.length ? products.map(product => {
      const sheet = state.sheets.find(item => item.product_id === product.id);
      const status = statusFor(product);
      const date = sheet?.updated_at ? new Date(sheet.updated_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—';
      return `<div class="product-row"><div class="product-identity"><img src="${escape(safeImage(product.image_url) || 'assets/logo-blanco.svg')}" alt=""><div><strong>${escape(product.name)}</strong><small>${sheet?.sku ? `SKU ${escape(sheet.sku)}` : 'Sin código asignado'}</small></div></div><span class="product-category">${categories[product.category] || escape(product.category)}</span><span class="status-badge ${status.id}">${status.text}</span><span class="product-updated">${date}</span><button class="btn" data-edit-product="${escape(product.id)}" aria-label="${sheet ? 'Editar ficha de' : 'Crear ficha para'} ${escape(product.name)}">${sheet ? 'Editar' : 'Crear ficha'}</button></div>`;
    }).join('') : '<div class="empty-state"><strong>No hay productos con estos filtros.</strong>Prueba otro nombre o cambia los filtros.</div>';
    $('#list-count').textContent = `${products.length} ${products.length === 1 ? 'producto' : 'productos'} en esta vista`;
  }
  function blankSheet(product) {
    return { product_id: product.id, title: product.name, description: '', image_url: product.image_url || '', image_alt: product.image_alt || product.name, sku: '', status: 'draft', data: { metadata: { origin: '', state: '', allergens: '', pieces: '', weight: '' }, sections: SheetTemplate.blankSections() } };
  }
  function editProduct(id, skipConfirm = false) {
    if (state.busy) return;
    if (!skipConfirm && !confirmDiscard()) return;
    const product = state.products.find(item => item.id === id);
    if (!product) return;
    state.product = clone(product);
    state.sheet = clone(state.sheets.find(item => item.product_id === id) || blankSheet(product));
    state.sheet.data ||= { metadata: {}, sections: [] };
    state.sheet.data.metadata ||= {};
    state.sheet.data.sections = SheetTemplate.normalizeSections(state.sheet.data.sections);
    $('#editor-product').innerHTML = state.products.map(item => `<option value="${escape(item.id)}">${escape(item.name)}${item.archived ? ' (archivado)' : ''}</option>`).join('');
    $('#editor-product').value = id;
    field('product_name').value = product.name;
    field('category').value = product.category;
    for (const name of ['title', 'description', 'image_url', 'image_alt', 'sku']) field(name).value = state.sheet[name] || '';
    for (const name of ['origin', 'state', 'allergens', 'pieces', 'weight']) field(name).value = state.sheet.data.metadata[name] || '';
    $('#editor-heading').textContent = product.name;
    const status = statusFor(product);
    $('#sheet-state').className = `status-badge ${status.id}`;
    $('#sheet-state').textContent = status.text;
    $('#archive-product').textContent = product.archived ? 'Restaurar producto' : 'Archivar producto';
    $('#library-view').hidden = true;
    $('#editor-view').hidden = false;
    $('#workspace-name').textContent = 'Editor de ficha';
    renderSections(); updateSummary(); setDirty(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function collect() {
    state.product.name = field('product_name').value.trim();
    state.product.category = field('category').value;
    for (const name of ['title', 'description', 'image_url', 'image_alt', 'sku']) state.sheet[name] = field(name).value.trim();
    for (const name of ['origin', 'state', 'allergens', 'pieces', 'weight']) state.sheet.data.metadata[name] = field(name).value.trim();
    return state.sheet;
  }
  function updateSummary() {
    const sheet = collect();
    const image = safeImage(sheet.image_url);
    $('#editor-image').src = image || 'assets/logo-blanco.svg';
    $('#summary-image').src = image || 'assets/logo-blanco.svg';
    $('#summary-title').textContent = sheet.title || 'Título de tu ficha';
    $('#summary-description').textContent = sheet.description || 'La descripción de tu producto aparecerá aquí.';
    $('#summary-sku').textContent = sheet.sku ? `SKU ${sheet.sku}` : '';
    const metadata = sheet.data.metadata;
    $('#summary-meta').textContent = [metadata.state, metadata.pieces && `${metadata.pieces} piezas`, metadata.weight].filter(Boolean).join(' · ');
  }
  function renderSections() {
    $('#sheet-sections').innerHTML = state.sheet.data.sections.map((section,index) => {
      const header = '<div class="section-heading"><h3>' + escape(section.title) + '</h3><span class="section-number">' + String(index + 1).padStart(2,'0') + '</span></div>';
      const description = '<label>Descripción de la sección <span class="optional">(opcional)</span><textarea rows="2" data-section-description="' + index + '" maxlength="20000">' + escape(section.description) + '</textarea></label>';
      let content;
      if (section.kind === 'table') {
        content = section.rows.map((row,rowIndex) => '<div class="fixed-data-row"><strong>' + escape(row[0]) + '</strong><div class="form-grid">' + section.columns.slice(1).map((column,columnIndex) => '<label>' + escape(column) + '<textarea rows="2" data-index="' + index + '" data-table-row="' + rowIndex + '" data-table-col="' + (columnIndex + 1) + '" maxlength="5000">' + escape(row[columnIndex + 1]) + '</textarea></label>').join('') + '</div></div>').join('');
      } else {
        content = section.fields.map((row,rowIndex) => '<div class="fixed-data-row"><strong>' + escape(row.label) + '</strong><div class="form-grid">' + [['value',section.kind === 'temperatures' ? 'Temperatura' : 'Información'],['note',section.kind === 'temperatures' ? 'Vida útil / observaciones' : 'Nota / referencia']].map(([key,label]) => '<label>' + label + '<textarea rows="2" data-index="' + index + '" data-field-row="' + rowIndex + '" data-field-key="' + key + '" maxlength="5000">' + escape(row[key]) + '</textarea></label>').join('') + '</div></div>').join('');
      }
      return '<section class="section-editor">' + header + description + content + '</section>';
    }).join('');
  }
  $('#sheet-sections').addEventListener('input', event => {
    const target = event.target;
    if (target.dataset.sectionDescription !== undefined) state.sheet.data.sections[Number(target.dataset.sectionDescription)].description = target.value;
    else if (target.dataset.index !== undefined) {
      const section = state.sheet.data.sections[Number(target.dataset.index)];
      if (target.dataset.fieldRow !== undefined && ['value','note'].includes(target.dataset.fieldKey)) section.fields[Number(target.dataset.fieldRow)][target.dataset.fieldKey] = target.value;
      else if (target.dataset.tableRow !== undefined && Number(target.dataset.tableCol) > 0) section.rows[Number(target.dataset.tableRow)][Number(target.dataset.tableCol)] = target.value;
    } else return;
    setDirty();
  });
  $('#sheet-form').addEventListener('input', event => { if (event.target.closest('#sheet-sections') || event.target.id === 'editor-product') return; updateSummary(); setDirty(); });
  $('#editor-product').addEventListener('change', event => { const id = event.target.value; if (!confirmDiscard()) { event.target.value = state.product.id; return; } editProduct(id, true); });
  $('#image-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (state.busy) return;
    $('#image-upload-state').textContent = 'Subiendo imagen…'; setBusy(true);
    try { const result = await CMS.upload(file); field('image_url').value = result.url; if (!field('image_alt').value) field('image_alt').value = field('product_name').value; updateSummary(); setDirty(); $('#image-upload-state').textContent = 'Imagen lista. Guarda la ficha para aplicar el cambio.'; }
    catch (error) { $('#image-upload-state').textContent = error.message; notify(error.message, true); }
    finally { setBusy(false); event.target.value = ''; }
  });
  $('#sheet-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    const sheet = collect(); const status = event.submitter?.value || 'draft';
    if (sheet.image_url && !safeImage(sheet.image_url)) { notify('Usa una imagen del sitio o una dirección HTTPS válida.', true); field('image_url').focus(); return; }
    if (status === 'published' && (!sheet.description.trim() || !sheet.data.sections.length)) { notify('Para publicar, agrega una descripción y al menos una sección de información.', true); return; }
    setBusy(true); $('#save-state').textContent = 'Guardando…';
    try {
      const productPayload = { ...state.product, image_url: sheet.image_url, image_alt: sheet.image_alt, expected_updated_at: state.product.updated_at || null };
      const { product: savedProduct, sheet: savedSheet } = await CMS.saveEntry({ product: productPayload, sheet: { ...sheet, status, expected_updated_at: sheet.updated_at || null } });
      state.product = savedProduct; replaceProduct(savedProduct);
      state.sheet = savedSheet; const sheetIndex = state.sheets.findIndex(item => item.product_id === savedSheet.product_id); if (sheetIndex < 0) state.sheets.push(savedSheet); else state.sheets[sheetIndex] = savedSheet;
      $('#editor-heading').textContent = savedProduct.name; $('#sheet-state').className = `status-badge ${status}`; $('#sheet-state').textContent = status === 'published' ? 'Publicada' : 'Borrador'; setDirty(false); notify(status === 'published' ? 'Ficha publicada. Ya está disponible en el catálogo.' : 'Borrador guardado. Puedes seguir editando cuando quieras.');
    } catch (error) { $('#save-state').textContent = 'No se pudo guardar'; notify(error.message, true); }
    finally { setBusy(false); }
  });
  function replaceProduct(product) { const index = state.products.findIndex(item => item.id === product.id); if (index < 0) state.products.push(product); else state.products[index] = product; }
  function goLibrary() { if (state.busy || !confirmDiscard()) return; $('#editor-view').hidden = true; $('#library-view').hidden = false; $('#workspace-name').textContent = 'Fichas técnicas'; setDirty(false); renderLibrary(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  $('#go-library').addEventListener('click', goLibrary); $('#back-library').addEventListener('click', goLibrary);
  $('#product-list').addEventListener('click', event => { const button = event.target.closest('[data-edit-product]'); if (button) editProduct(button.dataset.editProduct); });
  for (const id of ['search', 'category-filter', 'status-filter']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', renderLibrary);
  $('#new-product').addEventListener('click', () => { $('#new-product-form').reset(); $('#new-product-error').textContent = ''; $('#new-product-dialog').showModal(); });
  $('#new-product-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target; const name = form.elements.name.value.trim(); if (!name) return;
    const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'producto';
    const id = state.products.some(item => item.id === base) ? `${base}-${crypto.randomUUID().slice(0, 6)}` : base;
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try { const product = await CMS.saveProduct({ id, name, category: form.elements.category.value, image_url: '', image_alt: name, sort_order: state.products.length, archived: false, expected_updated_at: null }); replaceProduct(product); $('#new-product-dialog').close(); editProduct(product.id, true); notify('Producto creado. Completa y guarda su ficha.'); }
    catch (error) { $('#new-product-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#archive-product').addEventListener('click', async () => {
    if (state.busy || !confirmDiscard()) return;
    const persistedProduct = state.products.find(product => product.id === state.product.id);
    const archived = !persistedProduct.archived;
    if (!confirm(archived ? 'El producto dejará de aparecer en el catálogo. Su ficha se conservará. ¿Archivar?' : '¿Restaurar este producto al catálogo?')) return;
    setBusy(true);
    try { state.product = await CMS.saveProduct({ ...persistedProduct, archived, expected_updated_at: persistedProduct.updated_at }); replaceProduct(state.product); setDirty(false); setBusy(false); goLibrary(); notify(archived ? 'Producto archivado.' : 'Producto restaurado.'); } catch (error) { notify(error.message, true); } finally { if (state.busy) setBusy(false); }
  });
  function preview() {
    const sheet = collect();
    const metadata = sheet.data.metadata;
    let html = `<div class="full-preview-top"><img src="${escape(safeImage(sheet.image_url) || 'assets/logo-blanco.svg')}" alt="${escape(sheet.image_alt)}"><div><span class="eyebrow">${sheet.sku ? `SKU ${escape(sheet.sku)}` : categories[state.product.category]}</span><h1>${escape(sheet.title || 'Título de tu ficha')}</h1><p>${escape(sheet.description)}</p><p>${escape([metadata.origin, metadata.state, metadata.allergens, metadata.pieces && `${metadata.pieces} piezas por caja`, metadata.weight && `${metadata.weight} por caja`].filter(Boolean).join(' · '))}</p></div></div>`;
    for (const section of sheet.data.sections) {
      html += `<section><h2>${escape(section.title || 'Sección sin título')}</h2>${section.description ? `<p>${escape(section.description)}</p>` : ''}`;
      if (section.kind === 'table') html += `<table class="preview-table"><thead><tr>${(section.columns || []).map(column => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${(section.rows || []).map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      else html += `<dl class="preview-dl">${(section.fields || []).map(row => `<div><dt>${escape(row.label)}</dt><dd>${escape(row.value)}${row.note ? `<small>${escape(row.note)}</small>` : ''}</dd></div>`).join('')}</dl>`;
      html += '</section>';
    }
    $('#full-preview').innerHTML = html; $('#preview-dialog').showModal();
  }
  $('#preview-button').addEventListener('click', preview); $('#preview-side-button').addEventListener('click', preview);
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  async function startAdmin() {
    const data = await CMS.list(); state.products = data.products; state.sheets = data.sheets;
    $('#loading').hidden = true; $('#login-view').hidden = true; $('#admin-app').hidden = false;
    $('#connection-title').textContent = CMS.config.mode === 'local' ? (CMS.config.provider === 'neon' ? 'Neon conectado' : 'Modo local') : 'Supabase conectado';
    $('#connection-detail').textContent = CMS.config.mode === 'local' ? (CMS.config.provider === 'neon' ? 'Catálogo compartido con el sitio' : 'Datos guardados en este equipo') : CMS.user?.user_metadata?.name || CMS.user?.email || 'Administrador autorizado';
    $('#logout').hidden = CMS.config.mode === 'local' && !CMS.config.localAuthRequired; renderLibrary();
  }
  $('#logout').addEventListener('click', async () => {
    if (state.busy || !confirmDiscard()) return;
    try { await CMS.logout(); } catch (error) { notify(error.message, true); return; } state.products = []; state.sheets = []; state.sheet = null; state.product = null; state.dirty = false;
    $('#admin-app').hidden = true; $('#login-view').hidden = false; $('#editor-view').hidden = true; $('#library-view').hidden = false; $('#sheet-form').reset(); $('#sheet-sections').replaceChildren(); $('#product-list').replaceChildren(); $('#full-preview').replaceChildren(); $('#summary-title').textContent = ''; $('#summary-description').textContent = ''; $('#workspace-name').textContent = 'Fichas técnicas';
  });
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target; const button = form.querySelector('button'); button.disabled = true; $('#login-error').textContent = '';
    try { await CMS.login(form.elements.email.value, form.elements.password.value); form.elements.password.value = ''; await startAdmin(); }
    catch (error) { $('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  try {
    await CMS.init();
    if (CMS.config.mode === 'unconfigured') { $('#loading').hidden = true; $('#setup-view').hidden = false; }
    else if (!CMS.authenticated) { $('#loading').hidden = true; $('#login-view').hidden = false; }
    else await startAdmin();
  } catch (error) { $('#loading').textContent = 'No pudimos cargar el catálogo. Recarga para volver a intentarlo.'; notify(error.message, true); }
})();
