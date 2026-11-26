(() => {
  if (location.protocol === 'file:') return;
  const catalog = 'hoteles-restaurantes.html#catalogo';
  const main = document.querySelector('main');
  const isCatalog = Boolean(document.querySelector('#catalogo .catalog-grid'));
  const isSheet = document.body.classList.contains('product-sheet');
  if (!isCatalog && !isSheet) return;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function link(text, href, style) {
    const a = node('a', style, text);
    a.href = href;
    return a;
  }

  function photo(record) {
    const img = node('img');
    const src = record.image_url || '';
    if (/^(?:\/?(?:assets|uploads)\/|https?:\/\/)/i.test(src)) img.src = src;
    img.alt = record.image_alt || record.name || record.title || '';
    return img;
  }

  function renderCatalog(products) {
    for (const group of document.querySelectorAll('.catalog-category')) {
      const grid = group.querySelector('.catalog-grid');
      const cards = products.filter(p => p.category === group.id).map(p => {
        const card = link('', 'ficha-tecnica.html?producto=' + encodeURIComponent(p.id), 'catalog-card');
        const frame = node('div', 'catalog-image');
        if (p.image_url) {
          const img = photo(p);
          img.loading = 'lazy';
          frame.append(img);
        }
        const caption = node('div');
        caption.append(node('h4', '', p.name), node('span', '', 'Ver ficha técnica →'));
        card.append(frame, caption);
        return card;
      });
      grid.replaceChildren(...(cards.length ? cards : [node('p', '', 'Sin productos disponibles en esta categoría.')]));
    }
  }

  function renderSheet(product, sheet) {
    const title = sheet?.title || product?.name || 'Producto no disponible';
    const hero = node('section', 'editorial-hero');
    const intro = node('div', 'editorial-title');
    intro.append(link('← Volver al catálogo', catalog, 'sheet-back'), node('p', 'section-kicker', 'Ficha técnica'), node('h1', '', title));
    hero.append(intro);
    main.replaceChildren(hero);
    document.title = title + ' | Carnes Supremas';
    if (!product) return;

    const quote = 'https://wa.me/523221722741?text=' + encodeURIComponent((sheet ? 'Quiero cotizar ' : 'Solicito la ficha técnica de ') + product.name);
    document.querySelector('.header-cta').href = quote;
    if (sheet?.sku) intro.append(node('p', '', 'SKU ' + sheet.sku));
    if (sheet?.description) intro.append(node('p', '', sheet.description));
    intro.append(link(sheet ? 'Solicitar cotización' : 'Solicitar ficha vigente', quote, 'btn btn-gold'));
    const metadata = sheet?.data?.metadata || {};
    const source = sheet?.image_url ? sheet : product;
    if (source.image_url) {
      const frame = node('div', 'editorial-product');
      frame.append(photo(source));
      const badges = node('div', 'editorial-badges');
      for (const tag of [metadata.state, metadata.allergens].filter(Boolean)) badges.append(node('span', '', tag));
      if (badges.childElementCount) frame.append(badges);
      hero.append(frame);
    }
    if (!sheet) return;
    const summary = node('section', 'editorial-summary');
    if (metadata.origin) summary.append(node('p', '', 'Materia prima · ' + metadata.origin));
    for (const [label, value] of [['Piezas por caja', metadata.pieces], ['Peso por caja', metadata.weight]]) {
      if (!value) continue;
      const fact = node('div');
      fact.append(node('strong', '', value), node('span', '', label));
      summary.append(fact);
    }
    if (summary.childElementCount) main.append(summary);

    const contents = node('section', 'editorial-content');
    const index = node('aside');
    index.append(node('p', 'section-kicker', 'Índice técnico'));
    const sections = node('div', 'editorial-sections');
    const anchors = { especificaciones: 'sensorial', microbiologia: 'inocuidad', conservacion: 'frio', 'control-documental': 'control' };
    for (const section of sheet.data.sections) {
      const article = node('article');
      article.id = anchors[section.id] || section.id;
      index.append(link(section.title, '#' + article.id));
      article.append(node('h2', '', section.title));
      if (section.description) article.append(node('p', '', section.description));
      if (section.kind === 'temperatures') {
        const temps = node('div', 'editorial-temps');
        for (const field of section.fields) {
          const cell = node('div');
          cell.append(node('strong', '', field.value), node('p', '', field.label), node('p', '', field.note));
          temps.append(cell);
        }
        article.append(temps);
      } else {
        const rows = section.rows || section.fields.map(f => [f.label, f.value, f.note]);
        for (const [label, value, note] of rows) {
          const row = node('div', 'spec-row');
          row.append(node('b', '', label), node('strong', '', value), node('small', '', note));
          article.append(row);
        }
      }
      sections.append(article);
    }
    contents.append(index, sections);
    main.append(contents);
    const actions = node('section', 'spec-cta');
    actions.append(node('h2', '', 'Cotizar ' + title), link('Solicitar cotización', quote, 'btn btn-gold'), link('Volver al catálogo', catalog, 'sheet-back'));
    main.append(actions);
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }

  async function load() {
    if (isSheet) main.replaceChildren(node('p', 'cms-loading', 'Cargando ficha técnica…'));
    try {
      const products = await CMS.publicProducts();
      if (isCatalog) return renderCatalog(products);
      const id = new URLSearchParams(location.search).get('producto') || 'bistec-de-res-cl';
      const product = products.find(p => p.id === id);
      renderSheet(product, product ? await CMS.publicSheet(id) : null);
    } catch {
      const message = node('p', 'cms-loading', 'No se pudo cargar el catálogo actualizado. Recarga la página para volver a intentarlo.');
      message.setAttribute('role', 'status');
      if (isSheet) main.replaceChildren(message, link('Volver al catálogo', catalog, 'btn btn-gold'));
      else document.querySelector('#catalogo').prepend(message);
    }
  }
  load();
})();
