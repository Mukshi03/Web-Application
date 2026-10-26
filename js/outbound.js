'use strict';
/* =====================================================================
   OUTBOUND  (ERP R2: Outbound Order → Allocate Stock → Pick & Confirm → Load → Confirm Dispatch)
   One order carries every stage. Allocation reserves LPNs (FEFO / FIFO); pick confirmation
   records what the picker took; loading records what went on the vehicle; dispatch posts the
   goods issue (stock leaves inventory) and raises the delivery note. Delivery confirmation (POD)
   is off, as in the ERP's default settings.
   ===================================================================== */
const OB_CFG = { partialDef: 'Yes', verify: true, carrier: true, balDef: 'Keep open / backorder', podOn: false };
const OB_VT = ['Frozen truck (−18 °C)', 'Chilled truck (2–8 °C)', 'Normal truck'];
const OB_VER = ['Pending', 'Accepted', 'Exception'], OB_PACK = ['Pending', 'Yes', 'VAS required'], OB_BAL = ['Keep open / backorder', 'Approved cancellation'];
const OB_LOADCHK = ['Picked goods verified and accepted', 'Packing and labelling completed', 'Vehicle inspected and suitable'];
const OB_DOCCHK = ['Loaded goods match dispatch', 'Required VAS or packaging is complete', 'Blocking exceptions resolved', 'Driver handover and documents confirmed'];
const OB_EXCT = ['Short pick', 'Damage', 'Loading discrepancy', 'Wrong item', 'Late vehicle', 'Other'];
Object.assign(TONE, { Approved: 'info', 'Partially allocated': 'warn', Released: 'good', 'Ready to pick': 'warn', 'Pick confirmed': 'good', 'Ready to load': 'warn', Loaded: 'good', Ready: 'info', Dispatched: 'good', 'Short pick': 'warn', 'Loading discrepancy': 'warn', Backorder: 'info', 'Balance cancelled': 'mute', Damage: 'bad', 'Wrong item': 'bad', 'Late vehicle': 'warn', Other: 'mute' });
const obO = id => DB.orders.find(o => o.id === id);
const obSfx = o => String(o.id).replace(/^OB-/, '');
const obIdx = o => ({ Draft: 0, New: 1, Allocated: 2, Picking: 3, Picked: 4, Dispatched: 5, Cancelled: -1 })[o.status] ?? 1;
const OB_STEPS = [['oborders', 'Outbound Order'], ['alloc', 'Allocate Stock'], ['pick', 'Pick & Confirm'], ['loading', 'Load'], ['dispatch', 'Confirm Dispatch']];
const obPicked = o => sum(o.lines, l => sum(l.picks || [], p => p.qty));
const obQ = o => sum(o.lines, l => +l.qty || 0);
const obPickRows = o => o.lines.flatMap((l, li) => (l.picks || []).map((p, pi) => ({ l, li, p, pi })));
const obAvail = (cl, w, sku) => sum(DB.stock.filter(s => s.client === cl && s.wh === w && s.sku === sku && s.status === 'Available' && (binRec(s.wh, s.bin) || {}).pick !== false && !(binRec(s.wh, s.bin) && allocBlocked(binRec(s.wh, s.bin)))), s => s.qty - (s.alloc || 0));
function obNorm(o) { o.loc = o.loc || (DB && whRec(o.wh).loc) || (/RUH/.test(o.wh) ? 'RUH' : 'JED'); o.audit = o.audit || []; (o.lines || []).forEach(l => { l.picks = l.picks || []; l.short = l.short || 0; }); return o; }
const obReach = { oborders: o => true, alloc: o => obIdx(o) >= 1, pick: o => obIdx(o) >= 2, loading: o => obIdx(o) >= 3, dispatch: o => obIdx(o) >= 4 };
const obElig = { oborders: o => o.status === 'Draft', alloc: o => ['New', 'Allocated'].includes(o.status), pick: o => o.status === 'Allocated', loading: o => o.status === 'Picking', dispatch: o => o.status === 'Picked' };
const obStSt = { oborders: o => ({ New: 'Approved', Allocated: 'Allocated', Picking: 'Picked', Picked: 'Loaded' })[o.status] || o.status,
  alloc: o => o.status === 'New' ? 'Pending' : ['Allocated', 'Picking'].includes(o.status) ? (sum(o.lines, l => l.short) ? 'Partially allocated' : 'Allocated') : o.status === 'Cancelled' ? 'Cancelled' : 'Released',
  pick: o => o.status === 'Allocated' ? 'Ready to pick' : 'Pick confirmed', loading: o => o.status === 'Picking' ? 'Ready to load' : 'Loaded', dispatch: o => o.status === 'Picked' ? 'Ready' : 'Dispatched' };
const obStOpts = { oborders: ['Draft', 'Approved', 'Allocated', 'Picked', 'Loaded', 'Dispatched', 'Cancelled'], alloc: ['Pending', 'Allocated', 'Partially allocated', 'Released'], pick: ['Ready to pick', 'Pick confirmed'], loading: ['Ready to load', 'Loaded'], dispatch: ['Ready', 'Dispatched'] };
const obDocNo = { oborders: o => o.id, alloc: o => 'ALC-' + obSfx(o), pick: o => (o.pk && o.pk.ref) || 'PICK-' + obSfx(o), loading: o => 'LOAD-' + obSfx(o), dispatch: o => o.dn || 'SHP-' + obSfx(o) };
const obStage = o => o.status === 'Cancelled' ? 'Cancelled' : obIdx(o) >= 5 ? 'Completed' : (OB_STEPS[obIdx(o)] || [])[1] || '';
const obNames = { oborders: ['Outbound Order', 'outbound orders', '+ New Outbound Order', '#oborders/new'], alloc: ['Allocate Stock', 'allocations'], pick: ['Pick & Confirm', 'pick confirmations'], loading: ['Load', 'loads'], dispatch: ['Confirm Dispatch', 'dispatches'] };
const obHref = o => `#${(OB_STEPS[Math.min(OB_STEPS.length - 1, Math.max(0, obIdx(o)))] || OB_STEPS[0])[0]}/edit/${encodeURIComponent(o.id)}`;

function obChain(o, here) {
  const i = obIdx(o), done = i >= 5;
  return `<div class="ib-bar">${[...OB_STEPS, ['done', 'Completed']].map(([k, t], j) => { const cls = j < i || done ? 'done' : j === i ? 'cur' : '', ok = o.saved !== false && o.status !== 'Cancelled' && k !== 'done' && obReach[k](o);
    return ok && k !== here ? `<a class="ib-step ${cls}" href="#${k}/edit/${encodeURIComponent(o.id)}" title="Open ${esc(t.toLowerCase())}">${esc(t)}</a>` : `<span class="${cls}${k === here ? ' here' : ''}">${esc(t)}</span>`; }).join('<i>›</i>')}<span class="ib-meta"><b class="mono">${esc(o.id)}</b> · ${esc(clName(o.client))} · ${esc(whRec(o.wh).name)} · ${pill(obStSt.oborders(o))}</span></div>`;
}

/* ---- stock movements ---- */
function obAllocate(o) {
  if (o.status !== 'New') throw new Error('Only approved orders waiting for allocation can be allocated.');
  if (frozen(o.wh)) throw new Error(whRec(o.wh).name + ' is frozen for a stock count. Post the count first.');
  for (const l of o.lines) {
    let need = +l.qty; l.picks = []; const it = item(l.sku), rule = o.rule || (it.valMethod || '') || client(o.client).rule || 'FEFO';
    const pool = DB.stock.filter(s => s.client === o.client && s.sku === l.sku && s.wh === o.wh && s.status === 'Available' && s.qty - (s.alloc || 0) > 0 && (binRec(s.wh, s.bin) || {}).pick !== false && !(binRec(s.wh, s.bin) && allocBlocked(binRec(s.wh, s.bin))))
      .sort((a, b) => rule === 'FIFO' ? String(a.received).localeCompare(b.received) : (String(a.expiry || '9999').localeCompare(b.expiry || '9999') || String(a.received).localeCompare(b.received)));
    for (const s of pool) { if (need <= 0) break; const q = Math.min(need, s.qty - (s.alloc || 0)); s.alloc = (s.alloc || 0) + q; l.picks.push({ lpn: s.lpn, bin: s.bin, batch: s.batch, expiry: s.expiry, qty: q }); need -= q; }
    l.short = need;
  }
  if (!obPicked(o)) { o.lines.forEach(l => l.short = +l.qty); throw new Error('No available stock for this order. It stays as Approved.'); }
  o.status = 'Allocated';
}
function obRelease(o) { o.lines.forEach(l => { (l.picks || []).forEach(p => { const s = DB.stock.find(x => x.lpn === p.lpn); if (s) s.alloc = Math.max(0, (s.alloc || 0) - p.qty); }); l.picks = []; l.short = 0; }); }
function obConfirmPick(o, P) {
  const rows = obPickRows(o);
  P.lines.forEach((x, k) => { const { l, p } = rows[k]; x.alloc = p.qty; const d = p.qty - x.picked; if (d > 0) { const s = DB.stock.find(y => y.lpn === p.lpn); if (s) s.alloc = Math.max(0, s.alloc - d); l.short = (l.short || 0) + d; p.qty = x.picked; } });
  o.lines.forEach(l => l.picks = (l.picks || []).filter(p => p.qty > 0)); P.confirmed = new Date().toISOString(); P.by = DATA.user.name; o.status = 'Picking';
}
function obConfirmLoad(o, L) {
  const rows = obPickRows(o);
  L.lines.forEach((x, k) => { const { l, p } = rows[k]; x.alloc = p.qty; const d = p.qty - x.loaded; if (d > 0) { const s = DB.stock.find(y => y.lpn === p.lpn); if (s) s.alloc = Math.max(0, s.alloc - d); l.short = (l.short || 0) + d; p.qty = x.loaded; } });
  L.lines = L.lines.filter(x => x.loaded > 0); o.lines.forEach(l => l.picks = (l.picks || []).filter(p => p.qty > 0));
  o.status = 'Picked'; o.giPending = true; o.pickedAt = String(L.time).slice(0, 10); L.confirmed = new Date().toISOString();
}
function obPostDispatch(o, at) {
  o.lines.forEach(l => (l.picks || []).forEach(p => { const s = DB.stock.find(x => x.lpn === p.lpn); if (!s) return; s.qty -= p.qty; s.alloc = Math.max(0, (s.alloc || 0) - p.qty); ibMove(at, 'Goods issue', o.id, s, -p.qty); if (s.qty <= 0) DB.stock = DB.stock.filter(x => x.lpn !== s.lpn); }));
  o.giPending = false; o.gi = 'GI-' + obSfx(o); o.dn = seqNo('DN@' + o.loc, 'DN-' + o.loc + '-', 5); o.status = 'Dispatched'; o.dispatchedAt = at;
}

/* ---- sample stock as pallets, and sample orders at their stages (first run) ---- */
function seedStock() {
  let k = 0;
  DB.warehouses.forEach(w => {
    const slots = DB.bins.filter(b => b.wh === w.id && +b.pallets > 0).sort((a, b) => a.code.localeCompare(b.code)).flatMap(b => Array(+b.pallets).fill(b));
    const skus = Object.entries(M.stock[w.id] || {}).filter(([, q]) => q > 0), n = slots.length, m = skus.length; let at = 0;
    skus.forEach(([sku, qty], i) => { const it = item(sku), c = Math.max(1, Math.floor(n / m) + (i < n % m ? 1 : 0)), base = Math.floor(qty / c);
      for (let j = 0; j < c; j++) { const b = slots[at++] || slots[slots.length - 1], q = base + (j < qty % c ? 1 : 0); if (!q || !b) continue; k++;
        DB.stock.push({ lpn: seqNo('LPN', 'LPN-', 6), client: it.client, sku, wh: w.id, bin: b.code, batch: it.batch ? 'B' + String(today.getFullYear()).slice(2) + '-' + String(k).padStart(3, '0') : '', expiry: it.expiry ? iso(addDays(today, Math.round(it.shelf * 0.6) - j * 20)) : '', qty: q, alloc: 0, status: 'Available', received: iso(addDays(today, -(40 - j * 9))), qc: 'Accepted', asn: '' }); } });
  });
  DB.bins.forEach(b => b.pallets = 0);
  Object.entries(DB.stockAdds || {}).forEach(([wid, list]) => Object.entries(list).forEach(([sku, q]) => { if (!(q > 0)) return; const it = item(sku), b = ibSuggest(wid, sku, it.client)[0] || DB.bins.find(x => x.wh === wid && PUT_ROLES.includes(x.role));
    DB.stock.push({ lpn: seqNo('LPN', 'LPN-', 6), client: it.client, sku, wh: wid, bin: b ? b.code : 'DOCK-IN', batch: '', expiry: it.expiry ? iso(addDays(today, it.shelf || 180)) : '', qty: q, alloc: 0, status: 'Available', received: it.created || iso(today), qc: 'Accepted', asn: '' }); }));
  DB.stockAdds = {};
}
function seedOrders() {
  const plan = { 'OB-JED-00061': [['NJE-PHN-A5', 30]], 'OB-JED-00060': [['RSF-SHR-1K', 12]], 'OB-JED-00059': [['RSF-OIL-1L', 20]], 'OB-RUH-00004': [['NJE-TV-55', 10]], 'OB-JED-00057': [['SQS-ABY-M', 12], ['SQS-SHL-01', 9]], 'OB-JED-00056': [['HJP-PAR-24', 40]] };
  const whOf = { 'Jeddah Ambient': 'WH-JED-01', 'Jeddah Frozen': 'WH-JED-03', 'Riyadh Ambient': 'WH-RUH-01' };
  DATA.orders.slice().reverse().forEach((d, i) => {
    if (DB.orders.some(o => o.id === d.id) || !plan[d.id]) return;
    const wid = whOf[d.warehouse], cl = item(plan[d.id][0][0]).client, c = client(cl), pc = primaryContact(c);
    const o = obNorm({ id: d.id, loc: whRec(wid).loc, client: cl, wh: wid, customer: d.shipTo, address: (c.billing || {}).city || '', contact: pc.name || '', phone: pc.mobile || '', due: d.due, ref: 'PO-' + (7100 + i), type: 'Customer dispatch', priority: i === 3 ? 'High' : 'Normal',
      status: 'New', created: iso(addDays(today, -3 + Math.floor(i / 2))), odate: iso(addDays(today, -3 + Math.floor(i / 2))), approvedBy: 'Hamza Kadenja', lines: plan[d.id].map(([sku, qty]) => ({ sku, qty, desc: '', picks: [], short: 0 })), audit: [] });
    ibAudit(o, 'Order created'); ibAudit(o, 'Order approved and released');
    DB.orders.push(o);
    if (d.status === 'New') return;
    try { obAllocate(o); ibAudit(o, 'Stock allocated (' + (client(cl).rule || 'FEFO') + ')'); } catch (e) { return; }
    if (d.status === 'Allocated') return;
    const rows = obPickRows(o); o.pk = { ref: 'PICK-' + obSfx(o), picker: 'Khalid Mansour', verify: 'Accepted', pack: 'Yes', hu: rows.length, lines: rows.map(r => ({ picked: r.p.qty, reason: '' })) }; obConfirmPick(o, o.pk); ibAudit(o, 'Pick confirmed by Khalid Mansour');
    if (d.status === 'Picking') return;
    const r2 = obPickRows(o); o.load = { carrier: 'Gray Lane fleet', vehicle: 'JED 4821', vtype: 'Normal truck', driver: 'Saeed Omar', mobile: '+966 55 410 2233', bay: 'DOCK-02', time: iso(today) + 'T08:30', pkgs: r2.length, seal: '', checks: OB_LOADCHK.map(() => true), lines: r2.map(r => ({ picked: r.p.qty, loaded: r.p.qty, cond: 'OK' })), reason: '' };
    obConfirmLoad(o, o.load); ibAudit(o, 'Loading confirmed on JED 4821');
  });
  DB.orders.filter(o => plan[o.id]).forEach(o => o.audit.forEach((x, j) => x.at = o.created + 'T' + String(8 + j).padStart(2, '0') + ':15:00'));
}

/* ---- registers ---- */
const obCols = {
  oborders: [['Order No.', o => `<b class="mono">${o.id}</b>`], ['Customer', o => esc(clName(o.client))], ['Customer Ref.', o => esc(o.ref || '') || '—'], ['Ship to', o => esc(o.customer || '') || '—'], ['Warehouse', o => esc(whRec(o.wh).name)], ['Requested', o => o.due ? fmtDate(o.due) : '—'], ['Lines', o => o.lines.length, 1], ['Qty', o => n0(obQ(o)), 1], ['Priority', o => esc(o.priority || 'Normal')], ['Stage', o => esc(obStage(o))], ['Status', o => pill(obStSt.oborders(o))]],
  alloc: [['Allocation ID', o => `<b class="mono">ALC-${obSfx(o)}</b>`], ['Order No.', o => `<span class="mono">${o.id}</span>`], ['Customer', o => esc(clName(o.client))], ['Warehouse', o => esc(whRec(o.wh).name)], ['Strategy', o => esc(o.rule || client(o.client).rule || 'FEFO')], ['Ordered', o => n0(obQ(o)), 1], ['Allocated', o => n0(obPicked(o)), 1], ['Short', o => n0(sum(o.lines, l => l.short || 0)), 1], ['Status', o => pill(obStSt.alloc(o))]],
  pick: [['Pick Ref.', o => `<b class="mono">${esc(obDocNo.pick(o))}</b>`], ['Order No.', o => `<span class="mono">${o.id}</span>`], ['Customer', o => esc(clName(o.client))], ['Warehouse', o => esc(whRec(o.wh).name)], ['Picker', o => esc((o.pk || {}).picker || '—')], ['Allocated', o => n0(obPicked(o)), 1], ['Short', o => n0(sum(o.lines, l => l.short || 0)), 1], ['Status', o => pill(obStSt.pick(o))]],
  loading: [['Loading ID', o => `<b class="mono">LOAD-${obSfx(o)}</b>`], ['Order No.', o => `<span class="mono">${o.id}</span>`], ['Customer', o => esc(clName(o.client))], ['Vehicle', o => `<span class="mono">${esc((o.load || {}).vehicle || '') || '—'}</span>`], ['Driver', o => esc((o.load || {}).driver || '') || '—'], ['Loading Point', o => esc((o.load || {}).bay || '') || '—'], ['Qty', o => n0(obPicked(o)), 1], ['Status', o => pill(obStSt.loading(o))]],
  dispatch: [['Delivery note', o => `<b class="mono">${esc(o.dn || '—')}</b>`], ['Shipment', o => `<span class="mono">SHP-${obSfx(o)}</span>`], ['Order No.', o => `<span class="mono">${o.id}</span>`], ['Customer', o => esc(clName(o.client))], ['Ship to', o => esc(o.customer || '') || '—'], ['Vehicle', o => `<span class="mono">${esc((o.load || {}).vehicle || '') || '—'}</span>`], ['Dispatched', o => o.dispatchedAt ? fmtDate(String(o.dispatchedAt).slice(0, 10)) : '—'], ['Status', o => pill(obStSt.dispatch(o))]] };
function obList(stage) {
  const [one, many, newL, newHref] = obNames[stage], key = 'ob_' + stage;
  const all = DB.orders.filter(o => (o.status !== 'Cancelled' || stage === 'oborders') && obReach[stage](o)).slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || b.id.localeCompare(a.id));
  const rows = applyFilt(key, all, { status: (r, v) => obStSt[stage](r) === v, q: (r, v) => [r.id, obDocNo[stage](r), r.ref, r.customer, r.dn, (r.load || {}).vehicle, clName(r.client)].join(' ').toLowerCase().includes(v.toLowerCase()) });
  return head2('Outbound', stage === 'oborders' ? 'Outbound Orders' : one, newL ? `<a class="btn pri" href="${newHref}">${newL}</a>` : '')
    + filterBar(key, [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'wh', label: 'Warehouse', options: DB.warehouses.map(w => [w.id, w.name]) }, { id: 'status', label: 'Status', options: optA(obStOpts[stage]) }, { id: 'q', type: 'text', label: 'Search order, reference, vehicle' }])
    + card(`${rows.length} ${many}`, tbl(obCols[stage], rows, o => `#${stage}/edit/${encodeURIComponent(o.id)}`, all.length ? 'No records match the filters.' : 'No ' + many + ' yet.'));
}
function obDash() {
  const O = DB.orders, t = iso(today);
  const m = [['Pending approval', O.filter(o => o.status === 'Draft').length, 'oborders'], ['To allocate', O.filter(o => o.status === 'New').length, 'alloc'], ['To pick', O.filter(o => o.status === 'Allocated').length, 'pick'], ['To load', O.filter(o => o.status === 'Picking').length, 'loading'], ['Ready to dispatch', O.filter(o => o.status === 'Picked').length, 'dispatch'], ['Dispatched today', O.filter(o => String(o.dispatchedAt || '').slice(0, 10) === t).length, 'obhistory']];
  return head2('Outbound', 'Outbound Dashboard', `<a class="btn pri" href="#oborders/new">+ New Outbound Order</a>`)
    + `<div class="ob-flow">${OB_STEPS.map(([k, tl], i) => `${i ? '<i>→</i>' : ''}<a href="#${k}"><b>${String(i + 1).padStart(2, '0')}</b>${esc(tl)}</a>`).join('')}</div>`
    + `<div class="ib-cards">${m.map(([k, n, s]) => `<a class="ib-card" href="#${s}"><span>${k}</span><strong>${n}</strong></a>`).join('')}</div>`
    + card('Recent outbound transactions', tbl([['Order', o => `<b class="mono">${o.id}</b>`], ['Customer', o => esc(clName(o.client))], ['Ship to', o => esc(o.customer || '') || '—'], ['Warehouse', o => esc(whRec(o.wh).name)], ['Lines', o => o.lines.length, 1], ['Qty', o => n0(obQ(o)), 1], ['Requested', o => o.due ? fmtDate(o.due) : '—'], ['Stage', o => esc(obStage(o))], ['Status', o => pill(obStSt.oborders(o))], ['Created', o => fmtDate(String(o.created || '').slice(0, 10))]],
      O.slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || b.id.localeCompare(a.id)).slice(0, 20), obHref, 'No outbound orders yet.'));
}
function obHistory() {
  const f = FILT.obh || {}, O = DB.orders.filter(o => (!f.client || o.client === f.client) && (!f.q || (o.id + ' ' + (o.ref || '')).toLowerCase().includes(f.q.toLowerCase())));
  const X = []; O.forEach(o => { ((o.pk && o.pk.lines) || []).forEach(x => { if (x.reason) X.push({ at: o.pk.confirmed || '', o, type: 'Short pick', d: x.reason }); }); if (o.load && o.load.reason) X.push({ at: o.load.time || '', o, type: 'Loading discrepancy', d: o.load.reason });
    if (o.backorder) X.push({ at: o.dispatchedAt || '', o, type: 'Backorder', d: 'Remaining balance → ' + o.backorder }); if (o.disp && o.disp.bal === 'Approved cancellation' && sum(o.lines, l => l.short)) X.push({ at: o.dispatchedAt || '', o, type: 'Balance cancelled', d: 'Confirmed by ' + (o.disp.cby || '') });
    (o.exc || []).forEach(e => X.push({ at: e.at, o, type: e.type, d: e.note + ' · ' + e.by })); });
  const H = O.flatMap(o => (o.audit || []).map(a => ({ at: a.at || '', o, what: a.action || '', by: a.by || '' }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 300);
  const oLink = o => `<a class="mono" href="${obHref(o)}">${esc(o.id)}</a>`;
  return head2('Outbound', 'Exceptions & History', `<button type="button" class="btn pri" data-do="obExcNew">+ Record Exception</button>`)
    + filterBar('obh', [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'q', type: 'text', label: 'Search order no. or reference' }])
    + card(`${X.length} exceptions`, tbl([['Date', x => esc(String(x.at).replace('T', ' ').slice(0, 16)) || '—'], ['Order', x => oLink(x.o)], ['Customer', x => esc(clName(x.o.client))], ['Exception', x => pill(x.type)], ['Detail', x => esc(x.d)]], X.sort((a, b) => String(b.at).localeCompare(String(a.at))), null, 'No exceptions recorded.'))
    + card('Activity history', tbl([['When', h => esc(String(h.at).replace('T', ' ').slice(0, 16))], ['Order', h => oLink(h.o)], ['Customer', h => esc(clName(h.o.client))], ['Event', h => esc(h.what)], ['By', h => esc(h.by)]], H, null, 'No activity yet.'));
}

/* ---- stage pages ---- */
const obHead = (stage, o, title) => head2(`<a href="#${stage}" style="color:inherit">Outbound · ${obNames[stage][0]}</a>`, `${title} · ${esc(obDocNo[stage](o))}`, `<a class="btn" href="#${stage}">← All ${obNames[stage][1]}</a>`) + obChain(o, stage);
const obLockNote = (stage, o) => obElig[stage](o) ? '' : `<p class="note" style="margin:0">This ${obNames[stage][0].toLowerCase()} is ${esc(String(obStSt[stage](o)).toLowerCase())} and read-only.</p>`;
const obLockAll = (form, on) => { if (on) setTimeout(() => document.querySelectorAll(`#${form} :is(input,select,textarea)`).forEach(el => el.disabled = true), 0); };
const users = () => optA(M.users.map(u => u.name));
let obCur = null;

function allocPage(o) {
  const ed = o.status === 'New', rule = o.rule || client(o.client).rule || 'FEFO';
  obLockAll('alForm', !ed);
  return `${obHead('alloc', o, 'Allocate Stock')}${obLockNote('alloc', o)}<div class="err" id="ibErr" role="alert"></div>
  <form id="alForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Allocate Stock', `<div class="card-b fgrid f3">${ibRO2('Allocation ID', 'ALC-' + obSfx(o))}${ibRO2('Order No.', o.id)}${ibRO2('Reservation status', obStSt.alloc(o))}
    ${ibRO2('Customer (stock owner)', clName(o.client))}${ibRO2('Warehouse', o.wh + ' · ' + whRec(o.wh).name)}${fld('Allocation strategy', `<select name="rule">${opt([['FEFO', 'FEFO · first expiry, first out'], ['FIFO', 'FIFO · first in, first out']], rule)}</select>`)}
    ${fld('Partial fulfilment', `<select name="partial">${opt(optA(['Yes', 'No']), o.partial || OB_CFG.partialDef)}</select>`, 0)}${ibRO2('Requested dispatch', o.due ? fmtDate(o.due) : '—')}${ibRO2('Ship to', o.customer || '—')}</div>`)}
  ${ibSec2('Allocation lines', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:860px"><thead><tr><th>Item code</th><th>Item name</th><th>Cust. item code</th><th class="num">Ordered</th><th class="num">Available now</th><th class="num">Allocated</th><th class="num">Short</th><th>UOM</th></tr></thead><tbody>
    ${o.lines.map(l => { const it = item(l.sku), al = sum(l.picks || [], p => p.qty); return `<tr><td class="mono"><b>${esc(it.code || '')}</b></td><td>${esc(it.name || '')}</td><td class="mono">${esc(it.custCode || l.sku)}</td><td class="num">${n0(l.qty)}</td><td class="num">${n0(obAvail(o.client, o.wh, l.sku))}</td><td class="num">${n0(al)}</td><td class="num">${l.short ? `<span class="pill p-warn">${n0(l.short)}</span>` : '0'}</td><td>${esc(it.uom || '')}</td></tr>`
      + (l.picks || []).map(p => { const s = DB.stock.find(x => x.lpn === p.lpn) || {}; return `<tr class="ob-sub"><td colspan="2" class="note">↳ <span class="mono">${esc(p.bin)}</span> · LPN <span class="mono">${esc(p.lpn)}</span></td><td class="note">Lot ${esc(p.batch || '—')}</td><td class="note" colspan="2">Expiry ${p.expiry ? fmtDate(p.expiry) : '—'}</td><td class="num"><b>${n0(p.qty)}</b></td><td></td><td>${pill(s.status || 'Available')}</td></tr>`; }).join(''); }).join('')}
    </tbody></table></div><p class="note" style="margin:8px 0 0">Only stock owned by ${esc(clName(o.client))}, in status Available, in a pickable bin that is not blocked for allocation, is reserved. FEFO takes the earliest expiry first, FIFO the earliest received.</p></div>`)}
  </form>${ibFoot([o.status === 'New' && ['Allocate stock', 'obAlloc', 'pri'], o.status === 'Allocated' && ['Release allocation', 'obRelease'], o.status === 'Allocated' && ['Convert to pick →', 'obTo|pick', 'pri']])}`;
}
function pickPage(o) {
  const P = o.pk || {}, ro = !obElig.pick(o), rows = obPickRows(o);
  obLockAll('pkForm', ro);
  return `${obHead('pick', o, 'Pick &amp; Confirm')}${obLockNote('pick', o)}<div class="err" id="ibErr" role="alert"></div>
  <form id="pkForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Pick &amp; Confirm', `<div class="card-b fgrid f3">${ibRO2('Pick Task Ref.', obDocNo.pick(o))}${ibRO2('Order No.', o.id)}${ibRO2('Customer', clName(o.client))}
    ${fld('Assigned Picker', `<select name="picker">${opt([['', 'Choose…'], ...users()], P.picker || '')}</select>`, 1)}
    ${fld('Verification Result', `<select name="verify">${opt(optA(OB_VER), P.verify || 'Pending')}</select>`, 1)}${fld('Packaging Ready for Loading', `<select name="pack">${opt(optA(OB_PACK), P.pack || 'Pending')}</select>`, 1)}
    ${fld('Handling Units / LPNs', `<input name="hu" type="number" min="0" value="${esc(P.hu ?? rows.length)}">`)}</div>`)}
  ${ibSec2('Pick lines', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:980px"><thead><tr><th>Item code</th><th>Item name</th><th>Source bin</th><th>LPN</th><th>Lot</th><th>Expiry</th><th class="num">Allocated</th><th class="num" style="width:100px">Picked</th><th class="num">Short</th><th style="width:200px">Exception Reason</th></tr></thead><tbody id="obPick">
    ${rows.map(({ l, p }, k) => { const it = item(l.sku), x = (P.lines || [])[k] || {}, al = x.alloc ?? p.qty, pq = x.picked ?? p.qty; return `<tr class="ob-ln" data-k="${k}" data-alloc="${al}"><td class="mono pad"><b>${esc(it.code || '')}</b></td><td class="pad">${esc(it.name || '')}</td><td class="mono pad">${esc(p.bin)}</td><td class="mono pad">${esc(p.lpn)}</td><td class="pad">${esc(p.batch || '—')}</td><td class="pad">${p.expiry ? fmtDate(p.expiry) : '—'}</td><td class="num pad">${n0(al)}</td>
      <td><input data-l="picked" type="number" min="0" step="1" value="${pq}" class="num"></td><td class="num pad ob-pshort">${n0(Math.max(0, al - pq))}</td><td><input data-l="reason" value="${esc(x.reason || '')}" placeholder="Required if short"></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">Nothing allocated.</td></tr>'}
    </tbody></table></div><p class="note" style="margin:8px 0 0">Picked goods go straight to loading: there is no separate staging or packing screen. Short picks release the reservation and need a reason.</p></div>`)}
  </form>${ibFoot([obElig.pick(o) && ['Save', 'obPickSave'], obElig.pick(o) && ['Confirm Pick', 'obPickConfirm', 'pri'], o.status === 'Picking' && ['Convert to load →', 'obTo|loading', 'pri']])}`;
}
function readPick(o) { const fm = $('#pkForm'), g = n => fm.querySelector(`[name="${n}"]`).value.trim(), P = o.pk = o.pk || {};
  P.ref = obDocNo.pick(o); P.picker = g('picker'); P.verify = g('verify'); P.pack = g('pack'); P.hu = g('hu') === '' ? '' : +g('hu');
  P.lines = [...fm.querySelectorAll('#obPick .ob-ln')].map(r => ({ picked: +r.querySelector('[data-l="picked"]').value || 0, reason: r.querySelector('[data-l="reason"]').value.trim() })); return P; }
function loadPage(o) {
  const L = o.load || {}, rows = obPickRows(o), ro = !obElig.loading(o);
  obLockAll('ldForm', ro);
  return `${obHead('loading', o, 'Load')}${obLockNote('loading', o)}<div class="err" id="ibErr" role="alert"></div>
  <form id="ldForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Load', `<div class="card-b fgrid f3">${ibRO2('Loading ID', 'LOAD-' + obSfx(o))}${ibRO2('Order No.', o.id)}${ibRO2('Customer', clName(o.client))}
    ${fld('Subcontractor / Carrier', `<input name="carrier" value="${esc(L.carrier || '')}" list="dl_carrier">`, OB_CFG.carrier)}${fld('Vehicle No.', `<input name="vehicle" class="mono" value="${esc(L.vehicle || '')}">`, 1)}
    ${fld('Vehicle type', `<select name="vtype">${opt([['', 'Choose…'], ...optA(OB_VT)], L.vtype || (item((o.lines[0] || {}).sku).temp === 'Frozen' ? OB_VT[0] : item((o.lines[0] || {}).sku).temp === 'Chilled' ? OB_VT[1] : OB_VT[2]))}</select>`, 1)}
    ${fld('Driver name', `<input name="driver" value="${esc(L.driver || '')}">`, 1)}${fld('Driver mobile', `<input name="dmobile" type="tel" value="${esc(L.mobile || '')}" placeholder="+966 5X XXX XXXX">`)}
    ${fld('Loading Bay / Direct Handover Point', `<select name="bay">${opt([['', 'Choose…'], ...optA(IB_DOCKS)], L.bay || '')}</select>`, OB_CFG.carrier)}
    ${fld('Loading date / time', `<input name="ltime" type="datetime-local" value="${esc(L.time || (iso(today) + 'T' + ibNowTime()))}">`, 1)}${fld('Packages / handling units', `<input name="pkgs" type="number" min="0" value="${esc(L.pkgs ?? rows.length)}">`)}
    ${fld('Seal No.', `<input name="lseal" class="mono" value="${esc(L.seal || '')}">`)}</div>`)}
  ${ibSec2('Loading checks', `<div class="card-b row" style="gap:6px 22px">${OB_LOADCHK.map((x, i) => `<label class="chk"><input type="checkbox" name="lc${i}" ${(L.checks || [])[i] ? 'checked' : ''}> ${x}</label>`).join('')}</div>`, 'All checks must be ticked before loading is confirmed.')}
  ${ibSec2('Loading verification · item and quantity', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:960px"><thead><tr><th>Item code</th><th>Item name</th><th>LPN</th><th>From bin</th><th>Lot</th><th class="num">Allocated</th><th class="num">Picked</th><th class="num" style="width:100px">Loaded</th><th class="num">Discrepancy</th><th style="width:120px">Condition</th></tr></thead><tbody id="obLoad">
    ${rows.map(({ l, p }, k) => { const it = item(l.sku), x = (L.lines || [])[k] || {}, ld = x.loaded ?? p.qty; return `<tr class="ob-ln" data-k="${k}" data-alloc="${p.qty}"><td class="mono pad"><b>${esc(it.code || '')}</b></td><td class="pad">${esc(it.name || '')}</td><td class="mono pad">${esc(p.lpn)}</td><td class="mono pad">${esc(p.bin)}</td><td class="pad">${esc(p.batch || '—')}</td><td class="num pad">${n0(p.qty)}</td>
      <td class="num pad">${n0(p.qty)}</td><td><input data-l="loaded" type="number" min="0" step="1" value="${ld}" class="num"></td><td class="num pad ob-diff">${n0(p.qty - ld)}</td><td><select data-l="cond">${opt(optA(['OK', 'Damaged']), x.cond || 'OK')}</select></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">Nothing picked.</td></tr>'}
    </tbody></table></div><label class="field" style="margin-top:10px"><span class="flbl">Discrepancy reason</span><input name="dreason" value="${esc(L.reason || '')}" placeholder="Required when loaded is less than picked"></label></div>`, 'Loading records what went onto the vehicle. Stock stays in the warehouse until Confirm Dispatch posts the goods issue.')}
  </form><datalist id="dl_carrier">${['Gray Lane fleet', 'SMSA Express', 'Aramex Freight', 'Naqel', ...new Set(DB.orders.map(x => (x.load || {}).carrier).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist>
  ${ibFoot([obElig.loading(o) && ['Save', 'obLoadSave'], obElig.loading(o) && ['Confirm loading', 'obLoadConfirm', 'pri'], o.status === 'Picked' && ['Convert to dispatch →', 'obTo|dispatch', 'pri']])}`;
}
function readLoad(o) { const fm = $('#ldForm'), g = n => { const el = fm.querySelector(`[name="${n}"]`); return el.type === 'checkbox' ? el.checked : el.value.trim(); }, L = o.load = o.load || {};
  L.carrier = g('carrier'); L.vehicle = g('vehicle').toUpperCase(); L.vtype = g('vtype'); L.driver = g('driver'); L.mobile = g('dmobile'); L.bay = g('bay'); L.time = g('ltime'); L.pkgs = g('pkgs') === '' ? '' : +g('pkgs'); L.seal = g('lseal').toUpperCase(); L.reason = g('dreason');
  L.checks = OB_LOADCHK.map((_, i) => g('lc' + i)); L.lines = [...fm.querySelectorAll('#obLoad .ob-ln')].map(r => ({ picked: +r.dataset.alloc, loaded: +r.querySelector('[data-l="loaded"]').value || 0, cond: r.querySelector('[data-l="cond"]').value })); return L; }
function dispPage(o) {
  const D = o.disp || {}, L = o.load || {}, ro = !obElig.dispatch(o), short = sum(o.lines, l => +l.short || 0);
  obLockAll('dsForm', ro);
  return `${obHead('dispatch', o, 'Confirm Dispatch')}${obLockNote('dispatch', o)}<div class="err" id="ibErr" role="alert"></div>
  <form id="dsForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Confirm Dispatch', `<div class="card-b fgrid f3">${ibRO2('Dispatch Ref.', 'SHP-' + obSfx(o))}${ibRO2('Delivery Note Ref.', o.dn || 'Assigned on dispatch')}${ibRO2('Goods Issue Ref.', o.gi || 'GI-' + obSfx(o))}
    ${ibRO2('Order No.', o.id)}${ibRO2('Customer', clName(o.client))}${ibRO2('Warehouse', whRec(o.wh).name)}
    ${ibRO2('Vehicle / Driver', [L.vehicle, L.driver].filter(Boolean).join(' · ') || '—')}${ibRO2('Carrier', L.carrier || '—')}${fld('Seal No.', `<input name="seal" class="mono" value="${esc(D.seal || L.seal || '')}">`)}
    ${fld('Confirmed By', `<select name="cby">${opt([['', 'Choose…'], ...users()], D.cby || '')}</select>`, 1)}${short ? fld('Remaining Balance Action', `<select name="bal">${opt(optA(OB_BAL), D.bal || OB_CFG.balDef)}</select>`, 1) : ''}</div>`)}
  ${ibSec2('Dispatch Review', `<div class="card-b row" style="gap:6px 22px">${OB_DOCCHK.map((x, i) => `<label class="chk"><input type="checkbox" name="dc${i}" ${(D.checks || [])[i] ? 'checked' : ''}> ${x}</label>`).join('')}</div>`, 'Confirming dispatch posts the goods issue (stock leaves inventory) and raises the delivery note. Dispatch is not delivery confirmation.')}
  ${ibSec2('Dispatch lines', `<div class="card-b">${tbl([['Item code', l => `<b class="mono">${esc(item(l.sku).code || '')}</b>`], ['Item name', l => esc(item(l.sku).name || '')], ['Cust. item code', l => `<span class="mono">${esc(item(l.sku).custCode || l.sku)}</span>`], ['Requested', l => n0(l.qty), 1], ['Loaded', l => n0(sum(l.picks || [], p => p.qty)), 1], ['Dispatch Qty', l => `<b>${n0(sum(l.picks || [], p => p.qty))}</b>`, 1],
      ['Remaining', l => { const r = +l.qty - sum(l.picks || [], p => p.qty); return r > 0 ? `<span class="pill p-warn">${n0(r)}</span>` : '0'; }, 1], ['UOM', l => esc(item(l.sku).uom || '')]], o.lines.filter(l => l.sku), null, 'No lines.')}</div>`)}
  </form>${o.status === 'Picked' ? ibFoot([['Confirm Dispatch', 'obDispatch', 'pri']]) : ''}`;
}

/* ---- actions ---- */
const obErr = e => formErr('#ibErr', e);
Object.assign(DO, {
  obTo(st) { go(`#${st}/edit/${encodeURIComponent(obCur.id)}`); },
  obAlloc() {
    const o = obCur, fm = $('#alForm'); o.rule = fm.querySelector('[name=rule]').value; o.partial = fm.querySelector('[name=partial]').value;
    try { if (o.partial === 'No') { const sh = o.lines.filter(l => +l.qty > obAvail(o.client, o.wh, l.sku)); if (sh.length) throw new Error('Not enough stock for ' + sh.map(l => item(l.sku).code || l.sku).join(', ') + '. Full allocation is required because partial fulfilment is set to No.'); }
      obAllocate(o); } catch (e) { obRelease(o); return obErr(e); }
    const sh = sum(o.lines, l => l.short); ibAudit(o, 'Stock allocated (' + o.rule + ')' + (sh ? ', short ' + sh : '')); persist();
    toast(sh ? o.id + ' partially allocated — short ' + n0(sh) + '.' : o.id + ' fully allocated. Pick & Confirm is next.'); route();
  },
  obRelease() { const o = obCur; obRelease(o); o.status = 'New'; ibAudit(o, 'Allocation released'); persist(); toast(o.id + ': Allocation released.'); route(); },
  obPickSave() { const o = obCur; readPick(o); ibAudit(o, 'Pick saved'); persist(); toast(o.id + ': Pick saved.'); route(); },
  obPickConfirm() {
    const o = obCur, P = readPick(o), rows = obPickRows(o);
    try { if (!P.picker) throw new Error('Choose the assigned picker.');
      if (OB_CFG.verify && (P.verify !== 'Accepted' || P.pack !== 'Yes')) throw new Error('Verify the picked goods (Accepted) and confirm packaging is ready before loading.' + (P.pack === 'VAS required' ? ' Complete the VAS work order first.' : ''));
      P.lines.forEach((x, k) => { const p = rows[k].p, n = 'Line ' + (k + 1) + ': '; if (!Number.isInteger(x.picked) || x.picked < 0) throw new Error(n + 'picked quantity must be a whole number, 0 or more.'); if (x.picked > p.qty) throw new Error(n + 'picked cannot exceed allocated (' + p.qty + ').'); if (x.picked < p.qty && !x.reason) throw new Error(n + 'enter the exception reason for the short pick.'); });
      if (!sum(P.lines, x => x.picked)) throw new Error('Nothing picked. Enter the picked quantities.'); }
    catch (e) { return obErr(e); }
    obConfirmPick(o, P); ibAudit(o, 'Pick confirmed by ' + P.picker + ' (' + n0(obPicked(o)) + ' units' + (P.lines.some(x => x.reason) ? ', short picks recorded' : '') + ')'); persist(); toast(o.id + ' pick confirmed. Load it next.'); go('#pick');
  },
  obLoadSave() { const o = obCur; readLoad(o); ibAudit(o, 'Loading saved'); persist(); toast(o.id + ': Loading saved.'); route(); },
  obLoadConfirm() {
    const o = obCur, L = readLoad(o), rows = obPickRows(o);
    try { if (OB_CFG.carrier) { if (!L.carrier) throw new Error('Enter the subcontractor / carrier.'); if (!L.bay) throw new Error('Choose the loading bay / direct handover point.'); }
      if (!L.vehicle || !L.driver) throw new Error('Enter the vehicle number and driver name.'); if (!L.vtype) throw new Error('Choose the vehicle type.'); if (!L.time) throw new Error('Enter the loading date and time.');
      if (L.mobile && !/^[+0-9 ()-]{7,}$/.test(L.mobile)) throw new Error('Driver mobile does not look like a phone number.'); if (L.checks.some(x => !x)) throw new Error('Tick every loading check before confirming.');
      L.lines.forEach((x, k) => { const p = rows[k].p, n = 'Line ' + (k + 1) + ': '; if (!Number.isInteger(x.loaded) || x.loaded < 0) throw new Error(n + 'loaded must be a whole number.'); if (x.loaded > p.qty) throw new Error(n + 'loaded cannot exceed picked (' + p.qty + ').'); if (x.cond === 'Damaged' && x.loaded > 0) throw new Error(n + 'damaged goods cannot be loaded. Set loaded to 0 or change the condition.'); });
      if (L.lines.some((x, k) => x.loaded < rows[k].p.qty) && !L.reason) throw new Error('Enter the discrepancy reason for quantities not loaded.'); if (!sum(L.lines, x => x.loaded)) throw new Error('Nothing is loaded. Enter the loaded quantities.');
      const temp = item((o.lines[0] || {}).sku).temp; if (temp === 'Frozen' && L.vtype !== OB_VT[0]) throw new Error('Frozen goods need a frozen truck.'); if (temp === 'Chilled' && L.vtype === OB_VT[2]) throw new Error('Chilled goods need a chilled or frozen truck.'); }
    catch (e) { return obErr(e); }
    obConfirmLoad(o, L); ibAudit(o, 'Loading confirmed on ' + L.vehicle + ' (' + n0(obPicked(o)) + ' units)'); persist(); toast(o.id + ' loaded on ' + L.vehicle + '. Confirm Dispatch posts the goods issue.'); go('#loading');
  },
  obDispatch() {
    const o = obCur, fm = $('#dsForm'), D = o.disp = o.disp || {}; D.seal = fm.querySelector('[name=seal]').value.trim().toUpperCase(); D.cby = fm.querySelector('[name=cby]').value; D.bal = (fm.querySelector('[name=bal]') || {}).value || ''; D.checks = OB_DOCCHK.map((_, i) => fm.querySelector(`[name=dc${i}]`).checked);
    try { if (o.status !== 'Picked') throw new Error('Confirm loading first.'); if (!D.cby) throw new Error('Choose who confirmed the dispatch.'); if (D.checks.some(x => !x)) throw new Error('Complete every dispatch review check before confirming.'); }
    catch (e) { return obErr(e); }
    const at = iso(today), short = o.lines.filter(l => (+l.short || 0) > 0); D.time = at + 'T' + ibNowTime();
    obPostDispatch(o, at); ibAudit(o, 'Goods issue ' + o.gi + ' posted, ' + o.dn + ' raised');
    let msg = o.id + ' dispatched. Delivery note ' + o.dn + '.';
    if (short.length && D.bal === 'Keep open / backorder') {
      const loc = o.loc, b = obNorm({ id: obNo(o.wh), loc, client: o.client, wh: o.wh, customer: o.customer, address: o.address, contact: o.contact, phone: o.phone, due: iso(addDays(today, 1)), ref: (o.ref || o.id) + ' · backorder', type: o.type, priority: o.priority, status: 'New', created: iso(today), odate: iso(today), lines: short.map(l => ({ sku: l.sku, qty: +l.short, desc: '', picks: [], short: 0 })), audit: [], backorderOf: o.id });
      while (DB.orders.some(x => x.id === b.id)) { DB.seq.OB[loc]++; b.id = obNo(o.wh); } DB.seq.OB[loc]++;
      DB.orders.push(b); ibAudit(b, 'Backorder created from ' + o.id); ibAudit(o, 'Remaining balance kept open as backorder ' + b.id); o.backorder = b.id; msg += ' Backorder ' + b.id + ' created for the remaining quantity.';
    } else if (short.length) ibAudit(o, 'Remaining balance cancelled (approved) by ' + D.cby);
    persist(); toast(msg); go('#dispatch');
  },
  obExcNew() {
    const os = DB.orders.filter(o => o.status !== 'Draft').slice().reverse().slice(0, 60);
    if (!os.length) return toast('There are no released orders yet.');
    modal('Record outbound exception', `<form id="excForm" class="fgrid f2" onsubmit="return false"><label class="field" style="grid-column:1/-1"><span class="flbl">Order<span class="req"> *</span></span><select name="o">${opt(os.map(o => [o.id, o.id + ' · ' + clName(o.client) + ' · ' + obStSt.oborders(o)]), '')}</select></label>
      <label class="field"><span class="flbl">Exception type</span><select name="type">${opt(optA(OB_EXCT), 'Short pick')}</select></label><span></span>
      <label class="field" style="grid-column:1/-1"><span class="flbl">Description<span class="req"> *</span></span><textarea name="note" rows="3"></textarea></label></form><div class="err" id="excErr" role="alert"></div>`,
      `<button type="button" class="btn" data-do="mClose">Cancel</button><button type="button" class="btn pri" data-do="obExcSave">Record</button>`);
  },
  obExcSave() { const f = $('#excForm'), o = obO(f.o.value), note = f.note.value.trim(); if (!note) return $('#excErr').textContent = 'Describe the exception.';
    (o.exc = o.exc || []).push({ at: new Date().toISOString().slice(0, 16), type: f.type.value, note, by: DATA.user.name }); ibAudit(o, 'Exception: ' + f.type.value + ' · ' + note); persist(); closeModal(); route(); toast('Exception recorded on ' + o.id + '.'); }
});
document.addEventListener('input', e => { const r = e.target.closest && e.target.closest('#obPick .ob-ln, #obLoad .ob-ln'); if (!r) return;
  const v = +(r.querySelector('[data-l="picked"],[data-l="loaded"]') || {}).value || 0, c = r.querySelector('.ob-pshort,.ob-diff'); if (c) c.textContent = n0(Math.max(0, +r.dataset.alloc - v)); });

function obShow(page, mode, id) {
  CUR = { mod: 'outbound', sub: page };
  if (page === 'outbound') { if (mode === 'new') { history.replaceState(null, '', '#oborders/new'); CUR.sub = 'oborders'; return obShow('oborders', 'new'); } return obDash(); }
  if (page === 'obhistory') return obHistory();
  if (page === 'oborders') {
    if (mode === 'new') { if (!draft || draft.kind !== 'order' || draft.saved) draft = newOrder(); return orderPage(draft); }
    if (mode === 'edit') { const o = obO(id); if (!o) return head2('Outbound', 'Order not found', '<a class="btn" href="#oborders">← All orders</a>') + '<div class="card empty">This order no longer exists.</div>';
      draft = { ...JSON.parse(JSON.stringify(obNorm(o))), kind: 'order', saved: true }; return orderPage(draft); }
    return obList('oborders');
  }
  if (mode === 'edit') { const o = obO(id);
    if (!o || !obReach[page](o) || o.status === 'Cancelled') return head2('Outbound', 'Not available', `<a class="btn" href="#${page}">← Back</a>`) + `<div class="card empty">${o ? o.id + ' has not reached this stage.' : 'This order no longer exists.'}</div>`;
    obCur = obNorm(o); return { alloc: allocPage, pick: pickPage, loading: loadPage, dispatch: dispPage }[page](o); }
  return obList(page);
}
