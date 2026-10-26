'use strict';
/* =====================================================================
   INBOUND  (ERP: ASN → Receiving → GRN → Put-away → Inventory)
   One ASN carries every stage. Receiving puts stock in the receiving dock (custody);
   damaged quantity goes to QA hold; the approved GRN opens put-away tasks for accepted stock;
   put-away (LPN + bin) makes it available. Gate entry and QC are switched off, as in the
   ERP's default settings (Settings → Inbound).
   ===================================================================== */
const IB_CFG = { useGate: false, useQc: false, autoGrn: true, autoPutaway: true, overPct: 0 };
const IB_DOCKS = ['DOCK-01', 'DOCK-02', 'DOCK-03', 'DOCK-04'];
Object.assign(TONE, { Approved: 'info', Arrived: 'warn', Receiving: 'warn', 'Not started': 'mute', Pending: 'warn', Completed: 'good', 'In progress': 'warn', Received: 'info', Hold: 'warn', Damaged: 'bad', Available: 'good' });
const ibA = id => DB.asns.find(a => a.id === id);
const ibSfx = a => a.id.replace(/^ASN-/, '');
const ibAudit = (a, action) => { (a.audit = a.audit || []).push({ at: new Date().toISOString(), action, by: DATA.user.name }); };
const ibNowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function ibNorm(a) { a.loc = a.loc || (DB && whRec(a.wh).loc) || (/RUH/.test(a.wh) ? 'RUH' : 'JED'); a.gate = a.gate || { status: 'Expected' }; a.receipt = a.receipt || { status: 'Not started' }; a.qc = a.qc || { status: 'Pending' }; a.grnStatus = a.grnStatus || 'Pending'; a.audit = a.audit || []; return a; }
const ibUom = l => item(l.sku).uom || '';
const ibTasks = a => DB.tasks.filter(t => t.asn === a.id && t.status !== 'Cancelled');
const ibPutSt = a => { const t = ibTasks(a); return !t.length ? 'Pending' : t.every(x => x.status === 'Done') ? 'Completed' : t.some(x => x.status === 'Done') ? 'In progress' : 'Pending'; };
const ibRcvElig = a => ['Approved', 'Arrived', 'Receiving'].includes(a.status) && (a.receipt || {}).status !== 'Completed';
const ibGrnElig = a => (a.qc || {}).status === 'Completed' && (a.grnStatus !== 'Approved' || !a.putCreated) && a.status !== 'Cancelled';
const ibPutElig = a => DB.tasks.some(t => t.asn === a.id && t.status === 'Open');
const ibStage = a => a.status === 'Cancelled' ? 'Cancelled' : a.status === 'Completed' ? 'Completed' : a.grnStatus === 'Approved' ? 'Put-away' : (a.receipt || {}).status === 'Completed' ? 'GRN' : ['Approved', 'Arrived', 'Receiving'].includes(a.status) ? 'Receiving' : 'ASN';
const ibReach = {
  asn: a => true,
  receiving: a => ibRcvElig(a) || !['Not started', undefined].includes((a.receipt || {}).status),
  grn: a => (a.qc || {}).status === 'Completed',
  putaway: a => !!a.putCreated || DB.tasks.some(t => t.asn === a.id),
  ibinv: a => (a.receipt || {}).status === 'Completed' || !!a.grn };
const ibStSt = { asn: a => a.status, receiving: a => (a.receipt || {}).status || 'Not started', grn: a => a.grnStatus || 'Pending', putaway: ibPutSt, ibinv: a => a.status };
const ibStOpts = { asn: ['Draft', 'Submitted', 'Approved', 'Receiving', 'Completed', 'Cancelled'], receiving: ['Not started', 'Draft', 'Completed'], grn: ['Pending', 'Approved'], putaway: ['Pending', 'In progress', 'Completed'], ibinv: ['Receiving', 'Completed'] };
const ibDocNo = { asn: a => a.id, receiving: a => 'RCV-' + ibSfx(a), grn: a => a.grn || '—', putaway: a => 'PUT-' + ibSfx(a), ibinv: a => a.id };
const ibSumR = (a, k) => sum((a.receipt || {}).lines || [], x => +x[k] || 0), ibSumQ = (a, k) => sum((a.qc || {}).lines || [], x => +x[k] || 0);
const ibAsnLpns = a => [...new Set([...((a.receipt || {}).lines || []).map(x => x.lpn), ...(a.splitLpns || [])].filter(Boolean))];
const ibDock = w => binRec(w, 'DOCK-IN') || DB.bins.find(b => b.wh === w && zoneOf(b).type === 'Receiving') || { code: 'DOCK-IN' };
const ibBinPath = (w, code) => { const b = binRec(w, code); if (!b) return esc(code || '—'); const z = zoneOf(b), ar = areaOf(b); return `<b class="mono">${esc(code)}</b><br><span class="note">${esc(z.code || '')} ${esc(z.name || '')}${ar.code ? ' · ' + esc(ar.code) : ''}</span>`; };
const seqNo = (k, pfx, pad, loc) => { const key = loc ? k + '@' + loc : k; DB.seq[key] = (DB.seq[key] || 0) + 1; return pfx + String(DB.seq[key]).padStart(pad, '0'); };
const grnPreview = loc => 'GRN-' + loc + '-' + String((DB.seq['GRN@' + loc] || 0) + 1).padStart(5, '0');

function ibChain(a, here) {
  const st = ibStage(a), order = ['ASN', 'Receiving', 'GRN', 'Put-away', 'Completed'], i = order.indexOf(st);
  const K = { 'ASN': 'asn', 'Receiving': 'receiving', 'GRN': 'grn', 'Put-away': 'putaway', 'Completed': 'ibinv' };
  return `<div class="ib-bar">${order.map((s, j) => { const k = K[s], cls = j < i || st === 'Completed' ? 'done' : j === i ? 'cur' : '', ok = a.saved !== false && ibReach[k](a) && a.status !== 'Cancelled' && (s !== 'Completed' || st === 'Completed');
    return ok && k !== here ? `<a class="ib-step ${cls}" href="#${k}/edit/${encodeURIComponent(a.id)}" title="Open ${esc(s.toLowerCase())}">${s}</a>` : `<span class="${cls}${k === here ? ' here' : ''}">${s}</span>`; }).join('<i>›</i>')}<span class="ib-meta"><b class="mono">${esc(a.id)}</b> · ${esc(clName(a.client))} · ${esc(whRec(a.wh).name)} · ${pill(a.status)}</span></div>`;
}

/* ---- sample inbound data (first run) ---- */
function IB_SEED() {
  const T = iso(today), mk = (id, client, wh, eta, ref, lines, created) => ibNorm({ id, client, wh, eta, ref, slot: '', shipment: '', container: '', carrier: '', vehicle: '', driver: '', driverId: '', mobile: '', remarks: '', status: 'Approved', created, acceptedAt: created, acceptedBy: 'Hamza Kadenja',
    lines: lines.map(([sku, qty]) => ({ sku, qty, desc: '' })), audit: [{ at: created + 'T08:00:00', action: 'ASN created', by: 'Hamza Kadenja' }, { at: created + 'T09:00:00', action: 'ASN approved', by: 'Hamza Kadenja' }] });
  return { asns: [mk('ASN-101', 'CL-001', 'WH-JED-01', T, 'PO-55230', [['RSF-RICE-5K', 80]], iso(addDays(today, -2))), mk('ASN-102', 'CL-003', 'WH-JED-02', T, 'PH-0931', [['HJP-INS-10', 200]], iso(addDays(today, -1))),
    mk('ASN-103', 'CL-002', 'WH-JED-01', iso(addDays(today, 1)), 'IMP-2252', [['NJE-PHN-A5', 40], ['NJE-TV-55', 40]], iso(addDays(today, -1)))], stock: [], tasks: [], grns: [], moves: [] };
}
const IB_RECEIVERS = () => M.users.map(u => u.name);
const ibMove = (at, type, ref, s, qty) => DB.moves.push({ at, type, ref, lpn: s.lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, qty });

/* ---- registers ---- */
const ibCols = {
  asn: [['ASN No.', a => `<b class="mono">${a.id}</b>`], ['Customer', a => esc(clName(a.client))], ['Customer Ref.', a => esc(a.ref || '') || '—'], ['Shipment · Container', a => esc([a.shipment, a.container].filter(Boolean).join(' · ')) || '—'], ['Warehouse', a => esc(whRec(a.wh).name)], ['Expected arrival', a => fmtDate(a.eta) + (a.slot ? ' · ' + esc(a.slot) : '')], ['Lines', a => a.lines.length, 1], ['Qty', a => n0(sum(a.lines, l => +l.qty || 0)), 1], ['Stage', a => esc(ibStage(a))], ['Status', a => pill(a.status)]],
  receiving: [['Receiving No.', a => `<b class="mono">RCV-${ibSfx(a)}</b>`], ['ASN', a => `<span class="mono">${a.id}</span>`], ['Customer', a => esc(clName(a.client))], ['Warehouse', a => esc(whRec(a.wh).name)], ['Dock', a => esc((a.receipt || {}).dock || a.dock || '') || '—'], ['Expected', a => n0(sum(a.lines, l => +l.qty || 0)), 1], ['Received', a => n0(ibSumR(a, 'received')), 1], ['Damaged', a => n0(ibSumR(a, 'damaged')), 1], ['Receiver', a => esc((a.receipt || {}).receiver || '') || '—'], ['Status', a => pill(ibStSt.receiving(a))]],
  grn: [['GRN No.', a => `<b class="mono">${a.grn || '—'}</b>`], ['ASN', a => `<span class="mono">${a.id}</span>`], ['Customer', a => esc(clName(a.client))], ['Customer Ref.', a => esc(a.ref || '') || '—'], ['Warehouse', a => esc(whRec(a.wh).name)], ['GRN date', a => a.grnDate ? fmtDate(a.grnDate) : '—'], ['Accepted', a => n0(ibSumQ(a, 'accepted')), 1], ['Rejected', a => n0(ibSumQ(a, 'rejected')), 1], ['Hold', a => n0(ibSumQ(a, 'held')), 1], ['Status', a => pill(ibStSt.grn(a))]],
  putaway: [['Put-away No.', a => `<b class="mono">PUT-${ibSfx(a)}</b>`], ['GRN No.', a => `<span class="mono">${a.grn || '—'}</span>`], ['ASN', a => `<span class="mono">${a.id}</span>`], ['Customer', a => esc(clName(a.client))], ['Warehouse', a => esc(whRec(a.wh).name)], ['Tasks', a => ibTasks(a).length, 1], ['Done', a => ibTasks(a).filter(t => t.status === 'Done').length, 1], ['Qty', a => n0(sum(ibTasks(a), t => (DB.stock.find(s => s.lpn === t.lpn) || {}).qty || 0)), 1], ['Status', a => pill(ibPutSt(a))]],
  ibinv: [['ASN No.', a => `<b class="mono">${a.id}</b>`], ['Customer', a => esc(clName(a.client))], ['Warehouse', a => esc(whRec(a.wh).name)], ['Received', a => n0(ibSumR(a, 'received')), 1], ['Put away', a => n0(sum(DB.stock.filter(s => ibAsnLpns(a).includes(s.lpn) && s.status === 'Available'), s => s.qty)), 1], ['Hold', a => n0(ibSumQ(a, 'held')), 1], ['Rejected', a => n0(ibSumQ(a, 'rejected')), 1], ['Pallets', a => ibAsnLpns(a).length, 1], ['Status', a => pill(a.status)]] };
const ibNames = { asn: ['ASN', 'ASNs', '+ New ASN', '#asn/new'], receiving: ['Receiving', 'receipts', '+ New receiving', '#receiving/new'], grn: ['GRN', 'GRNs', '+ New GRN', '#grn/new'], putaway: ['Put-Away', 'put-aways'], ibinv: ['Inventory', 'ASNs with stock'] };
const tbl = (cols, rows, href, empty) => rows.length ? `<div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th${c[2] ? ' class="num"' : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr${href ? ` class="click" data-href="${href(r)}"` : ''}>${cols.map(c => `<td${c[2] ? ' class="num"' : ''}>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;

function ibList(stage) {
  const [one, many, newL, newHref] = ibNames[stage], key = 'ib_' + stage, all = DB.asns.filter(ibReach[stage]).slice().reverse();
  const rows = applyFilt(key, all, { status: (r, v) => ibStSt[stage](r) === v, q: (r, v) => [r.id, ibDocNo[stage](r), r.ref, r.shipment, r.container, r.carrier, r.vehicle, clName(r.client)].join(' ').toLowerCase().includes(v.toLowerCase()) });
  const acts = (newL ? `<a class="btn pri" href="${newHref}">${newL}</a>` : '') + (stage === 'putaway' && DB.tasks.some(t => t.status === 'Open') ? '<button type="button" class="btn" data-do="putAll">Confirm all suggested bins</button>' : '');
  let extra = '';
  if (stage === 'ibinv') { const cust = DB.stock.filter(s => ['Received', 'Hold', 'Damaged'].includes(s.status));
    extra = card(`${cust.length} pallets in inbound custody (not yet available)`, tbl([['LPN', s => `<b class="mono">${s.lpn}</b>`], ['Item', s => itemCell(s.sku)], ['Customer', s => esc(clName(s.client))], ['Location', s => ibBinPath(s.wh, s.bin)], ['Qty', s => n0(s.qty), 1], ['Status', s => pill(s.status)], ['QC', s => esc(s.qc || '')]], cust, null, 'Nothing in custody.')); }
  return head2('Inbound', stage === 'ibinv' ? 'Inbound inventory' : one, acts)
    + filterBar(key, [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'wh', label: 'Warehouse', options: DB.warehouses.map(w => [w.id, w.name]) }, { id: 'status', label: 'Status', options: optA(ibStOpts[stage]) }, { id: 'q', type: 'text', label: 'Search number, container, vehicle' }])
    + card(`${rows.length} ${many}`, tbl(ibCols[stage], rows, a => `#${stage}/edit/${encodeURIComponent(a.id)}`, all.length ? 'No records match the filters.' : 'No ' + many + ' yet.')) + extra
    + (stage === 'putaway' && DB.tasks.some(t => !t.asn && t.status === 'Open') ? card('Pallets from transfers and returns', tbl([['Task', t => `<span class="mono">${t.id}</span>`], ['Source', t => `<span class="mono">${esc(t.transfer || t.rma || '')}</span>`], ['LPN', t => `<b class="mono">${esc(t.lpn)}</b>`], ['Item', t => itemCell((lpnBy(t.lpn) || {}).sku)], ['Warehouse', t => esc(whRec(t.wh).name)], ['From → suggested bin', t => `<span class="mono">${esc(t.from)} → ${esc(t.to || '—')}</span>`], ['', t => `<button type="button" class="btn sm pri" data-do="putLoose" data-id="${t.id}">Confirm put-away</button>`]], DB.tasks.filter(t => !t.asn && t.status === 'Open'), null, '')) : '');
}
function ibDash() {
  const A = DB.asns, t = iso(today);
  const m = [['Today’s ASN', A.filter(a => (a.created || '').startsWith(t) || a.eta === t).length, 'asn'], ['Receiving', A.filter(ibRcvElig).length, 'receiving'], ['GRN pending', A.filter(a => (a.qc || {}).status === 'Completed' && a.grnStatus !== 'Approved').length, 'grn'], ['Put-away pending', DB.tasks.filter(x => x.status === 'Open').length, 'putaway']];
  const go2 = a => { const k = { ASN: 'asn', Receiving: 'receiving', GRN: 'grn', 'Put-away': ibPutElig(a) ? 'putaway' : 'grn', Completed: 'ibinv', Cancelled: 'asn' }[ibStage(a)]; return `#${k}/edit/${encodeURIComponent(a.id)}`; };
  return head2('Inbound', 'Inbound dashboard', `<a class="btn pri" href="#asn/new">+ New ASN</a>`)
    + `<div class="ib-cards">${m.map(([k, n, s]) => `<a class="ib-card" href="#${s}"><span>${k}</span><strong>${n}</strong></a>`).join('')}</div>`
    + card('Recent inbound transactions', tbl([['ASN', a => `<b class="mono">${a.id}</b>`], ['Customer', a => esc(clName(a.client))], ['Warehouse', a => esc(whRec(a.wh).name)], ['Vehicle', a => esc(a.vehicle || '') || '—'], ['Stage', a => esc(ibStage(a))], ['Status', a => pill(a.status)], ['Created', a => fmtDate((a.created || '').slice(0, 10))]], A.slice().reverse().slice(0, 20), go2, 'No inbound transactions yet.'));
}

/* ---- record pages ---- */
const ibSec2 = (title, body, sub) => `<section class="card"><div class="card-h"><div><h2>${title}</h2>${sub ? `<p class="note">${sub}</p>` : ''}</div></div>${body}</section>`;
const ibRO2 = (l, v) => fld(l, `<input value="${esc(v)}" readonly tabindex="-1" class="ro-in">`);
const ibHead = (stage, a, title, extraBtns = '') => head2(`<a href="#${stage}" style="color:inherit">Inbound · ${ibNames[stage][0]}</a>`, `${title} · ${esc(ibDocNo[stage](a))}`, `${extraBtns}<a class="btn" href="#${stage}">← All ${ibNames[stage][1]}</a>`) + ibChain(a, stage);
const ibLock = (stage, a, ok) => ok ? '' : `<p class="note" style="margin:0">This ${ibNames[stage][0].toLowerCase()} is ${esc(String(ibStSt[stage](a)).toLowerCase())} and read-only.</p>`;
const ibFoot = list => `<div class="form-foot">${list.filter(Boolean).map(([l, d, cls]) => { const [dd, id] = d.split('|'); return `<button type="button" class="btn ${cls || ''}" data-do="${dd}" data-id="${esc(id || '')}">${l}</button>`; }).join('')}</div>`;
let ibCur = null;

function rcvPage(a) {
  const r = a.receipt || {}, rl = r.lines || [], ok = ibRcvElig(a);
  if (!ok) setTimeout(() => document.querySelectorAll('#rcvForm :is(input,select,textarea)').forEach(el => el.disabled = true), 0);
  return `${ibHead('receiving', a, 'Receiving')}${ibLock('receiving', a, ok)}<div class="err" id="ibErr" role="alert"></div>
  <form id="rcvForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Receiving header', `<div class="card-b fgrid f3">${ibRO2('Receiving No.', 'RCV-' + ibSfx(a))}${ibRO2('ASN No.', a.id)}${fld('Receiving Date', `<input name="rtime" type="datetime-local" value="${esc(r.time || (iso(today) + 'T' + ibNowTime()))}">`, 1)}
    ${ibRO2('Customer', clName(a.client))}${ibRO2('Customer Ref.', a.ref || '—')}${ibRO2('Warehouse', a.wh + ' · ' + whRec(a.wh).name)}${ibRO2('Vehicle No.', a.vehicle || '—')}${ibRO2('Container No.', a.container || '—')}
    ${fld('Dock', `<select name="dock">${opt([['', 'Choose…'], ...optA(IB_DOCKS)], r.dock || a.dock || '')}</select>`)}
    ${fld('Receiver', `<select name="receiver">${opt([['', 'Choose…'], ...optA(IB_RECEIVERS())], r.receiver || DATA.user.name)}</select>`, 1)}
    <label class="chk" style="align-self:end"><input type="checkbox" name="excessOk" ${r.excessOk ? 'checked' : ''}> Excess approved by supervisor</label></div>`)}
  ${ibSec2('Actual receipt lines', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:940px"><thead><tr><th>Item code</th><th style="min-width:150px">Item name</th><th>Cust. item code</th><th class="num">Expected</th><th class="num" style="width:100px">Received</th><th class="num" style="width:90px">Damaged</th><th class="num">Short</th><th class="num">Excess</th><th>UOM</th><th style="width:140px">MFG</th><th style="width:140px">Expiry</th></tr></thead><tbody id="ibRcv">
    ${a.lines.map((l, i) => { const x = rl[i] || {}, rc = x.received ?? l.qty, it = item(l.sku); return `<tr class="ib-rl" data-i="${i}" data-exp="${l.qty}"><td class="pad"><b class="mono">${esc(it.code || l.sku)}</b></td><td class="pad">${esc(it.name || '')}${l.desc ? `<br><span class="note">${esc(l.desc)}</span>` : ''}${it.expiry ? '<br><span class="pill p-warn">Expiry tracked</span>' : ''}</td><td class="pad mono">${esc(it.custCode || l.sku)}</td><td class="num pad">${n0(l.qty)}</td>
      <td><input data-l="received" type="number" min="0" step="1" value="${esc(rc)}" class="num"></td><td><input data-l="damaged" type="number" min="0" step="1" value="${esc(x.damaged ?? 0)}" class="num"></td>
      <td class="num pad ib-short">${rc === '' ? '—' : n0(Math.max(l.qty - rc, 0))}</td><td class="num pad ib-excess">${rc === '' ? '—' : n0(Math.max(rc - l.qty, 0))}</td><td class="pad">${esc(ibUom(l))}</td>
      <td><input data-l="mfg" type="date" value="${esc(x.mfg || '')}"></td><td><input data-l="expiry" type="date" value="${esc(x.expiry || '')}"></td></tr>`; }).join('')}
    </tbody></table></div></div>`, 'Damaged quantity is included in received. Short = expected − received; excess = received − expected.')}
  </form>${ok ? ibFoot([['Save', 'rcvSave'], ['Complete receiving', 'rcvDone', 'pri']]) : ''}`;
}
function rcvRead(a) {
  const fm = $('#rcvForm'), g = n => { const el = fm.querySelector(`[name="${n}"]`); return el.type === 'checkbox' ? el.checked : el.value.trim(); };
  const r = a.receipt = a.receipt || {}; if (r.status === 'Completed') throw new Error('Receipt is locked.');
  r.no = 'RCV-' + ibSfx(a); r.dock = g('dock'); r.receiver = g('receiver'); r.time = g('rtime'); r.excessOk = g('excessOk'); r.status = !r.status || r.status === 'Not started' ? 'Draft' : r.status;
  r.lines = [...fm.querySelectorAll('#ibRcv .ib-rl')].map(row => { const o = {}; row.querySelectorAll('[data-l]').forEach(x => o[x.dataset.l] = x.value.trim()); o.received = o.received === '' ? '' : +o.received; o.damaged = +o.damaged || 0; const l = a.lines[+row.dataset.i], prev = (r.lines || [])[+row.dataset.i] || {}; o.batch = prev.batch || item(l.sku).batchNo || ''; o.lpn = ''; return o; });
  r.lines.forEach((x, i) => { const n = 'Line ' + (i + 1) + ': '; if (x.received !== '' && (!(x.received >= 0) || !Number.isInteger(x.received))) throw new Error(n + 'received must be a whole number, 0 or more.'); if (x.damaged < 0 || !Number.isInteger(x.damaged)) throw new Error(n + 'damaged must be a whole number.'); if (x.received !== '' && x.damaged > x.received) throw new Error(n + 'damaged cannot be more than received.'); });
  return r;
}
function ibSuggest(w, sku, cl, taken = []) {
  const temp = item(sku).temp;
  const bs = DB.bins.filter(b => b.wh === w && b.putaway !== false && !placeBlocked(b) && STORE_Z.includes(zoneOf(b).type) && PUT_ROLES.includes(b.role || 'Reserve storage') && (binCount(b) + taken.filter(x => x === b.code).length) < b.cap && (!b.client || b.client === cl) && (!temp || b.temp === temp || b.temp === 'Any'));
  return bs.sort((x, y) => binCount(x) - binCount(y) || x.code.localeCompare(y.code));
}
function ibMakePut(a) {
  const r = a.receipt, q = a.qc, dock = ibDock(a.wh), taken = [];
  q.lines.forEach((x, i) => { if (!x.accepted) return; const s = DB.stock.find(y => y.lpn === r.lines[i].lpn); if (!s) return;
    const b = ibSuggest(a.wh, s.sku, a.client, taken)[0], to = b ? b.code : ''; if (to) taken.push(to);
    DB.tasks.push({ id: seqNo('PUT', 'PUT-', 4), lpn: s.lpn, wh: a.wh, from: s.bin || dock.code, to, suggested: to, status: 'Open', created: iso(today), done: null, by: '', asn: a.id }); });
  a.putCreated = true; ibAudit(a, 'Put-away tasks created');
}
function ibDoGrn(a, gd) {
  const r = a.receipt, q = a.qc;
  const g = { id: seqNo('GRN@' + a.loc, 'GRN-' + a.loc + '-', 5), loc: a.loc, asn: a.id, client: a.client, wh: a.wh, at: gd, by: r.receiver,
    lines: a.lines.map((l, i) => ({ sku: l.sku, expected: l.qty, received: r.lines[i].received || 0, accepted: q.lines[i].accepted, rejected: q.lines[i].rejected, held: q.lines[i].held, damaged: r.lines[i].damaged || 0, diff: (r.lines[i].received || 0) - l.qty, lpn: r.lines[i].lpn, batch: r.lines[i].batch, mfg: r.lines[i].mfg || '', expiry: r.lines[i].expiry, uom: ibUom(l) })).filter(x => x.received) };
  DB.grns.push(g); a.grn = g.id; a.grnStatus = 'Approved'; a.grnDate = gd; ibAudit(a, 'GRN ' + g.id + ' approved');
  if (IB_CFG.autoPutaway) ibMakePut(a);
  return g;
}
function ibAutoQc(a, at) {   // QC is not used: accepted = received − damaged; damaged goes to QA hold as rejected
  const r = a.receipt, q = a.qc = { no: 'QC-' + ibSfx(a), status: 'Draft', auto: true, inspector: 'Automatic (QC not used)', date: at, lines: r.lines.map(x => ({ accepted: Math.max(0, (+x.received || 0) - (+x.damaged || 0)), rejected: Math.min(+x.damaged || 0, +x.received || 0), held: 0 })) };
  q.followup = q.lines.some(x => x.rejected) ? 'Damaged at receipt ' + r.no : '';
  a.splitLpns = a.splitLpns || [];
  q.lines.forEach((x, i) => { const rl = r.lines[i]; if (!rl.received) return; const s = DB.stock.find(y => y.lpn === rl.lpn); if (!s) return;
    const qa = binRec(a.wh, 'QA-HOLD');
    if (x.rejected) { if (!x.accepted) Object.assign(s, { status: 'Damaged', qc: 'Rejected', bin: qa ? qa.code : s.bin });
      else { s.qty -= x.rejected; const n = { ...s, lpn: seqNo('LPN', 'LPN-', 6), qty: x.rejected, status: 'Damaged', qc: 'Rejected', bin: qa ? qa.code : s.bin }; DB.stock.push(n); a.splitLpns.push(n.lpn); ibMove(at, 'QC split Damaged', q.no, n, 0); } }
    if (x.accepted) { s.qc = 'Accepted'; s.status = 'Received'; } });
  q.status = 'Completed'; q.completedAt = new Date().toISOString(); ibAudit(a, 'Disposition set automatically (QC not used)');
}
function ibComplete(a) {
  const ts = ibTasks(a), exc = (a.qc.lines || []).some(x => x.held || x.rejected);
  if (a.grnStatus === 'Approved' && a.putCreated && ts.every(t => t.status === 'Done') && (!exc || (a.qc.followup || '').trim())) { a.status = 'Completed'; a.received = a.received || iso(today); ibAudit(a, 'ASN completed'); return true; }
  return false;
}

function grnPage(a) {
  const r = a.receipt, q = a.qc, g = a.grn ? DB.grns.find(x => x.id === a.grn) : null, L = a.lines.map((l, i) => ({ l, i })).filter(x => x.l.sku);
  return `${ibHead('grn', a, 'GRN', g ? '<button type="button" class="btn" data-do="printPage">Print GRN</button>' : '')}
  <div class="err" id="ibErr" role="alert"></div><form id="grnForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('GRN header', `<div class="card-b fgrid f3">${ibRO2('GRN No.', g ? g.id : grnPreview(a.loc))}${a.grnStatus === 'Approved' ? ibRO2('GRN date', fmtDate(a.grnDate)) : fld('GRN date', `<input name="gdate" type="date" value="${esc(iso(today))}">`, 1)}${ibRO2('Status', a.grnStatus || 'Pending')}${ibRO2('ASN No.', a.id)}${ibRO2('Receiving No.', r.no || 'RCV-' + ibSfx(a))}
    ${ibRO2('Receiving Date & Time', r.time ? fmtDate(r.time.slice(0, 10)) + (r.time.length > 10 ? ' ' + r.time.slice(11, 16) : '') : '—')}${ibRO2('Received By', r.receiver || '—')}${ibRO2('Customer', clName(a.client))}${ibRO2('Customer Ref.', a.ref || '—')}${ibRO2('Warehouse', a.wh + ' · ' + whRec(a.wh).name)}${ibRO2('Vehicle No.', a.vehicle || '—')}</div>`)}
  ${ibSec2('GRN lines', `<div class="card-b">${tbl([['Item code', x => `<b class="mono">${esc(item(x.l.sku).code || '—')}</b>`], ['Item name', x => esc(item(x.l.sku).name || '') + (x.l.desc ? `<br><span class="note">${esc(x.l.desc)}</span>` : '')], ['Cust. item code', x => `<span class="mono">${esc(item(x.l.sku).custCode || x.l.sku)}</span>`],
      ['Expected', x => n0(x.l.qty), 1], ['Received', x => n0(r.lines[x.i].received || 0), 1], ['Accepted', x => n0(q.lines[x.i].accepted), 1], ['Rejected', x => n0(q.lines[x.i].rejected), 1], ['Hold', x => n0(q.lines[x.i].held), 1], ['UOM', x => esc(ibUom(x.l))],
      ['Mfg. Date', x => r.lines[x.i].mfg ? fmtDate(r.lines[x.i].mfg) : '—'], ['Expiry', x => r.lines[x.i].expiry ? fmtDate(r.lines[x.i].expiry) : '—'], ['LPN', x => `<span class="mono">${esc(r.lines[x.i].lpn || '—')}</span>`]], L, null, 'No lines.')}</div>`,
    'Quantities stay in the line UOM. Approving the GRN does not receive stock again; it confirms the received and inspected quantities.')}
  ${q.followup ? ibSec2('Exceptions', `<div class="card-b"><p style="margin:0">${esc(q.followup)} · damaged stock is in <b class="mono">QA-HOLD</b>.</p></div>`) : ''}
  </form>${ibFoot([a.grnStatus !== 'Approved' && ['Approve GRN', 'grnApprove', 'pri'], a.grnStatus === 'Approved' && !a.putCreated && ['Create put-away', 'putCreate', 'pri']])}`;
}
function putPage(a) {
  const ts = ibTasks(a), done = ibPutSt(a) === 'Completed';
  return `${ibHead('putaway', a, 'Put-Away')}<div class="err" id="ibErr" role="alert"></div>
  <form id="putForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${ibSec2('Put-Away', `<div class="card-b fgrid f3">${ibRO2('Put-Away No.', 'PUT-' + ibSfx(a))}${done ? ibRO2('Put-Away Date', fmtDate(a.putDate)) : fld('Put-Away Date', `<input name="putDate" type="date" value="${esc(a.putDate || iso(today))}">`, 1)}${ibRO2('Customer Name', clName(a.client))}${ibRO2('Warehouse', a.wh + ' · ' + whRec(a.wh).name)}${ibRO2('ASN No.', a.id)}${ibRO2('GRN No.', a.grn || '—')}${ibRO2('Customer Ref.', a.ref || '—')}</div>`)}
  ${ibSec2('Task lines · one confirmation per task', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:900px"><thead><tr><th>Task</th><th>LPN</th><th>Item code</th><th>Item name</th><th>Cust. item code</th><th class="num">Qty</th><th>UOM</th><th>From</th><th style="min-width:200px">Destination bin</th><th>Status</th><th></th></tr></thead><tbody>
    ${ts.map(t => { const s = DB.stock.find(x => x.lpn === t.lpn) || {}, it = item(s.sku), op = t.status === 'Done' ? [] : ibSuggest(t.wh, s.sku, s.client).map(b => [b.code, `${b.code} · ${zoneOf(b).code || ''} · ${binCount(b)}/${b.cap}`]);
      return `<tr><td class="mono pad">${t.id}</td><td class="mono pad"><b>${esc(t.lpn)}</b></td><td class="mono pad"><b>${esc(it.code || '')}</b></td><td class="pad">${esc(it.name || '')}</td><td class="mono pad">${esc(it.custCode || s.sku || '')}</td><td class="num pad">${n0(s.qty || 0)}</td><td class="pad">${esc(it.uom || '')}</td><td class="mono pad">${esc(t.from || '')}</td>
      <td>${t.status === 'Done' ? ibBinPath(t.wh, t.to) : op.length ? `<select data-dest="${t.id}">${opt(op, op.some(o => o[0] === t.to) ? t.to : op[0][0])}</select>` : '<span class="pill p-bad">No free bin</span>'}</td><td class="pad">${pill(t.status === 'Done' ? 'Completed' : 'Pending')}</td>
      <td>${t.status === 'Done' ? '<span class="note">Confirmed</span>' : op.length ? `<button type="button" class="btn sm pri" data-do="putConfirm" data-id="${t.id}">Confirm</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No put-away tasks.</td></tr>'}
    </tbody></table></div></div>`, 'Bins offered: storage bins in this warehouse with free pallet positions, the right temperature, and no placement block.')}
  </form>`;
}
function invPage(a) {
  const lp = ibAsnLpns(a), st = DB.stock.filter(s => lp.includes(s.lpn)), r = a.receipt || { lines: [] }, q = a.qc || { lines: [] };
  const RL = i => (r.lines || [])[i] || {}, QL = i => (q.lines || [])[i] || {};
  return `${ibHead('ibinv', a, 'Inventory')}
  ${card('Inventory from this ASN', tbl([['Owner', s => esc(clName(s.client))], ['SKU', s => `<span class="mono">${esc(s.sku)}</span>`], ['Lot', s => esc(s.batch || '—')], ['LPN', s => `<span class="mono">${s.lpn}</span>`], ['Location', s => ibBinPath(s.wh, s.bin)], ['Qty', s => n0(s.qty), 1], ['Status', s => pill(s.status)]], st, null, 'No stock from this ASN yet.'))}
  ${card('Custody / exception reconciliation', tbl([['SKU', x => `<b class="mono">${esc(x.l.sku)}</b>`], ['Received', x => n0(RL(x.i).received || 0), 1],
    ['Accepted, awaiting put-away', x => { const s = DB.stock.find(y => y.lpn === RL(x.i).lpn); return n0(s && s.status !== 'Available' && s.qc === 'Accepted' ? s.qty : 0); }, 1],
    ['Put away', x => { const s = DB.stock.find(y => y.lpn === RL(x.i).lpn); return n0(s && s.status === 'Available' ? s.qty : 0); }, 1], ['Hold', x => n0(QL(x.i).held || 0), 1], ['Rejected', x => n0(QL(x.i).rejected || 0), 1], ['UOM', x => esc(ibUom(x.l))]], a.lines.map((l, i) => ({ l, i })), null, 'No lines.'))}
  ${card('Audit trail', `<div class="card-b" style="display:flex;flex-direction:column;gap:6px">${(a.audit || []).slice().reverse().map(x => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line-2);padding-bottom:6px"><span class="note mono">${esc(String(x.at).slice(0, 16).replace('T', ' '))}</span><b style="font-weight:500">${esc(x.action)} <span class="note">· ${esc(x.by || '')}</span></b></div>`).join('') || '<p class="note" style="margin:0">No actions yet.</p>'}</div>`)}`;
}

/* ---- actions ---- */
Object.assign(DO, {
  printPage() { window.print(); },
  rcvSave() { const a = ibCur; try { rcvRead(a); } catch (e) { return formErr('#ibErr', e); } ibAudit(a, 'Receipt saved'); persist(); toast(a.id + ': Receipt saved.'); route(); },
  rcvDone() {
    const a = ibCur;
    try {
      const r = rcvRead(a);
      if (!r.receiver || !r.time) throw new Error('Enter the receiver and the receiving date.');
      if (r.time.slice(0, 10) > iso(today)) throw new Error('The receiving date cannot be in the future.');
      if (r.lines.some(x => x.received === '')) throw new Error('Enter the received quantity on every line (0 if nothing arrived).');
      if (r.lines.every(x => !x.received)) throw new Error('Nothing was received. Enter the received quantities.');
      r.lines.forEach((x, i) => { const l = a.lines[i], it = item(l.sku), n = 'Line ' + (i + 1) + ': '; if (!x.received) return;
        if (x.received > l.qty * (1 + IB_CFG.overPct / 100) && !r.excessOk) throw new Error(n + 'received is more than expected. Tick "Excess approved by supervisor" or receive it on a new ASN.');
        if (it.expiry && !x.expiry) throw new Error(n + it.name + ' is expiry tracked. Enter the expiry date.');
        if (x.mfg && x.expiry && x.mfg > x.expiry) throw new Error(n + 'the MFG date is after the expiry date.');
        if (x.expiry && x.expiry < iso(today)) throw new Error(n + 'the expiry date is in the past. Receive expired goods on an exception.'); });
    } catch (e) { return formErr('#ibErr', e); }
    const r = a.receipt, dock = ibDock(a.wh), at = r.time.slice(0, 10);
    r.lines.forEach((x, i) => { if (!x.received) return; const l = a.lines[i]; x.lpn = seqNo('LPN', 'LPN-', 6);
      const s = { lpn: x.lpn, client: a.client, sku: l.sku, wh: a.wh, bin: dock.code, batch: x.batch || '', expiry: x.expiry || '', qty: x.received, alloc: 0, status: 'Received', received: at, qc: 'Pending', asn: a.id };
      DB.stock.push(s); ibMove(at, 'Receipt', r.no, s, x.received); });
    r.status = 'Completed'; r.completedAt = new Date().toISOString(); a.received = at; a.status = 'Receiving'; a.dock = r.dock || a.dock;
    ibAudit(a, 'Receiving completed');
    let msg = a.id + ' received into ' + dock.code + '.';
    ibAutoQc(a, at); if (a.qc.lines.some(x => x.rejected)) msg += ' Damaged quantity went to QA-HOLD.';
    if (IB_CFG.autoGrn) { const g = ibDoGrn(a, at); msg += ' ' + g.id + ' created' + (a.putCreated ? ' and put-away tasks opened' : '') + '.'; }
    ibComplete(a); persist(); toast(msg); go('#receiving');
  },
  grnApprove() { const a = ibCur; if ((a.qc || {}).status !== 'Completed') return formErr('#ibErr', new Error('Complete receiving first.')); const gd = ($('#grnForm [name=gdate]') || {}).value || iso(today); const g = ibDoGrn(a, gd); ibComplete(a); persist(); toast(g.id + ' approved' + (a.putCreated ? ' and put-away tasks created' : '') + '.'); go('#grn'); },
  putCreate() { const a = ibCur; if (a.putCreated) return; ibMakePut(a); ibComplete(a); persist(); toast('Put-away tasks created for ' + a.id + '.'); go('#putaway/edit/' + encodeURIComponent(a.id)); },
  putConfirm(tid) {
    const t = DB.tasks.find(x => x.id === tid), a = ibA(t.asn), dest = ($(`[data-dest="${tid}"]`) || {}).value, pd = ($('#putForm [name=putDate]') || {}).value || iso(today);
    try { if (!dest) throw new Error('No destination bin is available.'); if (pd > iso(today)) throw new Error('The put-away date cannot be in the future.'); if (a.grnDate && pd < a.grnDate) throw new Error('The put-away date cannot be before the GRN date (' + fmtDate(a.grnDate) + ').');
      const s = DB.stock.find(x => x.lpn === t.lpn), b = binRec(t.wh, dest); if (!b || binCount(b) >= b.cap) throw new Error('Bin ' + dest + ' has no free pallet position.'); if (placeBlocked(b)) throw new Error('Bin ' + dest + ' is blocked for placement.');
      s.bin = dest; s.status = 'Available'; t.to = dest; t.status = 'Done'; t.done = pd; t.by = DATA.user.name; ibMove(pd, 'Putaway', t.id, s, 0); }
    catch (e) { return formErr('#ibErr', e); }
    a.putDate = pd; ibAudit(a, 'Put-away ' + t.lpn + ' → ' + dest); const fin = ibComplete(a); persist();
    toast(t.lpn + ' put away to ' + dest + '.' + (fin ? ' ' + a.id + ' is completed.' : '')); if (fin) go('#putaway'); else route();
  },
  putAll() {
    let n = 0, skip = 0; const fin = new Set();
    DB.tasks.filter(t => t.status === 'Open').forEach(t => { const s = DB.stock.find(x => x.lpn === t.lpn), b = t.to && binRec(t.wh, t.to), alt = (b && binCount(b) < b.cap && !placeBlocked(b)) ? b : ibSuggest(t.wh, s.sku, s.client)[0];
      if (!alt) { skip++; return; } s.bin = alt.code; s.status = 'Available'; Object.assign(t, { to: alt.code, status: 'Done', done: iso(today), by: DATA.user.name }); ibMove(iso(today), 'Putaway', t.id, s, 0);
      const a = ibA(t.asn); if (a) { a.putDate = iso(today); ibAudit(a, 'Put-away ' + t.lpn + ' → ' + alt.code); if (ibComplete(a)) fin.add(a.id); } n++; });
    persist(); toast(`${n} pallet${n === 1 ? '' : 's'} put away${skip ? `, ${skip} without a free bin` : ''}.${fin.size ? ' Completed: ' + [...fin].join(', ') + '.' : ''}`); route();
  },
  ibPick(stage) {
    const L = stage === 'receiving' ? DB.asns.filter(ibRcvElig) : DB.asns.filter(a => (a.qc || {}).status === 'Completed' && a.grnStatus !== 'Approved' && a.status !== 'Cancelled');
    const id = $('#ibPickSel').value; closeModal(); if (id) go(`#${stage}/edit/${encodeURIComponent(id)}`); return L;
  }
});
function ibPicker(stage) {
  const L = stage === 'receiving' ? DB.asns.filter(ibRcvElig) : DB.asns.filter(a => (a.qc || {}).status === 'Completed' && a.grnStatus !== 'Approved' && a.status !== 'Cancelled');
  if (!L.length) { history.replaceState(null, '', '#' + stage); return toast(stage === 'receiving' ? 'No approved ASN is waiting to be received. Create and approve an ASN first.' : 'Every completed receipt already has its GRN. Complete a receiving first.'); }
  modal(stage === 'receiving' ? 'New receiving' : 'New GRN', `<label class="field"><span class="flbl">${stage === 'receiving' ? 'Receive against ASN' : 'Create GRN for receipt'}<span class="req"> *</span></span><select id="ibPickSel">${opt(L.map(a => [a.id, (stage === 'grn' ? 'RCV-' + ibSfx(a) + ' · ' : '') + a.id + ' · ' + clName(a.client) + ' · ' + fmtDate(a.eta)]), '')}</select></label>`,
    `<button type="button" class="btn" data-do="mClose">Cancel</button><button type="button" class="btn pri" data-do="ibPick" data-id="${stage}">${stage === 'receiving' ? 'Open receiving' : 'Open GRN'}</button>`);
}
document.addEventListener('input', e => { const row = e.target.closest && e.target.closest('#ibRcv .ib-rl'); if (!row || e.target.dataset.l !== 'received') return; const ex = +row.dataset.exp, v = e.target.value === '' ? null : +e.target.value;
  row.querySelector('.ib-short').textContent = v == null ? '—' : n0(Math.max(ex - v, 0)); row.querySelector('.ib-excess').textContent = v == null ? '—' : n0(Math.max(v - ex, 0)); });

function ibShow(page, mode, id) {
  CUR = { mod: 'inbound', sub: page };
  if (page === 'inbound') return ibDash();
  if (page === 'asn') {
    if (mode === 'new') { if (!draft || draft.kind !== 'asn' || draft.saved) draft = newAsn(); return asnPage(draft); }
    if (mode === 'edit') { const a = ibA(id); if (!a) return head2('Inbound', 'ASN not found', '<a class="btn" href="#asn">← All ASNs</a>') + '<div class="card empty">This ASN no longer exists.</div>';
      draft = { ...JSON.parse(JSON.stringify(ibNorm(a))), kind: 'asn', saved: true }; return asnPage(draft); }
    return ibList('asn');
  }
  if ((page === 'receiving' || page === 'grn') && mode === 'new') { setTimeout(() => ibPicker(page), 0); return ibList(page); }
  if (mode === 'edit') { const a = ibA(id);
    if (!a || !ibReach[page](a)) return head2('Inbound', 'Not available', `<a class="btn" href="#${page}">← Back</a>`) + `<div class="card empty">${a ? a.id + ' has not reached this stage yet.' : 'This ASN no longer exists.'}</div>`;
    ibCur = ibNorm(a); return { receiving: rcvPage, grn: grnPage, putaway: putPage, ibinv: invPage }[page](a); }
  return ibList(page);
}
