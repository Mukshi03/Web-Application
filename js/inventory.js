'use strict';
/* =====================================================================
   INVENTORY  (ERP: stock, holds, moves, transfers, counts, adjustments, damage, ledger, ageing, statement)
   ===================================================================== */
const REASONS = ['Damaged in warehouse', 'Count variance', 'Expired', 'Customer return', 'Supplier short shipment', 'QC rejection', 'Lost / missing', 'Disposed'];
const MOVE_REASONS = ['Relocation', 'Replenishment', 'Consolidation', 'Quarantine', 'Damaged goods', 'Expired goods', 'Return to stock'];
const INV_DMG_TYPES = ['Damaged', 'Lost / missing', 'Expired in custody', 'Contaminated'];
const INV_DMG_CAUSES = ['Handling / forklift', 'Storage condition', 'Racking / fall', 'Pest', 'Theft', 'Packaging failure', 'Unknown'];
const INV_LIAB = ['Gray Lane (warehouse)', 'Customer', 'Carrier / transporter', 'Supplier', 'Insurance'];
const INV_CLAIM = ['Open', 'Under investigation', 'Claim raised', 'Settled', 'Rejected', 'Written off'];
const INV_AGE = [[0, 30, '0–30 days'], [31, 60, '31–60 days'], [61, 90, '61–90 days'], [91, 180, '91–180 days'], [181, 1e9, 'Over 180 days']];
Object.assign(TONE, { Hold: 'warn', 'In transit': 'info', Open: 'warn', Done: 'good', Posted: 'good', Rejected: 'mute', Pending: 'warn', 'Under investigation': 'warn', 'Claim raised': 'info', Settled: 'good', 'Written off': 'mute' });
const invAge = s => s.received ? Math.max(0, daysBetween(String(s.received).slice(0, 10), iso(today))) : 0;
const invBucket = d => INV_AGE.findIndex(b => d >= b[0] && d <= b[1]);
const invLiabTone = l => /Gray Lane/.test(l) ? 'bad' : /Customer/.test(l) ? 'mute' : 'info';
const invQty = (rows, f) => sum(rows.filter(f), s => s.qty);
const lpnBy = l => DB.stock.find(s => s.lpn === l);
const frozen = w => SET_FREEZE && DB.counts.some(c => c.type === 'Stock count' && c.status === 'Open' && c.wh === w);
const usageBin = (w, u) => DB.bins.find(b => b.wh === w && b.usage === u && b.status !== 'Blocked');
const nidN = (pfx, list) => pfx + '-' + String(1 + Math.max(0, ...list.map(x => +String(x.id).split('-').pop() || 0))).padStart(3, '0');
const docNoL = (k, loc) => seqNo(k + '@' + loc, k + '-' + loc + '-', 5);
const expPill = d => !d ? '—' : d < iso(today) ? `${fmtDate(d)} <span class="pill p-bad">Expired</span>` : daysBetween(iso(today), d) <= SET_EXP_DAYS ? `${fmtDate(d)} <span class="pill p-warn">${daysBetween(iso(today), d)} days</span>` : fmtDate(d);
function checkBin(b, cl, code, w) {
  if (!b) throw new Error('Bin ' + code + ' does not exist in ' + whRec(w).name + '.');
  if (placeBlocked(b)) throw new Error('Bin ' + code + ' is blocked for placement.');
  if (b.cap < 99 && binCount(b) >= b.cap) throw new Error('Bin ' + code + ' is full (' + binCount(b) + ' of ' + b.cap + ' pallets).');
  if (b.client && b.client !== cl) throw new Error('Bin ' + code + ' is reserved for ' + clName(b.client) + '.');
}

/* ---- stock operations (ERP OPS) ---- */
const INV = {
  setStatus(lpn, status, at = iso(today)) { const s = lpnBy(lpn); if (!s) throw new Error('LPN not found.'); if (s.alloc > 0) throw new Error('This pallet is allocated to an order.'); s.status = status; ibMove(at, 'Status: ' + status, '', s, 0); },
  adjust(lpn, newQty, ref, at = iso(today)) { const s = lpnBy(lpn); if (!s) throw new Error('LPN not found.'); newQty = +newQty; if (newQty < (s.alloc || 0)) throw new Error('New quantity is below the allocated quantity (' + s.alloc + ').');
    const d = newQty - s.qty; if (!d) return; s.qty = newQty; ibMove(at, 'Adjustment', ref || 'Adjustment', s, d); if (s.qty <= 0) DB.stock = DB.stock.filter(x => x.lpn !== lpn); },
  createMove({ lpn, to, reason }, at = iso(today)) {
    const s = lpnBy(lpn); if (!s) throw new Error('Choose a pallet.'); if (s.status === 'In transit') throw new Error('This pallet is on a transfer order.');
    if (s.alloc > 0) throw new Error('This pallet is reserved for an order. Pick or cancel the order first.'); if (frozen(s.wh)) throw new Error(whRec(s.wh).name + ' is frozen for a stock count.');
    to = String(to || '').trim().toUpperCase(); checkBin(binRec(s.wh, to), s.client, to, s.wh);
    if (to === s.bin) throw new Error('The pallet is already in ' + to + '.'); if (DB.moveOrders.some(m => m.lpn === lpn && m.status === 'Open')) throw new Error('This pallet already has an open move order.');
    const m = { id: docNoL('MO', whRec(s.wh).loc), lpn, sku: s.sku, client: s.client, wh: s.wh, from: s.bin, to, reason: reason || 'Relocation', status: 'Open', created: at, done: null, by: '' }; DB.moveOrders.push(m); return m; },
  completeMove(id, at = iso(today)) {
    const m = DB.moveOrders.find(x => x.id === id); if (!m || m.status !== 'Open') throw new Error('This move order is not open.');
    const s = lpnBy(m.lpn); if (!s) throw new Error('The pallet is no longer in stock. Cancel this move order.'); if (s.alloc > 0) throw new Error('The pallet was reserved for an order after this move was planned. Cancel the move.');
    if (frozen(s.wh)) throw new Error(whRec(s.wh).name + ' is frozen for a stock count.');
    s.bin = m.to; ibMove(at, 'Bin move', m.id, s, 0); m.status = 'Done'; m.done = at; m.by = DATA.user.name;
    const ns = { Quarantine: 'Hold', 'Expired goods': 'Hold', 'Damaged goods': 'Damaged' }[m.reason]; if (ns && s.status === 'Available') { s.status = ns; ibMove(at, 'Status: ' + ns, m.id, s, 0); } },
  cancelMove(id) { const m = DB.moveOrders.find(x => x.id === id); if (!m || m.status !== 'Open') throw new Error('Only open move orders can be cancelled.'); m.status = 'Cancelled'; },
  createTO({ from, to, date, ref, lpns }, at = iso(today)) {
    if (!from || !to) throw new Error('Choose both warehouses.'); if (from === to) throw new Error('Choose two different warehouses.'); if (!lpns || !lpns.length) throw new Error('Choose at least one pallet to transfer.');
    if (frozen(from)) throw new Error(whRec(from).name + ' is frozen for a stock count.');
    const lines = lpns.map(l => { const s = lpnBy(l); if (!s || s.wh !== from) throw new Error(l + ' is not in ' + whRec(from).name + '.'); if (s.alloc > 0 || s.status !== 'Available') throw new Error(l + ' is not available to transfer.');
      if (DB.transfers.some(t => ['Draft', 'In transit'].includes(t.status) && t.lines.some(x => x.lpn === l))) throw new Error(l + ' is already on another transfer order.'); return { lpn: l, sku: s.sku, client: s.client, qty: s.qty, batch: s.batch }; });
    const t = { id: docNoL('TO', whRec(from).loc), loc: whRec(from).loc, toLoc: whRec(to).loc, from, to, date: date || at, ref: ref || '', status: 'Draft', created: at, lines }; DB.transfers.push(t); return t; },
  shipTO(id, at = iso(today)) { const t = DB.transfers.find(x => x.id === id); if (!t || t.status !== 'Draft') throw new Error('Only draft transfer orders can be shipped.');
    t.lines.forEach(l => { const s = lpnBy(l.lpn); if (!s || s.alloc > 0 || s.status !== 'Available') throw new Error(l.lpn + ' is no longer available. Cancel and recreate the transfer.'); });
    t.lines.forEach(l => { const s = lpnBy(l.lpn); ibMove(at, 'Transfer out', t.id, s, -s.qty); s.status = 'In transit'; s.bin = 'IN-TRANSIT'; l.qty = s.qty; }); t.status = 'In transit'; t.shipped = at; },
  receiveTO(id, at = iso(today)) { const t = DB.transfers.find(x => x.id === id); if (!t || t.status !== 'In transit') throw new Error('Only transfers in transit can be received.');
    const taken = [];
    t.lines.forEach(l => { const s = lpnBy(l.lpn); if (!s) return; s.wh = t.to; s.bin = ibDock(t.to).code; s.status = 'Received'; ibMove(at, 'Transfer in', t.id, s, s.qty);
      const b = ibSuggest(t.to, s.sku, s.client, taken)[0], to = b ? b.code : ''; if (to) taken.push(to);
      DB.tasks.push({ id: seqNo('PUT', 'PUT-', 4), lpn: s.lpn, wh: t.to, from: s.bin, to, suggested: to, status: 'Open', created: at, done: null, by: '', asn: '', transfer: t.id }); });
    t.status = 'Received'; t.received = at; },
  cancelTO(id) { const t = DB.transfers.find(x => x.id === id); if (!t || t.status !== 'Draft') throw new Error('Only draft transfer orders can be cancelled.'); t.status = 'Cancelled'; },
  createCount({ type = 'Cycle count', wh: w, bin, zoneId }, at = iso(today)) {
    if (!w) throw new Error('Choose a warehouse.'); let pal = DB.stock.filter(s => s.wh === w && s.status !== 'In transit'), scope;
    if (type === 'Stock count') { if (frozen(w)) throw new Error('A stock count is already open for ' + whRec(w).name + '.'); if (zoneId) { pal = pal.filter(s => (binRec(w, s.bin) || {}).zoneId === zoneId); scope = 'Zone: ' + zoneBy(zoneId).name; } else scope = 'Whole warehouse'; }
    else if (bin) { bin = String(bin).trim().toUpperCase(); pal = pal.filter(s => s.bin === bin); scope = 'Bin ' + bin; }
    else if (zoneId) { pal = pal.filter(s => (binRec(w, s.bin) || {}).zoneId === zoneId); scope = 'Zone: ' + zoneBy(zoneId).name; }
    else throw new Error('Enter a bin code or choose a zone to count.');
    if (!pal.length) throw new Error('No pallets found in ' + scope.replace(/^Zone/, 'zone') + '.');
    const c = { id: nidN(type === 'Stock count' ? 'SC' : 'CC', DB.counts.filter(x => (x.type === 'Stock count') === (type === 'Stock count'))), type, wh: w, scope, status: 'Open', created: at, lines: pal.map(s => ({ lpn: s.lpn, sku: s.sku, bin: s.bin, expected: s.qty, counted: null })) };
    DB.counts.push(c); return c; },
  postCount(id, counted, at = iso(today)) {
    const c = DB.counts.find(x => x.id === id); if (!c || c.status !== 'Open') throw new Error('Count already posted.');
    counted.forEach((v, i) => { if (v === '' || !(+v >= 0) || !Number.isInteger(+v)) throw new Error('Line ' + (i + 1) + ': enter the counted quantity as a whole number (0 if the pallet is gone).'); });
    c.lines.forEach((l, i) => { l.counted = +counted[i]; if (l.counted === l.expected) return; const s = lpnBy(l.lpn); if (!s) { l.note = 'Pallet no longer in stock'; return; }
      const a = { id: docNoL('ADJ', whRec(s.wh).loc), lpn: l.lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, before: s.qty, after: l.counted, diff: l.counted - s.qty, reason: c.type + ' variance', note: '', status: 'Posted', created: at, approved: at, by: c.type, source: c.id };
      try { INV.adjust(l.lpn, l.counted, a.id, at); DB.adjustments.push(a); } catch (e) { l.note = e.message; } });
    c.status = 'Posted'; c.posted = at; },
  requestAdj({ lpn, qty, reason, note }, at = iso(today)) {
    const s = lpnBy(lpn); if (!s) throw new Error('Choose a pallet.'); qty = qty === '' ? NaN : +qty; if (!(qty >= 0) || !Number.isInteger(qty)) throw new Error('Enter the correct quantity as a whole number.');
    if (qty === s.qty) throw new Error('The new quantity is the same as the current quantity.'); if (qty < (s.alloc || 0)) throw new Error('The new quantity is below the quantity reserved for orders (' + s.alloc + ').');
    if (DB.adjustments.some(a => a.lpn === lpn && a.status === 'Pending')) throw new Error('This pallet already has an adjustment waiting for approval.');
    const a = { id: docNoL('ADJ', whRec(s.wh).loc), lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, before: s.qty, after: qty, diff: qty - s.qty, reason: reason || 'Adjustment', note: note || '', status: 'Pending', created: at, source: 'Manual' };
    DB.adjustments.push(a); return a; },
  approveAdj(id, at = iso(today)) { const a = DB.adjustments.find(x => x.id === id); if (!a || a.status !== 'Pending') throw new Error('This adjustment is not waiting for approval.');
    const s = lpnBy(a.lpn); if (!s) throw new Error('The pallet is no longer in stock. Reject this request.'); if (s.qty !== a.before) throw new Error(`The pallet now holds ${s.qty}, not ${a.before}. Reject this request and raise a new one.`);
    INV.adjust(a.lpn, a.after, a.id, at); a.status = 'Posted'; a.approved = at; a.by = DATA.user.name; },
  rejectAdj(id, at = iso(today)) { const a = DB.adjustments.find(x => x.id === id); if (!a || a.status !== 'Pending') throw new Error('This adjustment is not waiting for approval.'); a.status = 'Rejected'; a.approved = at; a.by = DATA.user.name; },
  holdBatch({ client: cl, sku, batch }, at = iso(today)) { const hit = DB.stock.filter(s => s.client === cl && s.sku === sku && s.batch === batch && s.status === 'Available'); if (!hit.length) throw new Error('No available pallets of batch ' + batch + ' for that item.');
    const busy = hit.filter(s => s.alloc > 0); hit.filter(s => !s.alloc).forEach(s => { s.status = 'Hold'; ibMove(at, 'Status: Hold', 'Batch hold ' + batch, s, 0); }); return { held: hit.length - busy.length, busy: busy.length }; },
  createDmg(v) { const s = v.lpn ? lpnBy(v.lpn) : null, qty = +v.qty; if (!s) throw new Error('Choose the pallet affected.'); if (!(qty > 0) || !Number.isInteger(qty)) throw new Error('Enter the quantity affected as a whole number.'); if (qty > s.qty) throw new Error('The pallet holds only ' + s.qty + '.');
    const loc = whRec(s.wh).loc, d = { id: docNoL('DMG', loc), date: v.date || iso(today), client: s.client, sku: s.sku, lpn: s.lpn, wh: s.wh, bin: s.bin, batch: s.batch || '', type: v.type, cause: v.cause, liab: v.liab, claim: v.claim || 'Open', qty, value: +v.value || 0, note: v.note || '', by: DATA.user.name, adj: '' };
    if (v.date > iso(today)) throw new Error('The date found cannot be in the future.');
    if (v.raiseAdj === '1') { const reason = /Lost/.test(v.type) ? 'Lost / missing' : /Expired/.test(v.type) ? 'Expired' : 'Damaged in warehouse'; const a = INV.requestAdj({ lpn: s.lpn, qty: s.qty - qty, reason, note: d.id + ' · ' + v.type + ' · ' + v.cause }); d.adj = a.id; }
    DB.damages.push(d); return d; }
};

/* ---- pop-up form (like the ERP's form()) ---- */
let fmCtx = null;
function formModal(title, fields, onSubmit, label = 'Save') {
  fmCtx = { fields, onSubmit };
  const F = f => { const id = 'fm_' + f.id, req = f.req ? '<span class="req"> *</span>' : '', v = f.value ?? '';
    if (f.type === 'html') return `<div style="grid-column:1/-1">${f.html}</div>`;
    let inp; if (f.type === 'select') inp = `<select id="${id}" name="${f.id}">${f.blank ? `<option value="">${f.blank === 1 ? '— None —' : esc(f.blank)}</option>` : ''}${opt(f.options.map(([a, b]) => [String(a), b]), String(v))}</select>`;
    else if (f.type === 'textarea') inp = `<textarea id="${id}" name="${f.id}" rows="3">${esc(v)}</textarea>`;
    else if (f.type === 'checks') inp = `<div class="fm-checks">${f.options.length ? f.options.map(([a, b], i) => `<label class="chk"><input type="checkbox" name="${f.id}" value="${esc(a)}" ${f.checked && f.checked(a, i) ? 'checked' : ''}> ${esc(b)}</label>`).join('') : '<p class="note" style="margin:0">Nothing to choose.</p>'}</div>`;
    else inp = `<input id="${id}" name="${f.id}" type="${f.type || 'text'}" value="${esc(v)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.list ? `list="${f.list}"` : ''} autocomplete="off">`;
    return `<label class="field${f.full || ['textarea', 'checks'].includes(f.type) ? ' fm-full' : ''}" ${f.type === 'checks' ? '' : `for="${id}"`}><span class="flbl">${esc(f.label)}${req}</span>${inp}${f.hint ? `<small class="hint">${f.hint}</small>` : ''}</label>`; };
  modal(title, `<form id="fmForm" class="fgrid f2" onsubmit="return false">${fields.map(F).join('')}</form><div class="err" id="fmErr" role="alert"></div>`,
    `<button type="button" class="btn" data-do="mClose">Cancel</button><button type="button" class="btn pri" data-do="fmSubmit">${label}</button>`, 'fm-modal');
}
function fmRead() { const f = $('#fmForm'), v = {}; fmCtx.fields.forEach(x => { if (!x.id || x.type === 'html') return; if (x.type === 'checks') v[x.id] = [...f.querySelectorAll(`[name="${x.id}"]:checked`)].map(i => i.value); else { const el = f.querySelector(`[name="${x.id}"]`); v[x.id] = el ? el.value.trim() : ''; } }); return v; }
const invDone = msg => { persist(); closeModal(); route(); toast(msg); };

/* ---- LPN detail ---- */
function lpnModal(lpn) {
  const s = lpnBy(lpn); if (!s) return toast(lpn + ' is no longer in stock.');
  const it = item(s.sku), mv = DB.moves.filter(m => m.lpn === lpn).slice().reverse();
  modal('Pallet ' + lpn, `<div class="dl">${[['Item', esc(it.name) + `<br><span class="note mono">${esc(it.code || '')} · ${esc(s.sku)}</span>`], ['Customer', esc(clName(s.client))], ['Location', esc(whRec(s.wh).name) + `<br><span class="mono">${esc(s.bin)}</span>`], ['Status', pill(s.status)], ['Quantity', n0(s.qty) + ' ' + esc(it.uom || '')], ['Reserved', n0(s.alloc || 0)], ['Batch', esc(s.batch || '—')], ['Expiry', expPill(s.expiry)], ['Received', fmtDate(String(s.received || '').slice(0, 10))], ['Age, days', invAge(s)], ['From ASN', esc(s.asn || '—')]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <h3 style="margin:6px 0 0;font-size:13px">Movement history</h3>${tbl([['Date', m => fmtDate(String(m.at).slice(0, 10))], ['Type', m => esc(m.type)], ['Reference', m => `<span class="mono">${esc(m.ref || '')}</span>`], ['Bin', m => `<span class="mono">${esc(m.bin || '')}</span>`], ['Qty', m => m.qty ? `<b style="color:${m.qty > 0 ? 'var(--good)' : 'var(--bad)'}">${m.qty > 0 ? '+' : ''}${n0(m.qty)}</b>` : '—', 1]], mv, null, 'No movements recorded.')}`,
    `<button type="button" class="btn" data-do="mClose">Close</button>${stockActs(s)}`, 'lpn-modal');
}
const stockActs = s => s.status === 'In transit' ? '<span class="note">On a transfer</span>' : `<button type="button" class="btn sm" data-do="invAdjust" data-id="${esc(s.lpn)}">Adjust</button>${s.status === 'Available' ? `<button type="button" class="btn sm" data-do="invHold" data-id="${esc(s.lpn)}">Hold</button>` : ['Hold', 'Damaged'].includes(s.status) ? `<button type="button" class="btn sm" data-do="invRelease" data-id="${esc(s.lpn)}">Release</button>` : ''}<button type="button" class="btn sm" data-do="invMoveLpn" data-id="${esc(s.lpn)}">Move</button>`;
const lpnCell = s => `<a class="mono" href="#" data-do="invLpn" data-id="${esc(s.lpn)}">${esc(s.lpn)}</a>`;
const stockCols = acts => [['LPN', lpnCell], ['Item', s => itemCell(s.sku)], ['Customer', s => esc(clName(s.client))], ['Location', s => `${esc(whRec(s.wh).name)}<br><span class="mono">${esc(s.bin)}</span>`], ['Batch', s => esc(s.batch) || '—'], ['Expiry', s => expPill(s.expiry)], ['Received', s => fmtDate(String(s.received || '').slice(0, 10))],
  ['Qty', s => n0(s.qty), 1], ['Allocated', s => s.alloc ? n0(s.alloc) : '—', 1], ['Status', s => pill(s.status)], ...(acts ? [['', s => `<div class="rowicons">${stockActs(s)}</div>`]] : [])];
const csvBtn = k => `<button type="button" class="btn" data-do="invCsv" data-id="${k}">Copy as CSV</button>`;
const kpis4 = list => `<div class="grid g-kpi">${list.map(k => `<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>`;
const custOpts2 = () => DB.customers.map(c => [c.id, c.name]);
const whOpts2 = () => DB.warehouses.map(w => [w.id, w.name]);

/* ---- pages ---- */
function stockPage() {
  const rows = applyFilt('stk', DB.stock, { q: (s, v) => (s.lpn + ' ' + s.sku + ' ' + (s.batch || '') + ' ' + (item(s.sku).name || '') + ' ' + s.bin).toLowerCase().includes(v.toLowerCase()) });
  return head2('Inventory', 'Stock', csvBtn('stock')) + filterBar('stk', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'wh', label: 'Warehouse', options: whOpts2() }, { id: 'status', label: 'Status', options: optA(['Received', 'Available', 'Hold', 'Damaged', 'In transit']) }, { id: 'q', type: 'text', label: 'Search LPN, SKU, batch, bin' }])
    + kpis4([['Pallets', rows.length], ['Units', n0(sum(rows, s => s.qty))], ['Reserved for orders', n0(sum(rows, s => s.alloc || 0))], ['On hold or damaged', rows.filter(s => ['Hold', 'Damaged'].includes(s.status)).length]])
    + card(`${rows.length} pallets`, tbl(stockCols(true), rows, null, 'No stock matches.'));
}
function byCustPage() {
  const f = FILT.byc || {}, base = DB.stock.filter(s => !f.wh || s.wh === f.wh);
  const kpi = rows => kpis4([['On hand', n0(invQty(rows, () => 1))], ['Reserved for orders', n0(sum(rows, s => s.alloc || 0))], ['Available', n0(sum(rows.filter(s => s.status === 'Available'), s => s.qty - (s.alloc || 0)))], ['On hold / damaged', n0(invQty(rows, s => ['Hold', 'Damaged'].includes(s.status)))], ['In transit / receiving', n0(invQty(rows, s => ['In transit', 'Received'].includes(s.status)))]]);
  const bar = filterBar('byc', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'wh', label: 'Warehouse', options: whOpts2() }, { id: 'q', type: 'text', label: 'Search item code, name, cust. item code' }]);
  if (!f.client) {
    const rows = DB.customers.map(c => { const st = base.filter(s => s.client === c.id); return { c, st, skus: new Set(st.map(s => s.sku)).size, on: invQty(st, () => 1), res: sum(st, s => s.alloc || 0), av: sum(st.filter(s => s.status === 'Available'), s => s.qty - (s.alloc || 0)), hold: invQty(st, s => s.status === 'Hold'), dmg: invQty(st, s => s.status === 'Damaged'), tr: invQty(st, s => ['In transit', 'Received'].includes(s.status)) }; }).filter(r => r.st.length);
    return head2('Inventory', 'Stock by customer') + bar + kpi(base)
      + card(`${rows.length} customers holding stock`, `<div class="tbl-wrap"><table><thead><tr><th>Customer</th><th class="num">Items</th><th class="num">Pallets</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">On hold</th><th class="num">Damaged</th><th class="num">In transit / receiving</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="click" data-do="invByCust" data-id="${esc(r.c.id)}"><td><b>${esc(r.c.name)}</b><br><span class="note mono">${esc(r.c.id)}</span></td><td class="num">${r.skus}</td><td class="num">${r.st.length}</td><td class="num"><b>${n0(r.on)}</b></td><td class="num">${n0(r.res)}</td><td class="num">${n0(r.av)}</td><td class="num">${n0(r.hold)}</td><td class="num">${r.dmg ? `<b style="color:var(--bad)">${n0(r.dmg)}</b>` : '0'}</td><td class="num">${n0(r.tr)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No stock in the warehouse.</td></tr>'}</tbody></table></div>`)
      + `<p class="note">Every unit in the warehouse belongs to a customer. Click a customer to see their stock item by item.</p>`;
  }
  const c = client(f.client), q = (f.q || '').toLowerCase(), st = base.filter(s => s.client === f.client), bySku = {};
  st.forEach(s => (bySku[s.sku] = bySku[s.sku] || { sku: s.sku, st: [] }).st.push(s));
  const rows = Object.values(bySku).filter(r => { const i = item(r.sku); return !q || ((i.code || '') + r.sku + (i.name || '') + (i.custCode || '')).toLowerCase().includes(q); }).sort((a, b) => (item(a.sku).code || a.sku).localeCompare(item(b.sku).code || b.sku));
  return head2('Inventory · Stock by customer', esc(c.name), `<button type="button" class="btn" data-do="invByCust" data-id="">All customers</button><button type="button" class="btn" data-do="invStmtFor" data-id="${esc(c.id)}">Stock statement</button>`) + bar + kpi(st)
    + card(`${rows.length} items`, `<div class="tbl-wrap"><table><thead><tr><th>Item code</th><th>Item name</th><th>Cust. item code</th><th>UOM</th><th class="num">Batches</th><th class="num">Pallets</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">On hold</th><th class="num">Damaged</th><th>Locations</th></tr></thead><tbody>
      ${rows.map(r => { const i = item(r.sku), bins = [...new Set(r.st.map(s => s.bin))]; return `<tr class="click" data-do="invSkuPallets" data-id="${esc(r.sku)}"><td><b class="mono">${esc(i.code || r.sku)}</b></td><td>${esc(i.name)}</td><td class="mono">${esc(i.custCode || r.sku)}</td><td>${esc(i.uom || '')}</td><td class="num">${new Set(r.st.map(s => s.batch).filter(Boolean)).size || '—'}</td><td class="num">${r.st.length}</td>
        <td class="num"><b>${n0(invQty(r.st, () => 1))}</b></td><td class="num">${n0(sum(r.st, s => s.alloc || 0))}</td><td class="num">${n0(sum(r.st.filter(s => s.status === 'Available'), s => s.qty - (s.alloc || 0)))}</td><td class="num">${n0(invQty(r.st, s => s.status === 'Hold'))}</td><td class="num">${n0(invQty(r.st, s => s.status === 'Damaged'))}</td>
        <td>${bins.slice(0, 4).map(b => `<span class="mono">${esc(b)}</span>`).join(', ')}${bins.length > 4 ? ' …' : ''}</td></tr>`; }).join('') || '<tr><td colspan="12" class="empty">This customer has no stock matching the filters.</td></tr>'}</tbody></table></div>`);
}
function expiryPage() {
  const rows = DB.stock.filter(s => s.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry));
  return head2('Inventory', 'Batch & expiry', `<button type="button" class="btn" data-do="invExpiredToBin">Move expired to expiry bins</button>${csvBtn('expiry')}`)
    + kpis4([['Pallets with expiry', rows.length], ['Expired', rows.filter(s => s.expiry < iso(today)).length], ['Expiring in 30 days', rows.filter(s => s.expiry >= iso(today) && daysBetween(iso(today), s.expiry) <= 30).length], ['Expiring in 90 days', rows.filter(s => s.expiry >= iso(today) && daysBetween(iso(today), s.expiry) <= 90).length]])
    + card('Pallets by expiry date, soonest first', tbl(stockCols(false), rows, null, 'No pallets with an expiry date.'));
}
function holdsPage() {
  const rows = applyFilt('hld', DB.stock.filter(s => ['Hold', 'Damaged'].includes(s.status)), {});
  return head2('Inventory', 'Holds & quarantine', `<button type="button" class="btn pri" data-do="invHoldBatch">Hold a batch</button>`)
    + filterBar('hld', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: [['Hold', 'On hold'], ['Damaged', 'Damaged']] }])
    + card(`${rows.length} pallets not available`, tbl([['LPN', lpnCell], ['Item', s => itemCell(s.sku)], ['Customer', s => esc(clName(s.client))], ['Location', s => `${esc(whRec(s.wh).name)}<br><span class="mono">${esc(s.bin)}</span>`], ['Batch', s => esc(s.batch) || '—'], ['Qty', s => n0(s.qty), 1], ['Status', s => pill(s.status)],
      ['', s => { const db = usageBin(s.wh, 'Damaged'); return `<div class="rowicons"><button type="button" class="btn sm pri" data-do="invRelease" data-id="${esc(s.lpn)}">Release</button>${s.status === 'Damaged' && db && s.bin !== db.code ? `<button type="button" class="btn sm" data-do="invToBin" data-id="${esc(s.lpn + '|' + db.code + '|Damaged goods')}">To damage bin</button>` : s.bin !== 'QA-HOLD' && binRec(s.wh, 'QA-HOLD') ? `<button type="button" class="btn sm" data-do="invToBin" data-id="${esc(s.lpn + '|QA-HOLD|Quarantine')}">To quarantine</button>` : ''}<button type="button" class="btn sm danger" data-do="invDispose" data-id="${esc(s.lpn)}">Dispose</button></div>`; }]], rows, null, 'All stock is available. Nothing is on hold.'))
    + `<p class="note">Held and damaged stock cannot be allocated to orders. Use "Hold a batch" for a recall or a quality problem: every available pallet of that batch is blocked at once. Disposal raises an adjustment to zero for approval.</p>`;
}
function movesPage() {
  const open = DB.moveOrders.filter(m => m.status === 'Open'), past = DB.moveOrders.filter(m => m.status !== 'Open').slice().reverse().slice(0, 50);
  const cols = [['Bin move', m => `<span class="mono">${m.id}</span>`], ['LPN', m => `<a class="mono" href="#" data-do="invLpn" data-id="${esc(m.lpn)}">${esc(m.lpn)}</a>`], ['Item', m => itemCell(m.sku)], ['Warehouse', m => esc(whRec(m.wh).name)], ['From → to bin', m => `<span class="mono">${esc(m.from)} → ${esc(m.to)}</span>`], ['Reason', m => esc(m.reason)]];
  return head2('Inventory', 'Bin moves', `<a class="btn pri" href="#moves/new">+ New bin move</a>`)
    + card(`${open.length} open`, tbl([...cols, ['Created', m => fmtDate(m.created)], ['', m => `<div class="rowicons"><button type="button" class="btn sm pri" data-do="invMoveDone" data-id="${m.id}">Confirm moved</button><button type="button" class="btn sm danger" data-do="invMoveCancel" data-id="${m.id}">Cancel</button></div>`]], open, null, 'No open move orders.'))
    + card('Completed and cancelled', tbl([...cols, ['Done', m => m.done ? fmtDate(m.done) + ' · ' + esc(m.by) : '—'], ['Status', m => pill(m.status)]], past, null, 'None yet.'))
    + `<p class="note">Bin moves are tasks to move a pallet between bins inside one warehouse (replenishment, consolidation, quarantine). The pallet's bin changes only when the move is confirmed.</p>`;
}
function transfersPage() {
  const rows = applyFilt('to', DB.transfers.slice().reverse(), {});
  return head2('Inventory', 'Warehouse transfers', `<a class="btn pri" href="#transfers/new">+ New warehouse transfer</a>`)
    + filterBar('to', [{ id: 'status', label: 'Status', options: optA(['Draft', 'In transit', 'Received', 'Cancelled']) }])
    + card(`${rows.length} warehouse transfers`, tbl([['Transfer', t => `<span class="mono">${t.id}</span>${t.ref ? `<br><span class="note">${esc(t.ref)}</span>` : ''}`], ['From → to', t => `${esc(whRec(t.from).name)} → ${esc(whRec(t.to).name)}${t.loc !== t.toLoc ? `<br><span class="pill p-info">Inter-location ${esc(t.loc)} → ${esc(t.toLoc)}</span>` : ''}`], ['Date', t => fmtDate(t.date)],
      ['Pallets', t => t.lines.length, 1], ['Units', t => n0(sum(t.lines, l => l.qty)), 1], ['Customers', t => [...new Set(t.lines.map(l => clName(l.client)))].map(esc).join(', ')], ['Status', t => pill(t.status)],
      ['', t => t.status === 'Draft' ? `<div class="rowicons"><button type="button" class="btn sm pri" data-do="invShipTO" data-id="${t.id}">Ship</button><button type="button" class="btn sm danger" data-do="invCancelTO" data-id="${t.id}">Cancel</button></div>` : t.status === 'In transit' ? `<button type="button" class="btn sm pri" data-do="invReceiveTO" data-id="${t.id}">Receive</button>` : '']], rows, null, 'No transfer orders yet.'))
    + `<p class="note">A warehouse transfer moves pallets between warehouses or locations. Shipping takes them out of the sending site; receiving puts them on the destination dock with a put-away task (Inbound → Put-Away).</p>`;
}
function countsPage() {
  const f = FILT.cnt || {}, rows = DB.counts.filter(c => !f.type || (f.type === 'full' ? c.type === 'Stock count' : c.type !== 'Stock count')).filter(c => !f.status || c.status === f.status).slice().reverse();
  const fz = DB.warehouses.filter(w => frozen(w.id));
  return head2('Inventory', 'Stock counts', `<button type="button" class="btn" data-do="invNewCount">+ Cycle count</button><button type="button" class="btn pri" data-do="invNewStockCount">+ Full stock count</button>`)
    + (fz.length ? `<div class="warnbox"><b>Frozen for a stock count:</b> ${fz.map(w => esc(w.name)).join(', ')}. No allocation, moves or transfers out until the count is posted.</div>` : '')
    + filterBar('cnt', [{ id: 'type', label: 'Count type', options: [['cycle', 'Cycle count'], ['full', 'Full stock count']] }, { id: 'status', label: 'Status', options: optA(['Open', 'Posted']) }])
    + card(`${rows.length} counts`, tbl([['Count', c => `<span class="mono">${c.id}</span>`], ['Type', c => c.type === 'Stock count' ? '<span class="pill p-info">Full stock count</span>' : '<span class="pill p-mute">Cycle count</span>'], ['Warehouse', c => esc(whRec(c.wh).name)], ['Scope', c => esc(c.scope)], ['Pallets', c => c.lines.length, 1], ['Created', c => fmtDate(c.created)],
      ['Variance, units', c => c.status === 'Posted' ? (() => { const d = sum(c.lines, l => (l.counted ?? l.expected) - l.expected); return d ? `<b style="color:var(--bad)">${d > 0 ? '+' : ''}${d}</b>` : '0'; })() : '—', 1], ['Status', c => pill(c.status)], ['', c => c.status === 'Open' ? `<button type="button" class="btn sm pri" data-do="invDoCount" data-id="${c.id}">Enter counts</button>` : '']], rows, null, 'No counts yet.'))
    + `<p class="note"><b>Cycle count</b>: one bin or zone at a time while the warehouse keeps working. <b>Full stock count</b>: a whole warehouse or zone at once (month or year end); the warehouse is frozen until it is posted. Posting creates adjustments for every difference.</p>`;
}
function adjustPage() {
  const pend = DB.adjustments.filter(a => a.status === 'Pending'), hist = applyFilt('adj', DB.adjustments.filter(a => a.status !== 'Pending').slice().reverse(), {});
  const cols = [['Adjustment', a => `<span class="mono">${a.id}</span>`], ['LPN', a => `<a class="mono" href="#" data-do="invLpn" data-id="${esc(a.lpn)}">${esc(a.lpn)}</a>`], ['Item', a => itemCell(a.sku)], ['Customer', a => esc(clName(a.client))], ['Before', a => n0(a.before), 1], ['After', a => n0(a.after), 1], ['Change', a => `<b style="color:${a.diff > 0 ? 'var(--good)' : 'var(--bad)'}">${a.diff > 0 ? '+' : ''}${n0(a.diff)}</b>`, 1], ['Reason', a => esc(a.reason) + (a.note ? `<br><span class="note">${esc(a.note)}</span>` : '')]];
  return head2('Inventory', 'Inventory adjustments', `<a class="btn pri" href="#adjust/new">+ New adjustment</a>`)
    + card(`${pend.length} waiting for approval`, tbl([...cols, ['Requested', a => fmtDate(a.created)], ['', a => `<div class="rowicons"><button type="button" class="btn sm pri" data-do="invApproveAdj" data-id="${a.id}">Approve</button><button type="button" class="btn sm danger" data-do="invRejectAdj" data-id="${a.id}">Reject</button></div>`]], pend, null, 'Nothing waiting for approval.'))
    + filterBar('adj', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(['Posted', 'Rejected']) }])
    + card('History', tbl([...cols, ['Source', a => `<span class="mono">${esc(a.source)}</span>`], ['Decided', a => fmtDate(a.approved) + (a.by ? ' · ' + esc(a.by) : '')], ['Status', a => pill(a.status)]], hist, null, 'No adjustments yet.'))
    + `<p class="note">Manual adjustments need a supervisor's approval before stock changes. Count variances post automatically, because the count itself is the check.</p>`;
}
function damagePage() {
  const rows = applyFilt('dmg', DB.damages.slice().reverse(), {}), open = DB.damages.filter(d => !['Settled', 'Rejected', 'Written off'].includes(d.claim)), val = d => (d.qty || 0) * (d.value || 0), mon = iso(today).slice(0, 7);
  return head2('Inventory', 'Damage & loss register', `<a class="btn pri" href="#damage/new">+ Record damage or loss</a>`)
    + filterBar('dmg', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'type', label: 'Type', options: optA(INV_DMG_TYPES) }, { id: 'liab', label: 'Liability', options: optA(INV_LIAB) }, { id: 'claim', label: 'Claim status', options: optA(INV_CLAIM) }])
    + kpis4([['Open cases', open.length], ['Open claim value, SAR', sar(sum(open, val))], ['Warehouse-liable this month, SAR', sar(sum(DB.damages.filter(d => /Gray Lane/.test(d.liab) && String(d.date).slice(0, 7) === mon), val))], ['Units this month', n0(sum(DB.damages.filter(d => String(d.date).slice(0, 7) === mon), d => d.qty))]])
    + card(`${rows.length} case${rows.length === 1 ? '' : 's'}`, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Case</th><th>Customer</th><th>Item</th><th>LPN</th><th>Type</th><th>Cause</th><th class="num">Qty</th><th class="num">Value, SAR</th><th>Liability</th><th>Claim</th><th>Adjustment</th></tr></thead><tbody>
      ${rows.map(d => `<tr class="click" data-do="invEditDmg" data-id="${d.id}"><td><span class="mono">${d.id}</span><br><span class="note">${fmtDate(d.date)}</span></td><td>${esc(clName(d.client))}</td><td>${itemCell(d.sku)}</td><td class="mono">${esc(d.lpn || '—')}</td><td>${esc(d.type)}</td><td>${esc(d.cause)}</td><td class="num">${n0(d.qty)}</td><td class="num">${sar(val(d))}</td>
        <td><span class="pill p-${invLiabTone(d.liab)}">${esc(d.liab)}</span></td><td>${pill(d.claim)}</td><td>${d.adj ? `<span class="mono">${esc(d.adj)}</span> ${pill((DB.adjustments.find(a => a.id === d.adj) || {}).status || '—')}` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No damage or loss recorded.</div>')
    + `<p class="note">Record every unit damaged or lost while in your custody, who is liable and the claim. A stock adjustment is raised for approval so stock and the register agree. Warehouse-liable cases are your cost; customer-liable ones (for example poor packaging) are not.</p>`;
}
function ledgerPage() {
  const rows = applyFilt('led', DB.moves.slice().reverse(), { q: (m, v) => ((m.lpn || '') + ' ' + (m.sku || '') + ' ' + (m.ref || '')).toLowerCase().includes(v.toLowerCase()) }).slice(0, 300);
  return head2('Inventory', 'Stock ledger', csvBtn('ledger')) + filterBar('led', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'wh', label: 'Warehouse', options: whOpts2() }, { id: 'type', label: 'Type', options: optA([...new Set(DB.moves.map(m => m.type))].sort()) }, { id: 'q', type: 'text', label: 'Search LPN, SKU, reference' }])
    + card('Every stock movement, newest first (300 max)', tbl([['Date', m => fmtDate(String(m.at).slice(0, 10))], ['Type', m => esc(m.type)], ['Reference', m => `<span class="mono">${esc(m.ref)}</span>`], ['LPN', m => `<span class="mono">${esc(m.lpn || '')}</span>`], ['Item', m => itemCell(m.sku)], ['Customer', m => esc(clName(m.client))], ['Warehouse', m => esc(whRec(m.wh).name || '')], ['Bin', m => `<span class="mono">${esc(m.bin)}</span>`],
      ['Qty', m => m.qty ? `<b style="color:${m.qty > 0 ? 'var(--good)' : 'var(--bad)'}">${m.qty > 0 ? '+' : ''}${n0(m.qty)}</b>` : '—', 1]], rows, null, 'No movements match.'));
}
function ageingPage() {
  const f = FILT.age || {}, st = DB.stock.filter(s => (!f.client || s.client === f.client) && (!f.wh || s.wh === f.wh) && s.status !== 'In transit');
  const byCl = DB.customers.map(c => { const x = st.filter(s => s.client === c.id); return { c, b: INV_AGE.map((_, i) => x.filter(s => invBucket(invAge(s)) === i).length), n: x.length, avg: x.length ? Math.round(sum(x, invAge) / x.length) : 0, old: x.length ? Math.max(...x.map(invAge)) : 0 }; }).filter(r => r.n);
  const list = st.filter(s => !f.bucket || invBucket(invAge(s)) === +f.bucket).sort((a, b) => invAge(b) - invAge(a));
  return head2('Inventory', 'Stock ageing', csvBtn('ageing')) + filterBar('age', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'wh', label: 'Warehouse', options: whOpts2() }, { id: 'bucket', label: 'Age', options: INV_AGE.map((b, i) => [String(i), b[2]]) }])
    + kpis4(INV_AGE.map((b, i) => [b[2], st.filter(s => invBucket(invAge(s)) === i).length + ' pallets']))
    + card('Pallets by age and customer', `<div class="tbl-wrap"><table><thead><tr><th>Customer</th>${INV_AGE.map(b => `<th class="num">${b[2]}</th>`).join('')}<th class="num">Pallets</th><th class="num">Average age, days</th><th class="num">Oldest, days</th></tr></thead><tbody>
      ${byCl.map(r => `<tr class="click" data-do="invAgeCust" data-id="${esc(r.c.id)}"><td><b>${esc(r.c.name)}</b></td>${r.b.map((n, i) => `<td class="num">${n ? (i >= 3 ? `<b style="color:var(--${i === 4 ? 'bad' : 'warn'})">${n}</b>` : n) : '—'}</td>`).join('')}<td class="num"><b>${r.n}</b></td><td class="num">${r.avg}</td><td class="num">${r.old}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No stock.</td></tr>'}</tbody></table></div>`)
    + card(`${list.length} pallets, oldest first`, tbl([['LPN', lpnCell], ['Item', s => itemCell(s.sku)], ['Customer', s => esc(clName(s.client))], ['Location', s => `${esc(whRec(s.wh).name)}<br><span class="mono">${esc(s.bin)}</span>`], ['Batch', s => esc(s.batch) || '—'], ['Received', s => fmtDate(String(s.received || '').slice(0, 10))],
      ['Age, days', s => { const d = invAge(s), i = invBucket(d); return i >= 3 ? `<span class="pill p-${i === 4 ? 'bad' : 'warn'}">${d}</span>` : d; }, 1], ['Qty', s => n0(s.qty), 1], ['Status', s => pill(s.status)]], list, null, 'No pallets in this age band.'))
    + `<p class="note">Age is counted from the date each pallet was received. Use it to ask customers to clear slow-moving stock, and to check long-stay storage charges.</p>`;
}
const INV_STM_COLS = [['Item code', 'code'], ['Item name', 'name'], ['Cust. item code', 'cust'], ['UOM', 'uom'], ['Opening', 'open', 1], ['Received', 'in', 1], ['Returned', 'ret', 1], ['Dispatched', 'out', 1], ['Adjusted', 'adj', 1], ['Transfers', 'own', 1], ['Closing', 'close', 1]];
function invStmCat(m) { const t = m.type || ''; if (/Adjust|Count/.test(t)) return 'adj'; if (/Return/.test(t)) return 'ret'; if (/Ownership|Transfer/.test(t)) return 'own'; if (m.qty > 0) return 'in'; if (m.qty < 0) return 'out'; return ''; }
function invStmData(cl, from, to) { const R = {}; DB.moves.filter(m => m.client === cl && m.qty && String(m.at).slice(0, 10) <= to).forEach(m => { const r = R[m.sku] = R[m.sku] || { sku: m.sku, open: 0, in: 0, ret: 0, out: 0, adj: 0, own: 0 }; if (String(m.at).slice(0, 10) < from) r.open += m.qty; else { const k = invStmCat(m); if (k) r[k] += m.qty; } });
  return Object.values(R).map(r => { const i = item(r.sku), out = -r.out; return { ...r, code: i.code || r.sku, name: i.name || r.sku, cust: i.custCode || '', uom: i.uom || '', out, close: r.open + r.in + r.ret - out + r.adj + r.own }; }).filter(r => r.open || r.in || r.ret || r.out || r.adj || r.own || r.close).sort((a, b) => a.code.localeCompare(b.code)); }
function statementPage() {
  const f = FILT.stm = FILT.stm || {}, P = { cl: f.client || (DB.customers[0] || {}).id, from: f.from || iso(today).slice(0, 8) + '01', to: f.to || iso(today) }, c = client(P.cl), rows = P.cl ? invStmData(P.cl, P.from, P.to) : [], T = k => sum(rows, r => r[k]);
  const cell = (r, k) => k === 'close' || k === 'open' ? `<b>${n0(r[k])}</b>` : r[k] ? (r[k] > 0 && ['adj', 'own'].includes(k) ? '+' : '') + n0(r[k]) : '—';
  return head2('Inventory', 'Customer stock statement', `<button type="button" class="btn" data-do="printPage">Print</button>`)
    + `<div class="card"><div class="card-b filters"><label class="field"><span>Customer</span><select data-filt="stm|client">${opt(custOpts2(), P.cl)}</select></label><label class="field"><span>From</span><input type="date" data-filt2="stm|from" value="${P.from}"></label><label class="field"><span>To</span><input type="date" data-filt2="stm|to" value="${P.to}"></label></div></div>`
    + kpis4([['Opening', n0(T('open'))], ['Received', n0(T('in') + T('ret'))], ['Dispatched', n0(T('out'))], ['Adjusted & transfers', n0(T('adj') + T('own'))], ['Closing', n0(T('close'))]])
    + card(`${esc(c.name || '')} · ${fmtDate(P.from)} to ${fmtDate(P.to)}`, rows.length ? `<div class="tbl-wrap"><table><thead><tr>${INV_STM_COLS.map(x => `<th${x[2] ? ' class="num"' : ''}>${x[0]}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${INV_STM_COLS.map(([, k, n]) => `<td${n ? ' class="num"' : ''}>${n ? cell(r, k) : k === 'code' ? `<b class="mono">${esc(r[k])}</b>` : k === 'cust' ? `<span class="mono">${esc(r[k])}</span>` : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${['open', 'in', 'ret', 'out', 'adj', 'own', 'close'].map(k => `<td class="num">${n0(T(k))}</td>`).join('')}</tr></tfoot></table></div>` : '<div class="empty">No stock movement for this customer up to that date.</div>')
    + `<p class="note">Opening stock is everything received before the start date less everything that left. Transfers are warehouse transfers out and back in. Send this statement to the customer each month to agree their stock.</p>`;
}

/* ---- actions ---- */
const lpnOpts = f => DB.stock.filter(f).map(s => [s.lpn, `${s.lpn} · ${item(s.sku).code || s.sku} ${item(s.sku).name} · ${clName(s.client)} · ${s.bin} · qty ${s.qty}`]);
const binOpts = (w, ex) => DB.bins.filter(b => b.wh === w && b.code !== ex && !placeBlocked(b) && (b.cap >= 99 || binCount(b) < b.cap)).map(b => [b.code, `${b.code} · ${zoneOf(b).code || ''} · ${binCount(b)}/${b.cap >= 99 ? '∞' : b.cap}`]);
const csvOf = (head, rows) => [head, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
Object.assign(DO, {
  fmSubmit() { try { fmCtx.onSubmit(fmRead()); } catch (e) { const b = $('#fmErr'); if (b) b.textContent = e.message; } },
  invLpn(l) { lpnModal(l); },
  invAdjust(lpn) { const s = lpnBy(lpn); formModal('Adjustment request · ' + lpn, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(item(s.sku).name)} · ${esc(clName(s.client))} · now ${s.qty}${s.alloc ? `, ${s.alloc} reserved for orders` : ''}. A supervisor approves the change before stock moves.</p>` }, { id: 'qty', label: 'Correct quantity', type: 'number', value: s.qty, min: 0, req: 1 }, { id: 'reason', label: 'Reason', type: 'select', options: optA(REASONS) }, { id: 'note', label: 'Note', full: 1 }],
    v => { const a = INV.requestAdj({ lpn, ...v }); invDone(a.id + ' sent for approval.'); }, 'Request adjustment'); },
  invHold(lpn) { try { INV.setStatus(lpn, 'Hold'); invDone(lpn + ' on hold.'); } catch (e) { toast(e.message); } },
  invRelease(lpn) { try { INV.setStatus(lpn, 'Available'); invDone(lpn + ' released.'); } catch (e) { toast(e.message); } },
  invMoveLpn(lpn) { const s = lpnBy(lpn); formModal('Move ' + lpn, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(item(s.sku).name)} · now in <span class="mono">${esc(s.bin)}</span>, ${esc(whRec(s.wh).name)}</p>` }, { id: 'to', label: 'To bin', type: 'select', options: binOpts(s.wh, s.bin), req: 1 }, { id: 'reason', label: 'Reason', type: 'select', options: optA(MOVE_REASONS) }, { id: 'now', label: 'When', type: 'select', options: [['task', 'Create a move order for the team'], ['now', 'Already moved: confirm now']] }],
    v => { const m = INV.createMove({ lpn, to: v.to, reason: v.reason }); if (v.now === 'now') { INV.completeMove(m.id); invDone(lpn + ' moved to ' + v.to + ' (' + m.id + ').'); } else invDone(m.id + ' created.'); }); },
  invNewMove() { const opts = lpnOpts(s => !s.alloc && s.status !== 'In transit'); if (!opts.length) return toast('No pallet can be moved right now.');
    formModal('New bin move', [{ id: 'lpn', label: 'Pallet (LPN)', type: 'select', options: opts, req: 1, full: 1 }, { id: 'to', label: 'To bin code', req: 1, list: 'dl_bins', ph: 'e.g. QA-HOLD' }, { id: 'reason', label: 'Reason', type: 'select', options: optA(MOVE_REASONS) }],
      v => { const m = INV.createMove(v); invDone(m.id + ' created.'); }, 'Create move order');
    $('#fmForm').insertAdjacentHTML('beforeend', `<datalist id="dl_bins">${[...new Set(DB.bins.map(b => b.code))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`); },
  invMoveDone(id) { try { INV.completeMove(id); invDone(id + ' confirmed.'); } catch (e) { toast(e.message); } },
  invMoveCancel(id) { try { INV.cancelMove(id); invDone(id + ' cancelled.'); } catch (e) { toast(e.message); } },
  invToBin(v) { const [lpn, bin, reason] = v.split('|'); try { const m = INV.createMove({ lpn, to: bin, reason }); invDone(m.id + ' created to move ' + lpn + ' to ' + bin + '.'); } catch (e) { toast(e.message); } },
  invDispose(lpn) { const s = lpnBy(lpn); if (!confirm('Raise an adjustment to dispose all ' + s.qty + ' units on ' + lpn + '?')) return; try { const a = INV.requestAdj({ lpn, qty: 0, reason: 'Disposed', note: 'Dispose whole pallet' }); invDone(a.id + ' raised to dispose ' + s.qty + ' units. Approve it in Inventory adjustments.'); } catch (e) { toast(e.message); } },
  invHoldBatch() { const its = DB.items.filter(i => stockable(i) && i.variant !== 'template' && DB.stock.some(s => s.sku === i.sku && s.batch));
    if (!its.length) return toast('No stock carries a batch number yet.');
    formModal('Hold a batch', [{ id: 'sku', label: 'Item', type: 'select', options: its.map(i => [i.sku, i.code + ' · ' + i.name + ' · ' + clName(i.client)]), req: 1, full: 1 }, { id: 'batch', label: 'Batch number', type: 'select', options: [], req: 1 }],
      v => { const r = INV.holdBatch({ client: item(v.sku).client, sku: v.sku, batch: v.batch }); invDone(`${r.held} pallet${r.held === 1 ? '' : 's'} of batch ${v.batch} on hold${r.busy ? `; ${r.busy} are reserved for orders, cancel those first` : ''}.`); }, 'Hold batch');
    const fill = () => { const sku = $('#fm_sku').value; $('#fm_batch').innerHTML = opt(optA([...new Set(DB.stock.filter(s => s.sku === sku && s.batch).map(s => s.batch))]), ''); }; fill(); $('#fm_sku').addEventListener('change', fill); },
  invExpiredToBin() { let n = 0, miss = 0; DB.stock.filter(s => s.expiry && s.expiry < iso(today) && !s.alloc && s.status !== 'In transit').forEach(s => { const b = usageBin(s.wh, 'Expired') || binRec(s.wh, 'QA-HOLD'); if (!b || s.bin === b.code) { if (!b) miss++; return; } try { INV.createMove({ lpn: s.lpn, to: b.code, reason: 'Expired goods' }); n++; } catch (e) { } });
    if (!n && !miss) return toast('No expired pallets need moving.'); invDone(`${n} move order${n === 1 ? '' : 's'} created to expiry bins${miss ? `; ${miss} pallets are in warehouses without an expiry bin` : ''}.`); },
  invNewTO() { const W = DB.warehouses.filter(w => w.status === 'Active').map(w => [w.id, w.name]);
    formModal('New warehouse transfer', [{ id: 'from', label: 'From warehouse', type: 'select', options: W }, { id: 'to', label: 'To warehouse (any location)', type: 'select', options: W, value: (W[1] || W[0] || [])[0] }, { id: 'date', label: 'Ship date', type: 'date', value: iso(today) }, { id: 'ref', label: 'Reference' }],
      v => { if (v.from === v.to) throw new Error('Choose two different warehouses.'); if (frozen(v.from)) throw new Error(whRec(v.from).name + ' is frozen for a stock count.'); DO.invNewTOLines(v); }, 'Next: choose pallets'); },
  invNewTOLines(h) { const opts = lpnOpts(s => s.wh === h.from && s.status === 'Available' && !s.alloc && !DB.transfers.some(t => ['Draft', 'In transit'].includes(t.status) && t.lines.some(l => l.lpn === s.lpn)));
    formModal(`Transfer ${whRec(h.from).name} → ${whRec(h.to).name}`, [{ id: 'lpns', label: 'Available pallets (tick the ones to send)', type: 'checks', options: opts, checked: (_, i) => i < 2 }],
      v => { const t = INV.createTO({ ...h, lpns: v.lpns }); invDone(t.id + ' created with ' + t.lines.length + ' pallets. Ship it when the truck leaves.'); }, 'Create transfer order'); },
  invShipTO(id) { try { INV.shipTO(id); invDone(id + ' shipped. Pallets are in transit.'); } catch (e) { toast(e.message); } },
  invReceiveTO(id) { try { INV.receiveTO(id); invDone(id + ' received. Put-away tasks are open at the destination.'); } catch (e) { toast(e.message); } },
  invCancelTO(id) { try { INV.cancelTO(id); invDone(id + ' cancelled.'); } catch (e) { toast(e.message); } },
  invNewCount() { const zs = DB.zones.filter(z => STORE_Z.includes(z.type));
    formModal('New cycle count', [{ id: 'wh', label: 'Warehouse', type: 'select', options: whOpts2() }, { id: 'zoneId', label: 'Zone (or leave blank and enter a bin)', type: 'select', blank: 1, options: zs.map(z => [z.id, z.code + ' · ' + z.name + ' · ' + whRec(z.wh).name]) }, { id: 'bin', label: 'Bin code', ph: 'e.g. AMB01-A01-L-A-01-01', full: 1 }],
      v => { if (v.zoneId) { const z = zoneBy(v.zoneId); if (z.wh !== v.wh) throw new Error('That zone is in ' + whRec(z.wh).name + '. Pick the matching warehouse.'); if (v.bin) v.zoneId = ''; } const c = INV.createCount({ type: 'Cycle count', ...v }); invDone(c.id + ' created with ' + c.lines.length + ' pallets.'); }, 'Create count'); },
  invNewStockCount() { formModal('New stock count', [{ type: 'html', html: '<p class="note" style="margin:0">The warehouse is frozen until you post the count: no allocation, moves or transfers out.</p>' }, { id: 'wh', label: 'Warehouse', type: 'select', options: whOpts2() }, { id: 'zoneId', label: 'Zone', type: 'select', blank: 'Whole warehouse', options: DB.zones.filter(z => STORE_Z.includes(z.type)).map(z => [z.id, whRec(z.wh).name + ' · ' + z.name]) }],
    v => { if (v.zoneId && zoneBy(v.zoneId).wh !== v.wh) throw new Error('That zone is in another warehouse.'); const c = INV.createCount({ type: 'Stock count', ...v }); invDone(c.id + ' started. ' + whRec(v.wh).name + ' is frozen until it is posted.'); }, 'Start stock count'); },
  invDoCount(id) { const c = DB.counts.find(x => x.id === id);
    formModal(c.type + ' · ' + c.scope, [{ type: 'html', html: '<p class="note" style="margin:0">Count each pallet and enter what you find. Differences post as inventory adjustments.</p>' }, ...c.lines.map((l, i) => ({ id: 'c' + i, label: `${l.bin} · ${l.lpn} · ${item(l.sku).code || l.sku}`, type: 'number', value: l.expected, min: 0, full: 1 }))],
      v => { INV.postCount(id, c.lines.map((_, i) => v['c' + i])); const n = DB.adjustments.filter(a => a.source === id).length; invDone(id + ' posted' + (n ? `, ${n} adjustment${n === 1 ? '' : 's'} created` : ', no differences') + '.'); }, 'Post count'); },
  invNewAdj() { const opts = lpnOpts(s => s.status !== 'In transit'); if (!opts.length) return toast('There is no stock to adjust.');
    formModal('New inventory adjustment', [{ id: 'lpn', label: 'Pallet (LPN)', type: 'select', options: opts, req: 1, full: 1 }, { id: 'qty', label: 'Correct quantity', type: 'number', min: 0, req: 1 }, { id: 'reason', label: 'Reason', type: 'select', options: optA(REASONS) }, { id: 'note', label: 'Note', full: 1 }],
      v => { const a = INV.requestAdj(v); invDone(a.id + ' sent for approval.'); }, 'Request adjustment'); },
  invApproveAdj(id) { try { INV.approveAdj(id); invDone(id + ' approved and posted to stock.'); } catch (e) { toast(e.message); } },
  invRejectAdj(id) { try { INV.rejectAdj(id); invDone(id + ' rejected. Stock is unchanged.'); } catch (e) { toast(e.message); } },
  invNewDmg() { const opts = lpnOpts(s => s.status !== 'In transit'); if (!opts.length) return toast('There is no stock to record against.');
    formModal('Record damage or loss', [{ id: 'lpn', label: 'Pallet (LPN)', type: 'select', options: opts, req: 1, full: 1 }, { id: 'qty', label: 'Quantity affected', type: 'number', min: 1, req: 1 }, { id: 'type', label: 'Type', type: 'select', options: optA(INV_DMG_TYPES) }, { id: 'cause', label: 'Cause', type: 'select', options: optA(INV_DMG_CAUSES) }, { id: 'liab', label: 'Liability', type: 'select', options: optA(INV_LIAB) },
      { id: 'value', label: 'Value per unit, SAR (for the claim)', type: 'number', min: 0, step: '0.01' }, { id: 'date', label: 'Date found', type: 'date', value: iso(today) }, { id: 'claim', label: 'Claim status', type: 'select', options: optA(INV_CLAIM) },
      { id: 'raiseAdj', label: 'Raise a stock adjustment for approval', type: 'select', options: [['1', 'Yes — reduce the pallet by this quantity'], ['', 'No — stock is already corrected']], value: '1' }, { id: 'note', label: 'What happened', type: 'textarea' }],
      v => { const d = INV.createDmg(v); invDone(d.id + ' recorded' + (d.adj ? '; ' + d.adj + ' sent for approval' : '') + '.'); }, 'Record'); },
  invEditDmg(id) { const d = DB.damages.find(x => x.id === id);
    formModal('Case ' + d.id + ' · ' + item(d.sku).name, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(clName(d.client))} · ${esc(d.lpn || '')} · ${n0(d.qty)} units · ${esc(d.type)} (${esc(d.cause)}) · recorded ${fmtDate(d.date)} by ${esc(d.by)}${d.adj ? ' · adjustment ' + esc(d.adj) : ''}</p>` }, { id: 'liab', label: 'Liability', type: 'select', options: optA(INV_LIAB), value: d.liab }, { id: 'claim', label: 'Claim status', type: 'select', options: optA(INV_CLAIM), value: d.claim },
      { id: 'value', label: 'Value per unit, SAR', type: 'number', min: 0, step: '0.01', value: d.value }, { id: 'claimRef', label: 'Claim / insurance reference', value: d.claimRef || '' }, { id: 'note', label: 'Notes', type: 'textarea', value: d.note }],
      v => { Object.assign(d, { liab: v.liab, claim: v.claim, value: +v.value || 0, claimRef: v.claimRef, note: v.note }); invDone(d.id + ' updated.'); }); },
  invByCust(id) { FILT.byc = { ...(FILT.byc || {}), client: id }; if (!id) delete FILT.byc.q; route(); },
  invSkuPallets(sku) { FILT.stk = { client: item(sku).client, q: sku }; go('#stock'); },
  invStmtFor(id) { FILT.stm = { client: id }; go('#statement'); },
  invAgeCust(id) { FILT.age = { ...(FILT.age || {}), client: id }; route(); },
  invCsv(k) {
    let txt = '';
    if (k === 'ledger') txt = csvOf(['Date', 'Type', 'Reference', 'LPN', 'SKU', 'Customer', 'Warehouse', 'Bin', 'Qty'], applyFilt('led', DB.moves.slice().reverse(), {}).map(m => [String(m.at).slice(0, 10), m.type, m.ref, m.lpn, m.sku, clName(m.client), whRec(m.wh).name, m.bin, m.qty]));
    else { const rows = k === 'expiry' ? DB.stock.filter(s => s.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry)) : k === 'ageing' ? DB.stock.slice().sort((a, b) => invAge(b) - invAge(a)) : applyFilt('stk', DB.stock, {});
      txt = csvOf(['LPN', 'Item code', 'SKU', 'Item name', 'Customer', 'Warehouse', 'Bin', 'Batch', 'Expiry', 'Received', 'Age days', 'Qty', 'Allocated', 'Status'], rows.map(s => [s.lpn, item(s.sku).code, s.sku, item(s.sku).name, clName(s.client), whRec(s.wh).name, s.bin, s.batch, s.expiry, String(s.received || '').slice(0, 10), invAge(s), s.qty, s.alloc || 0, s.status])); }
    try { navigator.clipboard.writeText(txt).then(() => toast('Copied ' + (txt.split('\n').length - 1) + ' rows. Paste into Excel.'), () => toast('Copy was blocked by the browser.')); } catch (e) { toast('Copy was blocked by the browser.'); }
  },
  putLoose(tid) { const t = DB.tasks.find(x => x.id === tid), s = lpnBy(t.lpn), b = (t.to && binRec(t.wh, t.to) && binCount(binRec(t.wh, t.to)) < binRec(t.wh, t.to).cap) ? binRec(t.wh, t.to) : ibSuggest(t.wh, s.sku, s.client)[0];
    if (!b) return toast('No free storage bin for ' + t.lpn + '.'); s.bin = b.code; s.status = 'Available'; Object.assign(t, { to: b.code, status: 'Done', done: iso(today), by: DATA.user.name }); ibMove(iso(today), 'Putaway', t.id, s, 0); persist(); route(); toast(t.lpn + ' put away to ' + b.code + '.'); }
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.filt2) { const [key, id] = t.dataset.filt2.split('|'); (FILT[key] = FILT[key] || {})[id] = t.value; route(); } });

/* ---- first-run data: opening receipts for sample pallets, expiry/damage bins, one pending adjustment ---- */
function seedInventory() {
  ['moveOrders', 'transfers', 'counts', 'adjustments', 'damages'].forEach(k => { if (!DB[k]) DB[k] = []; });
  DB.stock.forEach(s => { if (!DB.moves.some(m => m.lpn === s.lpn && m.qty > 0)) DB.moves.unshift({ at: String(s.received || iso(today)).slice(0, 10), type: s.asn ? 'Receipt' : 'Opening stock', ref: s.asn || 'Opening balance', lpn: s.lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, qty: s.qty }); });
  DB.moves.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const qz = DB.zones.find(z => z.wh === 'WH-JED-01' && z.type === 'Quarantine'), qa = qz && DB.areas.find(a => a.zoneId === qz.id);
  if (qz && qa) [['DMG-01', 'Damaged'], ['EXP-01', 'Expired']].forEach(([code, usage]) => { if (!binRec('WH-JED-01', code)) DB.bins.push(binDerive({ wh: 'WH-JED-01', zoneId: qz.id, areaId: qa.id, aisle: '00', code, name: usage + ' goods / ' + code, barcode: 'WH-JED-01:' + code, binProfile: 'QUARANTINE', cap: 4, role: 'Quarantine', temp: 'Any', client: '', maxKg: '', maxVol: '', clearH: '', life: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '', pallets: 0, usage })); });
  const s = DB.stock.find(x => x.sku === 'HJP-PAR-24' && x.status === 'Available' && !x.alloc && x.qty > 2) || DB.stock.find(x => x.status === 'Available' && !x.alloc && x.qty > 2);
  if (s && !DB.adjustments.length) DB.adjustments.push({ id: docNoL('ADJ', whRec(s.wh).loc), lpn: s.lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, before: s.qty, after: s.qty - 2, diff: -2, reason: 'Count variance', note: 'Two cartons short at spot check', status: 'Pending', created: iso(addDays(today, -1)), source: 'Manual' });
}

const INV_PAGES = ['stock', 'bycust', 'expiry', 'holds', 'moves', 'transfers', 'counts', 'adjust', 'damage', 'ledger', 'ageing', 'statement'];
function invShow(page, mode, id) {
  CUR = { mod: 'inventory', sub: page };
  const P = { stock: stockPage, bycust: byCustPage, expiry: expiryPage, holds: holdsPage, moves: movesPage, transfers: transfersPage, counts: countsPage, adjust: adjustPage, damage: damagePage, ledger: ledgerPage, ageing: ageingPage, statement: statementPage };
  if (mode === 'new') { const A = { moves: 'invNewMove', transfers: 'invNewTO', counts: 'invNewCount', adjust: 'invNewAdj', damage: 'invNewDmg' }[page]; if (A) setTimeout(() => DO[A](), 0); }
  return P[page]();
}
