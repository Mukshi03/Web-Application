'use strict';
/* =====================================================================
   ITEMS / SKU MASTER — shared
   ===================================================================== */
const TEMPS = ['Ambient', 'Dry', 'Chilled', 'Frozen'];
const TEMP_RANGE = { Ambient: '15 to 25°C', Dry: 'up to 30°C, low humidity', Chilled: '2 to 8°C', Frozen: '-25 to -18°C' };
const tempLbl = t => TEMP_RANGE[t] ? t + ' · ' + TEMP_RANGE[t] : t;
const UOM_TYPES = ['Count', 'Weight', 'Volume', 'Length', 'Area', 'Handling unit'];
const DG = [['', 'No'], ['1', 'Class 1 · Explosives'], ['2', 'Class 2 · Gases'], ['3', 'Class 3 · Flammable liquids'], ['4', 'Class 4 · Flammable solids'], ['5', 'Class 5 · Oxidizers'], ['6', 'Class 6 · Toxic'], ['8', 'Class 8 · Corrosives'], ['9', 'Class 9 · Miscellaneous']];
const uomCodes = () => DB.uoms.filter(u => u.status !== 'Inactive').map(u => u.code);
const groupNames = () => [...new Set([...DB.groups.map(g => g.name), ...DB.items.map(i => i.group).filter(Boolean)])];
const catNames = () => [...new Set([...DB.cats.map(c => c.name), ...DB.items.map(i => i.category).filter(Boolean)])];
const stockable = i => i.kind !== 'Service' && i.track !== false;
const onHand = i => i.variant === 'template' ? sum(DB.items.filter(v => v.parent === i.sku), onHand) : sum(DB.stock.filter(s => s.sku === i.sku), s => s.qty);
const itemHasTx = sku => DB.asns.some(a => a.lines.some(l => l.sku === sku)) || DB.orders.some(o => o.lines.some(l => l.sku === sku));
const itemCell = sku => { const i = item(sku); return `<b>${esc(i.name || sku)}</b><br><span class="note mono">${esc(i.code || '')} · ${esc(sku)}</span>`; };

/* ---------------- Customer items (SKUs) ---------------- */
function itemsPage() {
  const rows = applyFilt('items', DB.items, { q: (r, v) => [r.sku, r.name, r.name2, r.code, r.custCode].join(' ').toLowerCase().includes(v.toLowerCase()) });
  const typ = i => i.variant === 'template' ? `<span class="pill p-info">Template · ${DB.items.filter(x => x.parent === i.sku).length} variants</span>` : i.variant === 'variant' ? `<span class="note">Variant · ${esc(i.attr.name)} ${esc(i.attr.value)}</span>` : 'Single item';
  const oh = i => !stockable(i) ? '<span class="note">Not stocked</span>' : onHand(i) < (i.minStock || 0) ? `<b style="color:var(--bad)">${n0(onHand(i))}</b> <span class="pill p-bad">Low</span>` : n0(onHand(i));
  const body = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Item code</th><th>SKU</th><th>Cust. item code</th><th>Name</th><th>Customer</th><th>Item type</th><th>Category</th><th>Item group</th><th>UOM</th><th>Temp</th><th class="num">On hand</th></tr></thead><tbody>
    ${rows.map(i => `<tr class="click" data-href="#items/edit/${encodeURIComponent(i.sku)}"><td class="mono">${esc(i.code)}</td><td class="mono">${esc(i.sku)}</td><td class="mono">${esc(i.custCode) || '—'}</td>
      <td>${i.variant === 'variant' ? '<span class="note">↳ </span>' : ''}<b>${esc(i.name)}</b>${i.name2 ? `<br><span class="note" dir="rtl" lang="ar">${esc(i.name2)}</span>` : ''}${i.status === 'Inactive' ? ' <span class="pill p-mute">Inactive</span>' : ''}</td>
      <td>${esc(clName(i.client))}</td><td>${typ(i)}</td><td>${esc(i.category) || '—'}</td><td>${esc(i.group) || '—'}</td><td>${esc(i.uom)}</td><td>${esc(i.temp)}</td><td class="num">${oh(i)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${DB.items.length ? 'No items match the filters.' : 'No items yet.'}</div>`;
  return head2('Items / SKU Master', 'Customer items (SKUs)', `<a class="btn pri" href="#items/new">+ New item</a>`)
    + filterBar('items', [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'group', label: 'Item group', options: optA(groupNames()) },
      { id: 'temp', label: 'Temperature', options: optA(['Ambient', 'Chilled', 'Frozen']) }, { id: 'q', type: 'text', label: 'Search code, SKU or name' }])
    + card(`${rows.length} item${rows.length === 1 ? '' : 's'}`, body);
}

const itF = (id, label, html, req, cls = '', hint = '') => `<label class="field ${cls}" for="${id}">${lab(label, req)}${html}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
const itIn = (id, name, v, x = '') => `<input id="${id}" name="${name}" value="${esc(v ?? '')}" autocomplete="off" ${x}>`;
const convRow = (c, base) => `<div class="crow"><span>1</span><select data-conv="uom" aria-label="Larger unit"><option value="">Unit…</option>${opt(optA(uomCodes()), c.uom || '')}</select><span>=</span><input data-conv="factor" type="number" min="0" step="any" aria-label="Number of base units" value="${esc(c.factor || '')}" placeholder="Qty"><span class="baseU note">${esc(base)}</span><button type="button" class="icon-btn" data-do="itDelConv" aria-label="Remove conversion">×</button></div>`;
const swRow = (name, id, on, title, text) => `<div class="it-sw"><label class="switch"><input type="checkbox" name="${name}" id="${id}" ${on ? 'checked' : ''}><span aria-hidden="true"></span><span class="sr">${title}</span></label><div><b>${title}</b><small>${text}</small></div></div>`;

function itemForm(sku) {
  const it = sku ? item(sku) : null, ed = !!(it && it.sku);
  const e = ed ? it : { kind: 'Goods', variant: 'single', uom: modCfg('items', 'uom'), temp: modCfg('items', 'temp'), track: true, conversions: [], batch: modCfg('items', 'batch') === 'Yes', serial: false, expiry: modCfg('items', 'expiry') === 'Yes', status: 'Active', client: '' };
  const lock = ed ? 'disabled' : '', isTpl = e.variant === 'template', vars = ed ? DB.items.filter(x => x.parent === e.sku) : [];
  const btns = `<a class="btn" href="#items">Cancel</a>${ed ? `<button type="button" class="btn danger" data-do="itDelete" data-id="${esc(e.sku)}">Delete</button>` : '<button type="button" class="btn" data-do="itSave" data-id="new">Save &amp; new</button>'}<button type="button" class="btn pri" data-do="itSave" data-id="">${ed ? 'Save changes' : 'Save item'}</button>`;
  const html = `${head2('Items / ' + (ed ? 'Edit' : 'New'), ed ? esc(e.name) : 'New item', btns)}
  <form id="itemForm" novalidate onsubmit="return false" style="display:flex;flex-direction:column;gap:14px" data-edit="${ed ? esc(e.sku) : ''}">
  <div class="err" id="itErr" role="alert"></div>
  <section class="card"><div class="card-h"><h2>Item</h2><span class="note">${ed ? '' : 'S.No is generated automatically for every new item'}</span></div>
  <div class="card-b igrid">
    ${itF('it_code', 'S.No #', `<input id="it_code" class="mono ro-in" value="${esc(ed ? e.code : 'GL-' + DB.seq.ITEM)}" readonly tabindex="-1">`, 0, '', ed ? 'Fixed for this item.' : 'Next number. Assigned when you save.')}
    ${itF('it_client', 'Company (customer)', `<select id="it_client" name="client" ${lock}><option value="">Choose…</option>${opt(ed ? DB.customers.map(c => [c.id, c.name]) : custOpts(), e.client)}</select>`, 1)}
    <div class="field"><span>Ownership</span><div class="note" style="padding:8px 0">Customer stock held by Gray Lane (not Gray Lane's own goods)</div></div>
    ${itF('it_name', 'Primary name (English)', itIn('it_name', 'name', e.name, 'placeholder="e.g. Basmati rice 5 kg"'), 1)}
    ${itF('it_name2', 'Secondary name (Arabic)', itIn('it_name2', 'name2', e.name2, 'dir="rtl" lang="ar" placeholder="مثال: أرز بسمتي ٥ كغ"'))}
    ${itF('it_status', 'Status', `<select id="it_status" name="status">${opt(optA(['Active', 'Inactive']), e.status || 'Active')}</select>`)}
    ${itF('it_category', 'Category', `<select id="it_category" name="category"><option value="">— None —</option>${opt(optA(catNames()), e.category || '')}</select>`, 0, '', '<a href="#categories">Manage categories</a>')}
    ${itF('it_brand', 'Brand', itIn('it_brand', 'brand', e.brand, 'list="dl_brand"'))}
    ${itF('it_manu', 'Manufacturer', itIn('it_manu', 'manufacturer', e.manufacturer, 'list="dl_manu"'))}
  </div></section>

  <section class="card"><div class="card-h"><h2>Item details</h2></div>
  <div class="card-b igrid">
    <div class="field full"><span id="lbl_vt">Item type</span><div class="seg" role="radiogroup" aria-labelledby="lbl_vt"><label><input type="radio" name="vtype" value="single" ${!isTpl ? 'checked' : ''} ${lock}>Single item</label><label><input type="radio" name="vtype" value="variants" ${isTpl ? 'checked' : ''} ${lock}>Contains variants</label></div></div>
    ${itF('it_uom', 'Unit of measure (UOM)', `<select id="it_uom" name="uom">${opt(optA([...new Set([...uomCodes(), e.uom])]), e.uom)}</select>`, 1)}
    ${itF('it_sku', 'SKU', itIn('it_sku', 'sku', e.sku, `class="mono" placeholder="e.g. RSF-RICE-5K" ${lock}`), 1)}
    ${itF('it_temp', 'Temperature class', `<select id="it_temp" name="temp">${opt(TEMPS.map(t => [t, tempLbl(t)]), e.temp)}</select>`)}
    ${itF('it_bc', 'Barcode', itIn('it_bc', 'barcode', e.barcode, 'class="mono"'))}
    ${itF('it_grp', 'Item group', `<select id="it_grp" name="group"><option value="">— None —</option>${opt(optA(groupNames()), e.group || '')}</select>`, 0, '', '<a href="#groups">Manage item groups</a>')}
    ${itF('it_pk', 'Packing', itIn('it_pk', 'packing', e.packing, 'placeholder="e.g. 12 × 1 L per carton"'))}
    ${itF('it_cust', 'Cust. item code #', itIn('it_cust', 'custCode', e.custCode, 'class="mono" placeholder="Customer\'s own code (blank = SKU)"'))}
    ${itF('it_batchno', 'Batch #', itIn('it_batchno', 'batchNo', e.batchNo, 'class="mono" placeholder="e.g. B-2026-001"'))}
    <div class="field full"><span>Unit conversions</span><div class="subbox" id="convBox">${(e.conversions || []).map(c => convRow(c, e.uom)).join('')}<button type="button" class="btn sm" data-do="itAddConv" style="align-self:flex-start">+ Add conversion</button><span class="note">e.g. 1 Pallet = 48 Cartons. Conversions are per item because a carton of rice and a carton of phones hold different quantities.</span></div></div>
    <div id="varBox" class="full subbox" ${isTpl ? '' : 'hidden'}>
      ${ed ? `<b style="font-size:13px">${vars.length} variants by ${esc(e.attrName || 'attribute')}</b><div class="tbl-wrap"><table><thead><tr><th>SKU</th><th>${esc(e.attrName || 'Value')}</th><th>Name</th><th class="num">On hand</th></tr></thead><tbody>${vars.map(v => `<tr><td class="mono">${esc(v.sku)}</td><td>${esc(v.attr.value)}</td><td>${esc(v.name)}</td><td class="num">${n0(onHand(v))}</td></tr>`).join('')}</tbody></table></div><span class="note">Changes here (except barcode) apply to every variant.</span>`
      : `<div class="igrid">${itF('it_vattr', 'Variant attribute', itIn('it_vattr', 'vattr', '', 'placeholder="Size, Colour, Flavour"'))}<label class="field" for="it_vvals" style="grid-column:2/-1"><span>Values, separated by commas</span>${itIn('it_vvals', 'vvals', '', 'placeholder="S, M, L, XL"')}</label></div><div id="varPrev"></div>`}
    </div>
  </div></section>

  <section class="card"><div class="card-h"><h2>Handling &amp; storage</h2><span class="note">Used to plan pallet space and to charge by carton, pallet, weight or volume</span></div>
  <div class="card-b igrid">
    ${itF('it_upc', 'Units per carton', itIn('it_upc', 'upc', e.upc || '', 'type="number" min="0"'))}
    ${itF('it_ti', 'Cartons per layer (Ti)', itIn('it_ti', 'ti', e.ti || '', 'type="number" min="0"'))}
    ${itF('it_hi', 'Layers per pallet (Hi)', itIn('it_hi', 'hi', e.hi || '', 'type="number" min="0"'), 0, '', 'Cartons per pallet = Ti × Hi <b id="tihi"></b>')}
    ${itF('it_dims', 'Carton length × width × height, cm', itIn('it_dims', 'dims', e.dims, 'placeholder="e.g. 40 × 30 × 25"'))}
    ${itF('it_kg', 'Carton gross weight, kg', itIn('it_kg', 'kg', e.kg || '', 'type="number" min="0" step="0.01"'))}
    ${itF('it_stack', 'Max. stacking, pallets high', itIn('it_stack', 'stack', e.stack || '', 'type="number" min="1"'))}
    ${itF('it_dg', 'Dangerous goods', `<select id="it_dg" name="dg">${opt(DG, e.dg || '')}</select>`)}
  </div></section>

  <section class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:14px">
    ${swRow('track', 'it_track', e.track !== false, 'Maintain stock', 'On: stock of this item is kept by LPN, batch and bin, and it appears in the stock report, stock ledger and movement reports. It can be received, stored, moved and dispatched. Off: a reference-only item with no stock.')}
    <div id="invBody" class="igrid">
      ${itF('it_vm', 'Pick rule', `<select id="it_vm" name="valMethod">${opt([['Customer default', 'Customer default'], ['FIFO', 'FIFO (first in, first out)'], ['FEFO', 'FEFO (first expiry, first out)']], e.valMethod || 'Customer default')}</select>`, 0, '', 'How stock of this item is picked for orders.')}
      ${itF('it_min', 'Low stock alert level', itIn('it_min', 'minStock', e.minStock || '', 'type="number" min="0" placeholder="Optional"'), 0, '', `Flag the item when the customer's stock on hand falls below this, in <span class="baseU">${esc(e.uom)}</span>.`)}
    </div>
    <p class="note" id="noTrack" hidden style="margin:0">Stock is not maintained for this item: it cannot be received or dispatched and does not appear in stock reports.</p>
  </div></section>

  <section class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:14px">
    ${swRow('trackOpt', 'it_topt', e.batch || e.serial || e.expiry, 'Tracking', 'Track this item by batch number, serial number or expiry date. Choose the options, then enter the details for the opening stock.')}
    <div class="subbox" id="trackBox">
      <div class="row" style="gap:6px 22px"><label class="chk"><input type="checkbox" name="batch" ${e.batch ? 'checked' : ''}>Has batch number</label><label class="chk"><input type="checkbox" name="serial" ${e.serial ? 'checked' : ''}>Has serial number</label><label class="chk"><input type="checkbox" name="expiry" ${e.expiry ? 'checked' : ''}>Has expiry date</label></div>
      <div class="igrid" id="trkDetails">
        ${ed ? '' : `<label class="field" for="it_ob" id="openBatch"><span>Batch no.</span><input id="it_ob" name="obatch" class="mono" autocomplete="off" placeholder="e.g. B-2026-001"><small class="hint">Batch of the opening stock.</small></label>
        <label class="field" for="it_oe" id="openExp"><span>Expiry date</span><input id="it_oe" name="oexp" type="date"><small class="hint">Expiry of the opening stock.</small></label>`}
        <label class="field" for="it_shelf" id="shelfF"><span>Shelf life, days</span><input id="it_shelf" name="shelf" type="number" min="1" value="${esc(e.shelf || '')}" placeholder="e.g. 365"><small class="hint">Used to check expiry dates at receiving.</small></label>
      </div>
      ${ed ? '' : `<label class="field" for="it_os" id="openSer"><span>Serial numbers <span class="note">· one per line, one for each unit of opening stock</span></span><textarea id="it_os" name="oserials" rows="3" class="mono" placeholder="SN0001&#10;SN0002"></textarea></label>
      <span class="note">These details are used for the opening stock below. Stock received later gets its batch, expiry and serial numbers at receiving.</span>`}
    </div>
  </div></section>

  <section class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:14px">
    ${ed ? '<p class="note" style="margin:0">Opening stock is entered only once, when the item is created. Later stock comes in through Inbound (ASN / receiving) or Inventory adjustments.</p>'
    : `${swRow('maintain', 'it_maint', false, 'Enter opening stock', 'Optional. Only if this customer\'s goods are already in the warehouse today (for example when moving from another system). Otherwise leave it off: stock comes in through Inbound.')}
    <div id="openLoc" hidden style="display:flex;flex-direction:column;gap:12px"><div class="igrid">
      <label class="field" for="it_open" id="singleOpen"><span>Opening quantity</span><input id="it_open" name="opening" type="number" min="0" step="any" placeholder="0"><small class="hint">In <span class="baseU">${esc(e.uom)}</span></small></label>
      <label class="field" for="it_od"><span>As of date</span><input id="it_od" name="odate" type="date" value="${iso(today)}"><small class="hint">Used as the received date for storage ageing.</small></label>
      <label class="field" for="it_owh"><span>Warehouse</span><select id="it_owh" name="owh"><option value="">Choose…</option>${opt(whOpts(), '')}</select></label></div>
      <span class="note">Leave the quantity at 0 to skip. If you enter a quantity, the warehouse is required. The stock is added as available stock, posted as movement type "Opening stock", and is not billed as an inbound receipt.</span></div>`}
  </div></section>
  <div class="form-foot">${btns}</div></form>
  <datalist id="dl_brand">${[...new Set(DB.items.map(i => i.brand).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist>
  <datalist id="dl_manu">${[...new Set(DB.items.map(i => i.manufacturer).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  setTimeout(() => updateItemForm(), 0);
  return html;
}
function renderVarPreview() {
  const fm = $('#itemForm'), box = $('#varPrev'); if (!fm || !box) return;
  const prev = {}; box.querySelectorAll('[data-vopen]').forEach(i => prev[i.dataset.vopen] = i.value);
  const base = fm.querySelector('[name="sku"]').value.trim().toUpperCase() || 'SKU', nm = fm.querySelector('[name="name"]').value.trim() || 'Item';
  const vals = fm.querySelector('[name="vvals"]').value.split(',').map(s => s.trim()).filter(Boolean);
  const mt = fm.querySelector('[name="maintain"]'), stock = fm.querySelector('[name="track"]').checked && mt && mt.checked;
  box.innerHTML = vals.length ? `<div class="tbl-wrap"><table><thead><tr><th>Value</th><th>SKU</th><th>Name</th>${stock ? '<th class="num">Opening stock</th>' : ''}</tr></thead><tbody>${vals.map(v => `<tr><td>${esc(v)}</td><td class="mono">${esc(base + '-' + v.toUpperCase().replace(/[^A-Z0-9]+/g, ''))}</td><td>${esc(nm + ' - ' + v)}</td>${stock ? `<td class="num"><input type="number" min="0" step="any" data-vopen="${esc(v)}" value="${esc(prev[v] || '')}" style="width:90px;height:32px;border:1px solid var(--line);border-radius:6px;padding:0 6px;background:var(--surface);color:var(--fg)" aria-label="Opening stock for ${esc(v)}"></td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : '<p class="note" style="margin:0">Enter values separated by commas to preview the variant SKUs.</p>';
}
function updateItemForm(t) {
  const fm = $('#itemForm'); if (!fm) return; const q = n => fm.querySelector(`[name="${n}"]`), sh = (id, v) => { const el = $('#' + id); if (el) el.hidden = !v; };
  const variants = fm.querySelector('[name="vtype"]:checked').value === 'variants', track = q('track').checked;
  sh('invBody', track); sh('noTrack', !track); sh('varBox', variants);
  fm.querySelectorAll('.baseU').forEach(s => s.textContent = q('uom').value);
  if (variants && (!t || ['vvals', 'sku', 'name', 'track', 'vtype', 'maintain'].includes(t.name))) renderVarPreview();
  if (q('maintain')) { sh('openLoc', q('maintain').checked); sh('singleOpen', !variants); }
  sh('trackBox', q('trackOpt').checked);
  sh('openBatch', q('batch').checked); sh('openExp', q('expiry').checked); sh('shelfF', q('expiry').checked); sh('openSer', q('serial').checked && !variants);
  sh('trkDetails', q('batch').checked || q('expiry').checked);
  const ti = +q('ti').value || 0, hi = +q('hi').value || 0; $('#tihi').textContent = ti && hi ? '= ' + n0(ti * hi) : '';
}
function readItemForm() {
  const fm = $('#itemForm'), g = n => { const el = fm.querySelector(`[name="${n}"]`); return !el ? '' : el.type === 'checkbox' ? el.checked : el.value.trim(); };
  const d = { client: g('client'), name: g('name'), name2: g('name2'), status: g('status') || 'Active', kind: 'Goods', category: g('category'), brand: g('brand'), manufacturer: g('manufacturer'),
    vtype: fm.querySelector('[name="vtype"]:checked').value, uom: g('uom'), sku: g('sku').toUpperCase(), barcode: g('barcode'), group: g('group'), temp: g('temp'), custCode: g('custCode').toUpperCase(), batchNo: g('batchNo'),
    trackOpt: !!g('trackOpt'), track: !!g('track'), minStock: +g('minStock') || 0, valMethod: g('valMethod'), upc: +g('upc') || 0, ti: +g('ti') || 0, hi: +g('hi') || 0, dims: g('dims'), kg: +g('kg') || 0, stack: +g('stack') || 0, dg: g('dg'), packing: g('packing'),
    batch: g('batch'), serial: g('serial'), expiry: g('expiry'), shelf: +g('shelf') || 0, maintain: !!g('maintain'), opening: +g('opening') || 0, odate: g('odate') || iso(today), wh: g('owh'),
    obatch: g('obatch'), oexp: g('oexp'), oserials: String(g('oserials') || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
    vattr: g('vattr'), vals: String(g('vvals')).split(',').map(s => s.trim()).filter(Boolean), vopen: [...fm.querySelectorAll('[data-vopen]')].map(i => +i.value || 0),
    conversions: [...fm.querySelectorAll('#convBox .crow')].map(r => ({ uom: r.querySelector('[data-conv=uom]').value, factor: +r.querySelector('[data-conv=factor]').value || 0 })).filter(c => c.uom || c.factor) };
  d.openOn = d.maintain && (d.vtype === 'variants' ? sum(d.vopen) : d.opening) > 0;
  if (!d.trackOpt) { d.batch = false; d.serial = false; d.expiry = false; d.shelf = 0; }
  if (!d.batch) d.obatch = ''; if (!d.expiry) d.oexp = ''; if (!d.serial) d.oserials = [];
  if (!d.track || !d.maintain) { d.opening = 0; d.vopen = d.vopen.map(() => 0); }
  return d;
}
function saveItem(d, editSku) {
  if (!d.client) throw new Error('Choose the company (customer) that owns this item.');
  if (!d.name) throw new Error('Enter the primary name.');
  if (!d.sku) throw new Error('Enter a SKU.');
  if (!d.track && d.trackOpt) throw new Error('Tracking needs Maintain Stock. Turn on Maintain Stock, or turn off Tracking.');
  if (!d.track && d.openOn) throw new Error('Opening stock needs Maintain Stock. Turn on Maintain Stock, or turn off Enter Opening Stock.');
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(d.sku)) throw new Error('The SKU can use letters, digits, dots, dashes and underscores only.');
  if (d.custCode && DB.items.some(i => i.client === d.client && i.sku !== editSku && (i.custCode || '') === d.custCode)) throw new Error('Cust. item code ' + d.custCode + ' is already used by another item of this customer.');
  if (d.track && d.expiry && !(d.shelf > 0)) throw new Error('Enter the shelf life in days, or untick "Has expiry date".');
  d.conversions.forEach((c, i) => { if (!c.uom || !(c.factor > 0)) throw new Error('Conversion ' + (i + 1) + ': choose the unit and enter how many ' + d.uom + ' it holds.'); if (c.uom === d.uom) throw new Error('Conversion ' + (i + 1) + ': the unit must differ from the base unit ' + d.uom + '.'); });
  const base = { client: d.client, name2: d.name2, status: d.status, kind: 'Goods', category: d.category, brand: d.brand, manufacturer: d.manufacturer, uom: d.uom, custCode: d.custCode, batchNo: d.batchNo, group: d.group, temp: d.temp, barcode: d.barcode,
    track: d.track, minStock: d.minStock, valMethod: d.valMethod === 'Customer default' ? '' : d.valMethod, upc: d.upc, ti: d.ti, hi: d.hi, dims: d.dims, kg: d.kg, stack: d.stack, dg: d.dg, packing: d.packing, conversions: d.conversions,
    batch: d.track && d.batch, serial: d.track && d.serial, expiry: d.track && d.expiry, shelf: d.track && d.expiry ? d.shelf : 0 };
  if (editSku) {
    const it = item(editSku), { barcode, ...shared } = base;
    if (it.track !== false && !d.track && onHand(it) > 0) throw new Error('This item has stock in the warehouse. Stock must be zero before "Maintain stock" can be switched off.');
    Object.assign(it, base, { name: d.name });
    if (it.variant === 'template') DB.items.filter(v => v.parent === it.sku).forEach(v => Object.assign(v, shared, { name: d.name + ' - ' + v.attr.value }));
    return { item: it, variants: 0, opening: 0 };
  }
  if (DB.items.some(i => i.sku === d.sku)) throw new Error('SKU ' + d.sku + ' already exists.');
  const isVar = d.vtype === 'variants', openTotal = d.track ? (isVar ? sum(d.vopen) : d.opening) : 0;
  if (isVar) { if (!d.vattr) throw new Error('Enter the variant attribute, e.g. Size.'); if (d.vals.length < 2) throw new Error('Enter at least two variant values, separated by commas.');
    if (new Set(d.vals.map(v => v.toUpperCase())).size !== d.vals.length) throw new Error('Each variant value must be different.'); }
  if (openTotal > 0) {
    if (!d.wh) throw new Error('Choose the warehouse that holds the opening stock.');
    if (d.odate > iso(today)) throw new Error('The opening stock date cannot be in the future.');
    if (d.batch && !d.obatch) throw new Error('Enter the batch no. of the opening stock.');
    if (d.expiry && !d.oexp) throw new Error('Enter the expiry date of the opening stock.');
    if (d.serial && !isVar && d.oserials.length) { if (d.oserials.length !== openTotal) throw new Error('Enter ' + openTotal + ' serial number' + (openTotal === 1 ? '' : 's') + ' (one per unit of opening stock), or leave the box empty. You entered ' + d.oserials.length + '.'); if (new Set(d.oserials).size !== d.oserials.length) throw new Error('Each serial number must be different.'); }
  }
  const nextCode = () => 'GL-' + (DB.seq.ITEM++);
  const addStock = (sku, q) => { if (!(q > 0)) return; const b = ibSuggest(d.wh, sku, d.client)[0] || DB.bins.find(x => x.wh === d.wh && PUT_ROLES.includes(x.role));
    const s = { lpn: seqNo('LPN', 'LPN-', 6), client: d.client, sku, wh: d.wh, bin: b ? b.code : 'DOCK-IN', batch: d.obatch || '', expiry: d.oexp || '', qty: q, alloc: 0, status: 'Available', received: d.odate, qc: 'Accepted', asn: '', serials: d.oserials }; DB.stock.push(s); ibMove(d.odate || iso(today), 'Opening stock', 'Item ' + sku, s, q); };
  const rec = { ...base, sku: d.sku, name: d.name, code: nextCode(), variant: isVar ? 'template' : 'single', created: iso(today) };
  if (isVar) { rec.attrName = d.vattr; rec.track = d.track; }
  DB.items.push(rec);
  if (isVar) d.vals.forEach((v, i) => { const sku = d.sku + '-' + v.toUpperCase().replace(/[^A-Z0-9]+/g, ''); if (DB.items.some(x => x.sku === sku)) throw new Error('SKU ' + sku + ' already exists.');
    DB.items.push({ ...base, sku, name: d.name + ' - ' + v, code: nextCode(), variant: 'variant', parent: d.sku, attr: { name: d.vattr, value: v }, custCode: '', barcode: '', created: iso(today) }); addStock(sku, d.vopen[i]); });
  else addStock(d.sku, openTotal);
  return { item: rec, variants: isVar ? d.vals.length : 0, opening: openTotal };
}

/* ---------------- VAS materials ---------------- */
const MAT_TYPES = ['Stretch / shrink film', 'Labels', 'Pallets', 'Cartons & boxes', 'Protective packing', 'Tape & strapping', 'Other'];
const MAT_UNITS = ['Roll', 'Label', 'Pallet', 'Carton', 'Box', 'Piece', 'Nos', 'Kg', 'Meter', 'Pack'];
const matBy = c => DB.materials.find(m => m.code === c) || {};
const matNextCode = () => { let n = DB.seq.MAT || 1; while (DB.materials.some(m => m.code === 'MAT-' + String(n).padStart(3, '0'))) n++; return 'MAT-' + String(n).padStart(3, '0'); };
const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const matLog = (m, what) => (m.log = m.log || []).push({ at: nowStamp(), by: DATA.user.name, what });
function materialsPage() {
  const rows = applyFilt('mat', DB.materials, { q: (m, v) => (m.code + ' ' + m.name).toLowerCase().includes(v.toLowerCase()), low: (m, v) => v === 'low' ? m.onHand <= m.reorder : true });
  const act = DB.materials.filter(m => m.status === 'Active'), month = iso(today).slice(0, 7);
  const body = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Material</th><th>Type</th><th>Unit</th><th class="num">On Hand</th><th class="num">Reorder Level</th><th class="num">Unit Cost, SAR</th><th class="num">Charge Rate, SAR</th><th>Supplier</th><th>Status</th></tr></thead><tbody>
    ${rows.map(m => `<tr class="click" data-href="#materials/edit/${encodeURIComponent(m.code)}"><td class="mono">${esc(m.code)}</td><td><b>${esc(m.name)}</b>${m.name2 ? `<br><span class="note" dir="rtl" lang="ar">${esc(m.name2)}</span>` : ''}</td><td>${esc(m.type || '—')}</td><td>${esc(m.unit)}</td>
      <td class="num">${m.onHand <= m.reorder ? `<b style="color:var(--bad)">${n0(m.onHand)}</b> <span class="pill p-bad">Reorder</span>` : n0(m.onHand)}</td><td class="num">${n0(m.reorder)}</td><td class="num">${sar(m.cost)}</td><td class="num">${m.charge ? sar(m.charge) : '—'}</td><td>${esc(m.supplier || '—')}</td><td>${pill(m.status)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${DB.materials.length ? 'No materials match the filters.' : 'No materials.'}</div>`;
  return head2('Items / SKU Master', 'VAS Materials', `<button type="button" class="btn" data-do="matReceive">Receive Stock</button><a class="btn pri" href="#materials/new">+ New Material</a>`)
    + filterBar('mat', [{ id: 'type', label: 'Type', options: optA(MAT_TYPES) }, { id: 'status', label: 'Status', options: optA(['Active', 'Inactive']) }, { id: 'low', label: 'Stock', options: [['low', 'At or below reorder level']] }, { id: 'q', type: 'text', label: 'Search code or name' }])
    + `<div class="grid g-kpi">${[['Materials', act.length], ['At or below reorder level', act.filter(m => m.onHand <= m.reorder).length], ['Stock value, SAR', sar(sum(DB.materials, m => m.onHand * m.cost))], ['Used this month', n0(-sum(DB.matMoves.filter(x => x.qty < 0 && String(x.at).slice(0, 7) === month), x => x.qty))]].map(k => `<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>`
    + card(`${rows.length} material${rows.length === 1 ? '' : 's'}`, body)
    + `<p class="note">Gray Lane's own consumables used on VAS work: film, labels, pallets, cartons. They are not customer stock. Stock goes down when a VAS job using them is verified.</p>`;
}
function materialForm(code) {
  const ed = !!matBy(code).code, m = ed ? matBy(code) : { code: '', name: '', name2: '', type: MAT_TYPES[0], desc: '', status: 'Active', unit: 'Roll', location: '', reorder: '', reorderQty: '', supplier: '', supCode: '', lead: '', cost: '', charge: '', vat: '0.15', svc: '' };
  const btns = `<a class="btn" href="#materials">Cancel</a>${ed ? `<button type="button" class="btn" data-do="matReceive" data-id="${esc(m.code)}">Receive Stock</button>` : '<button type="button" class="btn" data-do="matSave" data-id="new">Save &amp; New</button>'}<button type="button" class="btn pri" data-do="matSave" data-id="">${ed ? 'Save Changes' : 'Save Material'}</button>`;
  const F = (id, label, html, req, hint) => `<label class="field" for="${id}">${lab(label, req)}${html}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
  const I = (id, name, v, x = '') => `<input id="${id}" name="${name}" value="${esc(v ?? '')}" autocomplete="off" ${x}>`;
  const mv = DB.matMoves.filter(x => x.code === m.code).slice().reverse();
  return `${head2(`<a href="#materials" style="color:inherit">VAS Materials</a> / ${ed ? esc(m.code) : 'New'}`, ed ? esc(m.name) + ' ' + pill(m.status) + (m.onHand <= m.reorder ? ' <span class="pill p-bad">Reorder</span>' : '') : 'New Material', btns)}
  <form id="matForm" novalidate onsubmit="return false" style="display:flex;flex-direction:column;gap:14px" data-edit="${ed ? esc(m.code) : ''}"><div class="err" id="matErr" role="alert"></div>
  <section class="card"><div class="card-h"><h2>Material</h2><span class="note">Gray Lane's own consumable used on VAS work</span></div><div class="card-b igrid">
    ${F('mt_code', 'Material Code', `<input id="mt_code" class="mono ro-in" value="${esc(ed ? m.code : matNextCode())}" readonly tabindex="-1">`, 0, ed ? 'Fixed for this material.' : 'Assigned when you save.')}
    ${F('mt_type', 'Material Type', `<select id="mt_type" name="type">${opt(optA(MAT_TYPES), m.type)}</select>`, 1)}
    ${F('mt_st', 'Status', `<select id="mt_st" name="status">${opt(optA(['Active', 'Inactive']), m.status)}</select>`)}
    ${F('mt_name', 'Material Name (English)', I('mt_name', 'name', m.name, 'placeholder="e.g. Stretch film roll 500 m × 23 µm"'), 1)}
    ${F('mt_name2', 'Secondary Name (Arabic)', I('mt_name2', 'name2', m.name2, 'dir="rtl" lang="ar" placeholder="مثال: لفة تغليف"'))}
    ${F('mt_desc', 'Description', I('mt_desc', 'desc', m.desc, 'placeholder="Size, colour, specification"'))}
  </div></section>
  <section class="card"><div class="card-h"><h2>Stock &amp; Purchasing</h2><span class="note">Used to warn you before the material runs out</span></div><div class="card-b igrid">
    ${F('mt_unit', 'Unit', I('mt_unit', 'unit', m.unit, 'list="dl_matunit"'), 1)}
    ${F('mt_loc', 'Storage Location', I('mt_loc', 'location', m.location, 'placeholder="e.g. Consumables store, rack C-01"'))}
    ${ed ? F('mt_oh', 'On Hand', `<input id="mt_oh" value="${esc(n0(m.onHand) + ' ' + m.unit)}" readonly class="ro-in" tabindex="-1">`, 0, 'Change with Receive Stock.') : F('mt_open', 'Opening Stock', I('mt_open', 'opening', '', 'type="number" min="0" step="any" placeholder="0"'), 0, 'Quantity in the store today.')}
    ${F('mt_ro', 'Reorder Level', I('mt_ro', 'reorder', m.reorder, 'type="number" min="0"'), 1, 'Flag the material when stock falls to this level.')}
    ${F('mt_rq', 'Reorder Quantity', I('mt_rq', 'reorderQty', m.reorderQty || '', 'type="number" min="0" placeholder="Optional"'))}
    ${F('mt_lead', 'Lead Time, Days', I('mt_lead', 'lead', m.lead || '', 'type="number" min="0" placeholder="Optional"'))}
    ${F('mt_sup', 'Preferred Supplier', I('mt_sup', 'supplier', m.supplier, 'placeholder="Supplier name"'))}
    ${F('mt_sc', 'Supplier Item Code', I('mt_sc', 'supCode', m.supCode, 'class="mono"'))}
    ${F('mt_cost', 'Unit Cost, SAR', I('mt_cost', 'cost', m.cost, 'type="number" min="0" step="0.01"'), 1, 'Purchase price per unit, excluding VAT.')}
  </div></section>
  <section class="card"><div class="card-h"><h2>Charging</h2><span class="note">Only when a customer's contract says material is charged separately</span></div><div class="card-b igrid">
    ${F('mt_ch', 'Charge Rate to Customer, SAR', I('mt_ch', 'charge', m.charge || '', 'type="number" min="0" step="0.01" placeholder="Leave blank if never charged"'))}
    ${F('mt_vat', 'VAT', `<select id="mt_vat" name="vat">${opt(SD_VAT, m.vat || '0.15')}</select>`)}
    ${F('mt_svc', 'Linked Service Item', `<select id="mt_svc" name="svc"><option value="">— None —</option>${opt(M.services.filter(s => s.cat !== 'Storage').map(s => [s.code, s.code + ' · ' + s.name]), m.svc || '')}</select>`, 0, 'The VAS service this material is normally used for.')}
  </div></section>
  ${ed ? card(`Stock movements · ${mv.length}`, mv.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="num">Qty</th><th>By</th></tr></thead><tbody>${mv.map(x => `<tr><td>${esc(x.at)}</td><td>${esc(x.type)}</td><td class="mono">${esc(x.ref || '')}</td><td class="num"><b style="color:${x.qty > 0 ? 'var(--good)' : 'var(--bad)'}">${x.qty > 0 ? '+' : ''}${n0(x.qty)}</b></td><td>${esc(x.by)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No movements yet.</div>') : ''}
  <div class="form-foot">${btns}</div></form><datalist id="dl_matunit">${[...new Set([...MAT_UNITS, ...DB.materials.map(x => x.unit)])].map(u => `<option value="${esc(u)}">`).join('')}</datalist>`;
}

/* ---------------- Item groups, categories, units of measure ---------------- */
const grpBy = n => DB.groups.find(g => g.name === n) || { name: n, code: codeFrom(n, 'GRP'), desc: '', temp: '', cat: '', status: 'Active' };
const catBy = n => DB.cats.find(c => c.name === n) || { name: n, code: codeFrom(n, 'CAT'), desc: '', group: '', status: 'Active' };
const usedMsg = (its, tx) => its.length ? (its.some(i => tx(i.sku)) ? 'Used by items with transactions' : 'Used by ' + its.length + ' item(s)') : '';
function groupsPage() {
  const rows = groupNames().map(n => { const g = grpBy(n), its = DB.items.filter(i => i.group === n); return { g, its, blk: usedMsg(its, itemHasTx) }; });
  return head2('Items / SKU Master', 'Item Groups', `<a class="btn pri" href="#groups/new">+ New Item Group</a>`)
    + card(`${rows.length} groups`, `<div class="tbl-wrap"><table><thead><tr><th>Item Group</th><th>Code</th><th class="num">Items</th><th>Customers</th><th>Default Temp.</th><th class="num">On Hand</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-do="grpEdit" data-id="${esc(r.g.name)}"><td><b>${esc(r.g.name)}</b>${r.g.desc ? `<br><span class="note">${esc(r.g.desc)}</span>` : ''}</td><td class="mono">${esc(r.g.code)}</td><td class="num">${r.its.length}</td><td>${[...new Set(r.its.map(i => clName(i.client)))].map(esc).join(', ') || '—'}</td><td>${esc(r.g.temp || '—')}</td><td class="num">${n0(sum(r.its.filter(i => stockable(i) && i.variant !== 'template'), onHand))}</td><td>${pill(r.g.status)}</td>
      <td class="num"><div class="rowicons"><button type="button" class="btn sm" data-do="grpItems" data-id="${esc(r.g.name)}">Items</button>${rowIcons('grpEdit', 'grpDel', r.g.name, r.blk).replace(/^<div class="rowicons">|<\/div>$/g, '')}</div></td></tr>`).join('')}</tbody></table></div>`)
    + `<p class="note">A group or category that is used by items cannot be deleted; make it inactive instead. The lock icon shows why.</p>`;
}
function grpForm(name) {
  const m = name ? grpBy(name) : { status: 'Active' }, used = name ? DB.items.filter(i => i.group === name) : [], blk = name ? usedMsg(used, itemHasTx) : '';
  return { title: name ? 'Edit Item Group' : 'New Item Group', ic: 'grp', head: name || 'New item group', sub: 'Groups put similar customer items together for reporting and default settings.', badge: name ? used.length + ' items' : '', edit: !!name,
    del: name ? ['grpDel', name, blk] : null, auto: mfAutoCode('GRP'),
    secs: [['Group Details', [{ id: 'name', label: 'Item Group Name', req: 1, value: name || '', ph: 'e.g. Food - dry', span: 2 }, { id: 'code', label: 'Group Code', value: m.code || '', ph: 'Auto from name', mono: 1, help: 'Short code used in reports and imports' }]],
      ['Defaults for New Items', [{ id: 'temp', label: 'Default Temperature', type: 'select', blank: '— No default —', options: optA(TEMPS), value: m.temp || '' }, { id: 'cat', label: 'Default Category', type: 'select', blank: '— No default —', options: optA(catNames()), value: m.cat || '' }, statusSeg(m.status)]],
      ['Description', [{ id: 'desc', label: 'Description', type: 'textarea', value: m.desc || '', ph: 'What belongs in this group (optional)', span: 3 }]]],
    preview: v => mchip('grp', `<b class="mono">${esc(v.code || '—')}</b> · ${esc(v.name || 'Group name')}`) + (v.temp ? mchip('', esc(v.temp)) : '') + (v.cat ? mchip('', esc(v.cat)) : '') + stPill(v.status),
    again: () => grpForm(''),
    save: v => { if (!v.name) throw new Error('Enter the item group name.'); const dup = groupNames().find(g => g.toLowerCase() === v.name.toLowerCase() && g !== name); if (dup) throw new Error('Item group "' + dup + '" already exists.');
      const code = (v.code || codeFrom(v.name, 'GRP')).toUpperCase(); if (DB.groups.some(x => x.name !== name && x.code === code)) throw new Error('Group code ' + code + ' is already used.');
      const rec = { name: v.name, code, desc: v.desc, temp: v.temp, cat: v.cat, status: v.status || 'Active' };
      if (name && v.name !== name) DB.items.forEach(i => { if (i.group === name) i.group = v.name; });
      DB.groups = DB.groups.filter(x => x.name !== name); DB.groups.push(rec); DB.groups.sort((a, b) => a.name.localeCompare(b.name));
      return 'Item group ' + v.name + (name ? ' saved.' : ' added.'); } };
}
function catsPage() {
  const rows = catNames().map(n => { const c = catBy(n), its = DB.items.filter(i => i.category === n); return { c, its, blk: usedMsg(its, itemHasTx) }; });
  return head2('Items / SKU Master', 'Categories', `<a class="btn pri" href="#categories/new">+ New Category</a>`)
    + card(`${rows.length} categories`, `<div class="tbl-wrap"><table><thead><tr><th>Category</th><th>Code</th><th class="num">Items</th><th>Item Groups</th><th class="num">On Hand</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-do="catEdit" data-id="${esc(r.c.name)}"><td><b>${esc(r.c.name)}</b>${r.c.desc ? `<br><span class="note">${esc(r.c.desc)}</span>` : ''}</td><td class="mono">${esc(r.c.code)}</td><td class="num">${r.its.length}</td><td>${esc(r.c.group || [...new Set(r.its.map(i => i.group).filter(Boolean))].join(', ') || '—')}</td><td class="num">${n0(sum(r.its.filter(i => stockable(i) && i.variant !== 'template'), onHand))}</td><td>${pill(r.c.status)}</td>
      <td class="num">${rowIcons('catEdit', 'catDel', r.c.name, r.blk)}</td></tr>`).join('')}</tbody></table></div>`);
}
function catForm(name) {
  const m = name ? catBy(name) : { status: 'Active' }, used = name ? DB.items.filter(i => i.category === name) : [], blk = name ? usedMsg(used, itemHasTx) : '';
  return { title: name ? 'Edit Category' : 'New Category', ic: 'cat', head: name || 'New category', sub: 'Categories describe what the goods are (e.g. Groceries, Electronics) for reports and storage rules.', badge: name ? used.length + ' items' : '', edit: !!name,
    del: name ? ['catDel', name, blk] : null, auto: mfAutoCode('CAT'),
    secs: [['Category Details', [{ id: 'name', label: 'Category Name', req: 1, value: name || '', ph: 'e.g. Groceries', span: 2 }, { id: 'code', label: 'Category Code', value: m.code || '', ph: 'Auto from name', mono: 1 }]],
      ['Classification', [{ id: 'group', label: 'Item Group', type: 'select', blank: '— Any group —', options: optA(groupNames()), value: m.group || '', help: 'Optional: the group this category usually belongs to', span: 2 }, statusSeg(m.status)]],
      ['Description', [{ id: 'desc', label: 'Description', type: 'textarea', value: m.desc || '', ph: 'Optional', span: 3 }]]],
    preview: v => mchip('cat', `<b class="mono">${esc(v.code || '—')}</b> · ${esc(v.name || 'Category name')}`) + (v.group ? mchip('', esc(v.group)) : '') + stPill(v.status),
    again: () => catForm(''),
    save: v => { if (!v.name) throw new Error('Enter the category name.'); const dup = catNames().find(g => g.toLowerCase() === v.name.toLowerCase() && g !== name); if (dup) throw new Error('Category "' + dup + '" already exists.');
      const code = (v.code || codeFrom(v.name, 'CAT')).toUpperCase(); if (DB.cats.some(x => x.name !== name && x.code === code)) throw new Error('Category code ' + code + ' is already used.');
      const rec = { name: v.name, code, desc: v.desc, group: v.group, status: v.status || 'Active' };
      if (name && v.name !== name) DB.items.forEach(i => { if (i.category === name) i.category = v.name; });
      DB.cats = DB.cats.filter(x => x.name !== name); DB.cats.push(rec); DB.cats.sort((a, b) => a.name.localeCompare(b.name));
      return 'Category ' + v.name + (name ? ' saved.' : ' added.'); } };
}
const uomUse = code => ({ base: DB.items.filter(i => i.uom === code), conv: DB.items.filter(i => (i.conversions || []).some(c => c.uom === code)) });
const uomTx = code => DB.asns.some(a => a.lines.some(l => item(l.sku).uom === code)) || DB.contracts.some(k => (k.lines || []).some(l => l.unit === code));
const uomBlk = c => { const u = uomUse(c), n = u.base.length + u.conv.length; return n ? 'Used by ' + n + ' item(s)' : uomTx(c) ? 'Used in transactions' : ''; };
function uomPage() {
  const convs = DB.items.flatMap(i => (i.conversions || []).map(c => ({ i, c })));
  return head2('Items / SKU Master', 'Units of measure', `<a class="btn pri" href="#uom/new">+ New Unit</a>`)
    + card(`${DB.uoms.length} units`, `<div class="tbl-wrap"><table><thead><tr><th>Unit code</th><th>Name</th><th>Arabic name</th><th>Type</th><th>Decimals</th><th class="num">Base unit of</th><th class="num">In conversions</th><th>Status</th><th></th></tr></thead><tbody>
    ${DB.uoms.map(u => { const us = uomUse(u.code); return `<tr class="click" data-do="uomEdit" data-id="${esc(u.code)}"><td><b class="mono">${esc(u.code)}</b></td><td>${esc(u.name)}</td><td>${u.ar ? `<span dir="rtl" lang="ar">${esc(u.ar)}</span>` : '—'}</td><td>${esc(u.type)}</td><td>${u.dec ? 'Allowed' : 'Whole numbers'}</td>
      <td class="num">${n0(us.base.length)} item${us.base.length === 1 ? '' : 's'}</td><td class="num">${n0(us.conv.length)} item${us.conv.length === 1 ? '' : 's'}</td><td>${pill(u.status || 'Active')}</td><td class="num">${rowIcons('uomEdit', 'uomDel', u.code, uomBlk(u.code))}</td></tr>`; }).join('')}</tbody></table></div>`)
    + card('Conversions in use', convs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Conversion</th></tr></thead><tbody>${convs.map(r => `<tr><td>${itemCell(r.i.sku)}</td><td>1 ${esc(r.c.uom)} = ${n0(r.c.factor)} ${esc(r.i.uom)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No conversions yet. Add them on the item form.</div>')
    + `<p class="note">Conversions are set per item, because a carton of rice and a carton of phones hold different quantities. Inactive units stay on existing items but are not offered for new ones.</p>`;
}
function uomForm(code) {
  const u = DB.uoms.find(x => x.code === code) || { type: 'Count', dec: false, status: 'Active' }, used = code ? uomUse(code) : { base: [], conv: [] }, n = used.base.length + used.conv.length;
  return { title: code ? 'Edit Unit of Measure' : 'New Unit of Measure', ic: 'uom', head: code ? u.code + ' · ' + u.name : 'New unit of measure', sub: 'Units are used on items, ASNs and orders. Conversions (e.g. 1 Carton = 12 Pieces) are set per item.', badge: code ? n + ' items' : '', edit: !!code,
    del: code ? ['uomDel', code, uomBlk(code) ? uomBlk(code) + '. Make it inactive instead.' : ''] : null,
    secs: [['Unit', [{ id: 'code', label: 'Unit Code', req: 1, value: u.code || '', ph: 'e.g. CTN', mono: 1, help: 'Up to 15 characters, starts with a letter' }, { id: 'name', label: 'Unit Name', req: 1, value: u.name || '', ph: 'e.g. Carton' }, { id: 'ar', label: 'Arabic Name', value: u.ar || '', ph: 'كرتون', dir: 'rtl' }]],
      ['Behaviour', [{ id: 'type', label: 'Unit Type', type: 'select', options: optA(UOM_TYPES), value: u.type }, { id: 'dec', label: 'Quantities', type: 'seg', options: [['0', 'Whole'], ['1', 'Decimals']], value: u.dec ? '1' : '0' }, statusSeg(u.status)]],
      ['Description', [{ id: 'desc', label: 'Description', type: 'textarea', value: u.desc || '', ph: 'Optional, e.g. standard export carton', span: 3 }]]],
    preview: v => mchip('uom', `<b class="mono">${esc(v.code || '—')}</b> · ${esc(v.name || 'Unit name')}${v.ar ? ` · <span dir="rtl" lang="ar">${esc(v.ar)}</span>` : ''}`) + mchip('', esc(v.type || '')) + mchip('', v.dec === '1' ? 'e.g. 2.5' : 'e.g. 3') + stPill(v.status),
    again: () => uomForm(''),
    save: v => { if (!/^[A-Za-z][A-Za-z0-9 .\-]{0,14}$/.test(v.code)) throw new Error('The unit code starts with a letter and has up to 15 letters, digits, spaces, dots or dashes.'); if (!v.name) throw new Error('Enter the unit name.');
      if (DB.uoms.some(x => x.code.toLowerCase() === v.code.toLowerCase() && x.code !== code)) throw new Error('Unit ' + v.code + ' already exists.');
      const rec = { code: v.code, name: v.name, ar: v.ar, type: v.type, dec: v.dec === '1', status: v.status || 'Active', desc: v.desc };
      if (code) { const old = DB.uoms.find(x => x.code === code); if (v.code !== code) DB.items.forEach(i => { if (i.uom === code) i.uom = v.code; (i.conversions || []).forEach(c => { if (c.uom === code) c.uom = v.code; }); }); Object.assign(old, rec); }
      else DB.uoms.push(rec);
      return 'Unit ' + v.code + (code ? ' saved.' : ' added.'); } };
}

/* ---------------- items actions ---------------- */
Object.assign(DO, {
  mClose() { closeModal(); },
  mfSave(mode) {
    try { const msg = mfCtx.save(mfRead()); persist(); const again = mfCtx.again; closeModal(); route(); toast(msg); if (mode === 'new') mfOpen(again()); }
    catch (e) { const b = $('#mfErr'); if (b) b.textContent = e.message; }
  },
  grpEdit(n) { mfOpen(grpForm(n)); }, catEdit(n) { mfOpen(catForm(n)); }, uomEdit(c) { mfOpen(uomForm(c)); },
  grpItems(n) { FILT.items = { group: n }; go('#items'); },
  grpDel(n) { if (DB.items.some(i => i.group === n)) return toast(n + ' is used by items and cannot be deleted. Make it inactive instead.'); if (!confirm('Delete item group ' + n + '? This cannot be undone.')) return; DB.groups = DB.groups.filter(g => g.name !== n); persist(); closeModal(); route(); toast('Item group ' + n + ' deleted.'); },
  catDel(n) { if (DB.items.some(i => i.category === n)) return toast(n + ' is used by items and cannot be deleted. Make it inactive instead.'); if (!confirm('Delete category ' + n + '? This cannot be undone.')) return; DB.cats = DB.cats.filter(g => g.name !== n); persist(); closeModal(); route(); toast('Category ' + n + ' deleted.'); },
  uomDel(c) { if (uomBlk(c)) return toast(c + ' is in use and cannot be deleted. Make it inactive instead.'); if (!confirm('Delete unit ' + c + '? This cannot be undone.')) return; DB.uoms = DB.uoms.filter(x => x.code !== c); persist(); closeModal(); route(); toast('Unit ' + c + ' deleted.'); },
  itAddConv() { const box = $('#convBox'); box.querySelector('.btn').insertAdjacentHTML('beforebegin', convRow({}, $('#itemForm [name=uom]').value)); },
  itDelConv(_, b) { b.closest('.crow').remove(); },
  itSave(mode) {
    const fm = $('#itemForm'), editId = fm.dataset.edit;
    try { const d = readItemForm(), r = saveItem(d, editId); persist();
      toast(editId ? r.item.sku + ' updated.' : `${r.item.code} · ${r.item.sku} created${r.variants ? ` with ${r.variants} variants` : ''}${r.opening ? `, ${n0(r.opening)} ${r.item.uom} opening stock` : ''}.`);
      go(mode === 'new' ? '#items/new' : '#items'); }
    catch (e) { formErr('#itErr', e); }
  },
  itDelete(sku) {
    const it = item(sku), skus = [sku, ...DB.items.filter(v => v.parent === sku).map(v => v.sku)];
    if (skus.some(itemHasTx)) return toast(it.name + ' is on ASNs or orders. Set it to Inactive instead of deleting.');
    if (skus.some(s => onHand(item(s)) > 0)) return toast(it.name + ' has stock in the warehouse. Set it to Inactive instead of deleting.');
    if (!confirm('Delete ' + it.name + (skus.length > 1 ? ' and its ' + (skus.length - 1) + ' variants' : '') + '? This cannot be undone.')) return;
    DB.items = DB.items.filter(i => !skus.includes(i.sku)); persist(); toast(sku + ' deleted.'); go('#items');
  },
  matSave(mode) {
    const fm = $('#matForm'), editId = fm.dataset.edit, g = n => { const el = fm.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
    try {
      const name = g('name'); if (!name) throw new Error('Enter the material name.'); if (!g('unit')) throw new Error('Enter the unit.');
      if (g('cost') === '' || !(+g('cost') >= 0)) throw new Error('Enter the unit cost.'); if (g('reorder') === '' || !(+g('reorder') >= 0)) throw new Error('Enter the reorder level (0 if none).');
      if (DB.materials.some(x => x.name.toLowerCase() === name.toLowerCase() && x.code !== editId)) throw new Error('A material named "' + name + '" already exists.');
      const v = { name, name2: g('name2'), type: g('type'), desc: g('desc'), status: g('status'), unit: g('unit'), location: g('location'), reorder: +g('reorder') || 0, reorderQty: +g('reorderQty') || 0, lead: +g('lead') || 0, supplier: g('supplier'), supCode: g('supCode'), cost: +g('cost') || 0, charge: +g('charge') || 0, vat: g('vat'), svc: g('svc') };
      if (editId) { const m = matBy(editId), ch = Object.keys(v).filter(k => String(m[k] ?? '') !== String(v[k] ?? '')); Object.assign(m, v); if (ch.length) matLog(m, 'Edited: ' + ch.join(', ')); persist(); toast(m.code + ' saved.'); return go('#materials'); }
      const open = +g('opening') || 0, m = { code: matNextCode(), ...v, onHand: open, created: iso(today), by: DATA.user.name, log: [] };
      DB.materials.push(m); DB.seq.MAT = +m.code.slice(4) + 1; matLog(m, 'Created' + (open ? ' with opening stock ' + open + ' ' + m.unit : ''));
      if (open) DB.matMoves.push({ at: nowStamp(), code: m.code, type: 'Opening stock', ref: '', qty: open, by: DATA.user.name });
      persist(); toast(m.code + ' · ' + m.name + ' created.'); go(mode === 'new' ? '#materials/new' : '#materials');
    } catch (e) { formErr('#matErr', e); }
  },
  matReceive(code) {
    const act = DB.materials.filter(m => m.status === 'Active');
    modal('Receive VAS material', `<form id="rcvForm" class="fgrid f2" onsubmit="return false">
      <label class="field" style="grid-column:1/-1"><span class="flbl">Material<span class="req"> *</span></span><select name="code">${opt(act.map(m => [m.code, m.code + ' · ' + m.name + ' (' + n0(m.onHand) + ' ' + m.unit + ' on hand)']), code || '')}</select></label>
      <label class="field"><span class="flbl">Quantity received<span class="req"> *</span></span><input name="qty" type="number" min="1" step="any"></label>
      <label class="field"><span class="flbl">Supplier invoice / PO no.</span><input name="ref" autocomplete="off"></label></form><div class="err" id="rcvErr" role="alert"></div>`,
      `<button type="button" class="btn" data-do="mClose">Cancel</button><button type="button" class="btn pri" data-do="matRcvSave">Receive</button>`);
  },
  matRcvSave() {
    const f = $('#rcvForm'), m = matBy(f.code.value), q = +f.qty.value;
    if (!m.code) return $('#rcvErr').textContent = 'Choose the material.';
    if (!(q > 0)) return $('#rcvErr').textContent = 'Enter the quantity received.';
    m.onHand += q; DB.matMoves.push({ at: nowStamp(), code: m.code, type: 'Received', ref: f.ref.value.trim(), qty: q, by: DATA.user.name }); matLog(m, 'Received ' + q + ' ' + m.unit);
    persist(); closeModal(); route(); toast(n0(q) + ' ' + m.unit + ' of ' + m.name + ' received.');
  }
});
document.addEventListener('input', e => { if (e.target.closest('#mfForm')) { if (e.target.id === 'mf_code') e.target.dataset.auto = '0'; else if (mfCtx && mfCtx.auto) mfCtx.auto(e.target); mfPrev(); } if (e.target.closest('#itemForm')) updateItemForm(e.target); });
document.addEventListener('change', e => { if (e.target.closest('#mfForm')) mfPrev(); if (e.target.closest('#itemForm')) updateItemForm(e.target); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modalRoot') && !$('#modalRoot').hidden) closeModal(); });
