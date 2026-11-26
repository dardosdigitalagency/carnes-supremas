(function(root){
  'use strict';
  const definitions = [
  {
    "id": "especificaciones",
    "title": "Especificaciones del producto",
    "kind": "table",
    "columns": [
      "Característica",
      "Especificación",
      "Referencia"
    ],
    "labels": [
      "Color",
      "Olor",
      "Textura"
    ]
  },
  {
    "id": "microbiologia",
    "title": "Calidad microbiológica",
    "kind": "table",
    "columns": [
      "Parámetro",
      "Resultado requerido",
      "Referencia"
    ],
    "labels": [
      "Salmonella spp. / 25 g",
      "Staphylococcus aureus"
    ]
  },
  {
    "id": "empaque",
    "title": "Presentación y empaque",
    "kind": "fields",
    "labels": [
      "Empaque primario",
      "Piezas por caja",
      "Empaque secundario",
      "Dimensiones de la caja"
    ]
  },
  {
    "id": "conservacion",
    "title": "Conservación y vida útil",
    "kind": "temperatures",
    "labels": [
      "Almacenar fresco",
      "Almacenar congelado"
    ]
  },
  {
    "id": "control-documental",
    "title": "Control documental",
    "kind": "fields",
    "labels": [
      "Código de ficha",
      "Revisión",
      "Elaboró",
      "Revisó",
      "Autorizó",
      "Precio"
    ]
  }
];
  function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
  freeze(definitions);
  const text = value => typeof value === 'string' ? value : '';
  function normalizeSections(input) {
    const sections = Array.isArray(input) ? input : [];
    return definitions.map(definition => {
      const existing = sections.find(section => section?.id === definition.id) || {};
      const section = { id: definition.id, title: definition.title, kind: definition.kind, description: text(existing.description), fields: [] };
      if (definition.kind === 'table') {
        section.columns = [...definition.columns];
        const rows = Array.isArray(existing.rows) ? existing.rows : [];
        section.rows = definition.labels.map((label,index) => {
          const row = rows.find(item => Array.isArray(item) && item[0] === label) || rows[index] || [];
          return [label, ...definition.columns.slice(1).map((_,column) => text(row[column + 1]))];
        });
      } else {
        const fields = Array.isArray(existing.fields) ? existing.fields : [];
        section.fields = definition.labels.map((label,index) => {
          const field = fields.find(item => item?.label === label) || fields[index] || {};
          return {label, value: text(field.value), note: text(field.note)};
        });
      }
      return section;
    });
  }
  function isStandardSections(sections) {
    return Array.isArray(sections) && sections.length === definitions.length && definitions.every((definition,index) => {
      const section = sections[index];
      if (!section || section.id !== definition.id || section.title !== definition.title || section.kind !== definition.kind) return false;
      if (definition.kind === 'table') return JSON.stringify(section.columns) === JSON.stringify(definition.columns) && Array.isArray(section.rows) && section.rows.length === definition.labels.length && section.rows.every((row,index) => Array.isArray(row) && row.length === definition.columns.length && row[0] === definition.labels[index]);
      return Array.isArray(section.fields) && section.fields.length === definition.labels.length && section.fields.every((field,index) => field?.label === definition.labels[index]);
    });
  }
  const api = Object.freeze({definitions, normalizeSections, blankSections: () => normalizeSections([]), isStandardSections});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SheetTemplate = api;
})(typeof window === 'undefined' ? globalThis : window);
