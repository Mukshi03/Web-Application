'use strict';
/* =====================================================================
   RETURNS (RMA)  (ERP: 1 RMA Request · 2 Receive & Inspect · 3 Reconcile & Close)
   ===================================================================== */
const RMA_ST = ['Draft', 'Requested', 'Approved', 'Receiving', 'Received', 'Closed', 'Rejected', 'Cancelled'];
Object.assign(TONE, { Requested: 'warn', Approved: 'info', Receiving: 'warn', Received: 'info', Closed: 'good', Rejected: 'mute', Matched: 'good' });
const RMA_REASONS = ['Wrong item delivered', 'Damaged in transit', 'Expired / short expiry', 'Refused by consignee', 'Delivery failed', 'Customer changed mind', 'Temperature concern', 'Excess quantity', 'Other'];
const RMA_COND = ['Good', 'Packaging damaged', 'Product damaged', 'Expired', 'Short shelf life', 'Temperature breach', 'Wrong item', 'Missing parts'];
const RMA_HOLD_ACT = ['Awaiting customer decision', 'Return to customer', 'Dispose (customer approved)', 'Release to stock after QA'];
const RMA_DEF = { window: 30, block: 'Yes', lateRef: 'Yes', approve: 'Yes', reqAuth: 'No', reqExpected: 'Yes', reqContact: 'No', decision: 'good', partial: 'Yes', reqVehicle: 'No', reqTemp: 'Yes', reqNote: 'Yes', blockExpired: 'Yes', minShelf: 0, reqEvidence: 'No',
  autoClose: 'Yes', reqPutaway: 'Yes', shortRef: 'Yes', holdOwner: 'Yes', dispCert: 'Yes', charge: 'Yes', chargeSvc: 'HDL-004', chargeBasis: 'unit', chargeAt: 'receipt' };
const RMA_CFG_F = [
  ['1 · RMA Request', [['window', 'Return window, days after dispatch', 'number'], ['block', 'Block returns after the return window'], ['lateRef', 'Late returns need a customer approval reference (when not blocked)'], ['approve', 'RMA needs approval before goods arrive'], ['reqAuth', 'Customer authorisation reference is required'], ['reqExpected', 'Expected arrival date is required'], ['reqContact', 'Contact name and mobile are required']]],
  ['2 · Receive & Inspect', [['decision', 'Default inspection result', 'select', [['good', 'Good · Restock'], ['hold', 'Hold (QA)'], ['disp', 'Dispose']]], ['partial', 'Allow partial receipts (more than one truck)'], ['reqVehicle', 'Vehicle number and driver are required'], ['reqTemp', 'Temperature is required for chilled and frozen items'], ['reqNote', 'Condition or note is required for Hold, Damaged or Dispose'], ['blockExpired', 'Block restock of expired goods'], ['minShelf', 'Minimum shelf life left to restock, days (0 = no check)', 'number'], ['reqEvidence', 'Photo / evidence reference is required when anything is not good']]],
  ['3 · Reconcile & Close', [['autoClose', 'Close automatically when everything is received and put away'], ['reqPutaway', 'Put-away must be confirmed before closing'], ['shortRef', 'Closing short needs an approval reference'], ['holdOwner', 'Held or damaged stock needs a decision and a responsible person'], ['dispCert', 'Disposal certificate reference is required']]],
  ['Charges', [['charge', 'Charge returns handling'], ['chargeSvc', 'Returns handling service', 'select', () => M.services.filter(s => s.cat !== 'Storage').map(s => [s.code, s.code + ' · ' + s.name])], ['chargeBasis', 'Charge basis', 'select', [['unit', 'Per unit received'], ['line', 'Per line received'], ['rma', 'Per RMA']]], ['chargeAt', 'Raise the charge', 'select', [['receipt', 'On receipt'], ['close', 'On closing the RMA']]]]]];
const rmaC = k => ((DB.rmaCfg || {})[k] ?? RMA_DEF[k]);
const rmaY = k => rmaC(k) === 'Yes';
const rmaR = id => DB.returns.find(r => r.id === id);
const rmaTot = (r, k) => sum(r.lines, l => +l[k] || 0);
const rmaOut = l => Math.max(0, (+l.ret || 0) - (+l.recv || 0));
const rmaTasks = r => DB.tasks.filter(t => t.rma === r.id);
const rmaAge = o => { const d = String(o.dispatchedAt || o.created || '').slice(0, 10); return d ? Math.max(0, daysBetween(d, iso(today))) : 0; };
const rmaOrders = cl => DB.orders.filter(o => o.client === cl && ['Dispatched', 'Delivered'].includes(o.status)).slice().reverse();
const rmaCold = sku => /chill|froz/i.test(item(sku).temp || '');
const rmaUsers = () => M.users.map(u => [u.name, u.name]);
const rmaOrd = r => DB.orders.find(o => o.id === r.order);
function rmaShip(o, skipId) {
  const G = {};
  o.lines.forEach(l => { const P = (l.picks || []).length ? l.picks : [{ batch: '', expiry: '', qty: l.qty - (l.short || 0) }]; P.forEach(p => { const k = l.sku + '|' + (p.batch || ''); (G[k] = G[k] || { sku: l.sku, batch: p.batch || '', expiry: p.expiry || '', shipped: 0, prev: 0 }).shipped += +p.qty || 0; }); });
  DB.returns.filter(r => r.order === o.id && r.id !== skipId && !['Cancelled', 'Rejected'].includes(r.status)).forEach(r => r.lines.forEach(l => { const g = G[l.sku + '|' + (l.batch || '')] || Object.values(G).find(x => x.sku === l.sku); if (g) g.prev += ['Closed', 'Received'].includes(r.status) ? +l.recv || 0 : +l.ret || 0; }));
  return Object.values(G).filter(g => g.shipped > 0);
}
function rmaStepOk(r, i) { if (!r) return i === 0; if (i === 0) return true; if (i === 1) return ['Approved', 'Receiving', 'Received', 'Closed'].includes(r.status); return ['Receiving', 'Received', 'Closed'].includes(r.status); }
const rmaNext = r => ({ Draft: ['Edit', 1], Requested: rmaY('approve') ? ['Approve', 1, 'pri'] : ['Open', 1], Approved: ['Receive', 2, 'pri'], Receiving: ['Receive', 2, 'pri'], Received: ['Close', 3, 'pri'], Closed: ['View', 3], Rejected: ['View', 1], Cancelled: ['View', 1] }[r.status]);
const rmaHref = (r, s) => `#rma/s${s || rmaNext(r)[1]}/${encodeURIComponent(r.id)}`;

function rmaChecks(r, d) {
  const o = DB.orders.find(x => x.id === (r ? r.order : d && d.order)), win = +rmaC('window') || 0, age = o ? rmaAge(o) : 0, C = [], add = (ok, t, warn) => C.push({ ok, t, warn });
  add(!!o, o ? 'Order ' + o.id + ' is ' + o.status.toLowerCase() : 'Choose a dispatched order');
  if (o && win) add(age <= win, age <= win ? `Within the return window (${age} of ${win} days)` : `Return window passed: ${age} days (limit ${win})`, age > win && !rmaY('block'));
  if (rmaY('reqAuth')) add(!!((r || d || {}).cref), 'Customer authorisation reference');
  if (r) { const ap = !['Draft', 'Requested', 'Rejected', 'Cancelled'].includes(r.status);
    add(ap, rmaY('approve') ? (ap ? 'Approved' + (r.approvedBy ? ' by ' + r.approvedBy : '') : 'Waiting for approval') : 'Approval not required');
    if (r.receipts.length || ap) { const out = sum(r.lines, rmaOut); add(!out, out ? out + ' unit' + (out === 1 ? '' : 's') + ' still to receive' : 'All authorised goods received', out && r.status === 'Received'); }
    const open = rmaTasks(r).filter(t => t.status === 'Open').length; if (rmaTasks(r).length) add(!open, open ? open + ' put-away task' + (open === 1 ? '' : 's') + ' open' : 'Put-away confirmed');
    if (rmaTot(r, 'hold') + rmaTot(r, 'dmg')) add(!!(r.holdAct && r.holdOwner), 'Hold / damaged decision and owner' + (r.holdAct ? ': ' + r.holdAct : ''));
    if (rmaTot(r, 'disp') && rmaY('dispCert')) add(!!r.dispCert, 'Disposal certificate' + (r.dispCert ? ' ' + r.dispCert : ''));
    if (rmaY('charge')) add(r.charges.length > 0, r.charges.length ? 'Charged: ' + r.charges.join(', ') : 'Charge ' + (rmaC('chargeAt') === 'close' ? 'on closing' : 'on receipt'), true); }
  return C;
}
function rmaRate(r) { const svc = rmaC('chargeSvc'), cr = ctrRate(r.client, svc); return cr && +cr.rate ? { rate: +cr.rate, src: 'contract rate' } : { rate: +svcBy(svc).rate || 0, src: 'standard rate' }; }
function rmaCharge(r, phase, units, lines, at) {
  if (!rmaY('charge') || (rmaC('chargeAt') || 'receipt') !== phase) return [];
  const svc = rmaC('chargeSvc'), basis = rmaC('chargeBasis'), { rate, src } = rmaRate(r), q = basis === 'unit' ? units : basis === 'line' ? lines : (r.charges.length ? 0 : 1);
  if (!q || !rate) return [];
  const c = { id: seqNo('CHG', 'CHG-', 5), at, client: r.client, type: 'Returns handling', svc, ref: r.id, qty: q, rate, amount: Math.round(q * rate * 100) / 100, note: (basis === 'unit' ? 'per unit' : basis === 'line' ? 'per line' : 'per RMA') + ' · ' + src, invoice: '' };
  DB.charges.push(c); r.charges.push(c.id); return [c.id];
}
function rmaTryClose(r, auto) {
  if (!r || r.status !== 'Received' || (auto && !rmaY('autoClose'))) return false;
  if (rmaTasks(r).some(t => t.status === 'Open') || r.lines.some(rmaOut)) return false;
  if (rmaTot(r, 'hold') + rmaTot(r, 'dmg') && rmaY('holdOwner') && !(r.holdAct && r.holdOwner)) return false;
  if (rmaTot(r, 'disp') && rmaY('dispCert') && !r.dispCert) return false;
  rmaCharge(r, 'close', rmaTot(r, 'recv'), r.lines.filter(l => l.recv > 0).length, iso(today));
  r.status = 'Closed'; r.closed = iso(today); ibAudit(r, auto ? 'Closed automatically: everything received and put away' : 'Closed'); return true;
}
const rmaAutoAll = () => { let n = 0; DB.returns.forEach(r => { if (rmaTryClose(r, true)) n++; }); if (n) { persist(); route(); } return n; };

/* ---- working state of the open RMA document ---- */
let rmaD = null, rmaRv = {};
window.addEventListener('hashchange', () => { rmaD = null; rmaRv = {}; });
function rmaBlank(oid) { const o = oid && DB.orders.find(x => x.id === oid), cl = o ? o.client : ((DB.customers.find(c => rmaOrders(c.id).length) || DB.customers[0] || {}).id || '');
  return { client: cl, order: o ? o.id : '', wh: o ? o.wh : '', reason: RMA_REASONS[0], reasonNote: '', cref: '', expected: iso(addDays(today, 1)), collect: 'Customer delivers', contact: '', mobile: '', attach: '', notes: '', lateRef: '', q: {}, lr: {} }; }
function rmaFromRec(r) { const d = { ...rmaBlank(), ...JSON.parse(JSON.stringify(r)), q: {}, lr: {} }; r.lines.forEach(l => { d.q[l.sku + '|' + (l.batch || '')] = l.ret; d.lr[l.sku + '|' + (l.batch || '')] = l.lreason || ''; }); return d; }
function rmaRead1() { const f = $('#rmaF1'), d = rmaD; if (!f || !d) return d;
  ['client', 'order', 'wh', 'reason', 'reasonNote', 'cref', 'expected', 'collect', 'contact', 'mobile', 'attach', 'notes', 'lateRef'].forEach(k => { const x = f.querySelector(`[name="${k}"]`); if (x && !x.disabled && !x.readOnly) d[k] = x.value.trim(); });
  f.querySelectorAll('.rm-q').forEach(x => { if (!x.disabled) d.q[x.dataset.k] = x.value; }); f.querySelectorAll('.rm-lr').forEach(x => { if (!x.disabled) d.lr[x.dataset.k] = x.value; }); return d; }

/* ---- shared pieces ---- */
const rmaFlow = cur => `<div class="rm-flow">${[['1', 'RMA Request', 'Order, lines, reason, approval', 'rmareq'], ['2', 'Receive & Inspect', 'Count and split each line', 'rmarecv'], ['3', 'Reconcile & Close', 'Put-away, follow-up, charge', 'rmaclose']].map((x, i) => `${i ? '<i aria-hidden="true">→</i>' : ''}<a class="rm-fb ${cur === i ? 'on' : ''}" href="#${x[3]}"><b>${x[0]}</b><span><strong>${x[1]}</strong>${x[2]}</span></a>`).join('')}</div>`;
const rmaCols = (x = []) => [['RMA', r => `<b class="mono">${esc(r.id)}</b>${r.cref ? `<br><span class="note">${esc(r.cref)}</span>` : ''}`], ['Customer', r => esc(clName(r.client))], ['Order', r => `<span class="mono">${esc(r.order)}</span>`], ['Warehouse', r => esc(whRec(r.wh).name)], ['Reason', r => esc(r.reason)], ['Expected', r => r.expected ? fmtDate(r.expected) : '—'],
  ['Progress', r => { const a = rmaTot(r, 'ret'), b = rmaTot(r, 'recv'), p = a ? Math.round(b / a * 100) : 0; return `<div class="rm-prog"><em><u style="width:${p}%"></u></em><span>${n0(b)} / ${n0(a)}</span></div>`; }], ['Status', r => pill(r.status)], ...x];
const rmaActBtn = r => { const n = rmaNext(r); return `<a class="btn sm ${n[2] || ''}" href="${rmaHref(r)}">${n[0]}</a>`; };
const rmaHeadActs = () => `<button type="button" class="btn" data-do="rmaSettings">Settings</button><a class="btn pri" href="#rma/new">+ New RMA</a>`;
const rmaSearch = { q: (r, v) => (r.id + ' ' + r.order + ' ' + (r.cref || '') + ' ' + r.lines.map(l => l.sku).join(' ')).toLowerCase().includes(v.toLowerCase()) };

function rmaDash() {
  const c = st => DB.returns.filter(r => st.includes(r.status)).length, all = DB.returns.slice().reverse(), rows = applyFilt('rma', all, rmaSearch);
  const K = [['Drafts', 'Draft'], ['Waiting for approval', 'Requested'], ['Waiting for goods', 'Approved'], ['Receiving (partial)', 'Receiving'], ['To reconcile', 'Received'], ['Closed', 'Closed']];
  const f = (FILT.rma || {}).status;
  return head2('Returns (RMA)', 'Returns dashboard', rmaHeadActs()) + rmaFlow(-1)
    + `<div class="grid g-kpi">${K.map(([t, s]) => `<button type="button" class="card kpi rm-kpi ${f === s ? 'on' : ''}" data-do="rmaKpi" data-id="${s}"><span>${t}</span><b>${c([s])}</b></button>`).join('')}</div>`
    + filterBar('rma', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(RMA_ST) }, { id: 'q', type: 'text', label: 'Search RMA, order, SKU' }])
    + card(`${rows.length} returns`, tbl(rmaCols([['', rmaActBtn]]), rows, r => rmaHref(r), all.length ? 'No returns match the filters.' : 'No returns yet. Click + New RMA.'))
    + `<p class="note">A return starts from a dispatched order, so the customer can only return what they received, by batch. Approved goods are received at the returns dock (bin RET-01), inspected and split into good, hold, damaged and dispose.</p>`;
}
function rmaQueue(step) {
  const [title, sts] = [['RMA Request', ['Draft', 'Requested', 'Approved', 'Rejected', 'Cancelled']], ['Receive & Inspect', ['Approved', 'Receiving']], ['Reconcile & Close', ['Receiving', 'Received', 'Closed']]][step], key = 'rmq' + step;
  const all = DB.returns.filter(r => sts.includes(r.status)).slice().reverse(), rows = applyFilt(key, all, rmaSearch), s = step + 1;
  return head2('Returns (RMA)', title, rmaHeadActs()) + rmaFlow(step)
    + filterBar(key, [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(sts) }, { id: 'q', type: 'text', label: 'Search RMA, order, SKU' }])
    + card(`${rows.length} returns`, tbl(rmaCols([['', r => `<a class="btn sm ${['Requested', 'Approved', 'Receiving', 'Received'].includes(r.status) && rmaNext(r)[1] === s ? 'pri' : ''}" href="${rmaHref(r, s)}">${step === 1 ? 'Receive' : 'Open'}</a>`]]), rows, r => rmaHref(r, s), 'Nothing here.'));
}

function rmaSide(r, d) {
  const C = rmaChecks(r, d), x = r || d, o = DB.orders.find(y => y.id === x.order);
  const R = (k, v) => `<div class="rm-row"><span>${k}</span><b>${v}</b></div>`;
  const tot = r ? R('Authorised', n0(rmaTot(r, 'ret'))) + R('Received', n0(rmaTot(r, 'recv'))) + R('Good · restock', `<span style="color:var(--good)">${n0(rmaTot(r, 'good'))}</span>`) + R('Hold', `<span style="color:var(--warn)">${n0(rmaTot(r, 'hold'))}</span>`) + R('Damaged', `<span style="color:var(--bad)">${n0(rmaTot(r, 'dmg'))}</span>`) + R('Disposed', n0(rmaTot(r, 'disp')))
    : R('Lines', Object.values(d.q || {}).filter(v => +v > 0).length) + R('Return qty', n0(sum(Object.values(d.q || {}), v => +v || 0)));
  return `<aside class="rm-side"><section class="card"><div class="card-h"><h2>Summary</h2></div><div class="card-b">${R('Customer', esc(clName(x.client)) || '—')}${R('Order', `<span class="mono">${esc(x.order || '—')}</span>`)}${o && o.dn ? R('Delivery note', `<span class="mono">${esc(o.dn)}</span>`) : ''}${R('Warehouse', esc(x.wh ? whRec(x.wh).name : '—'))}${R('Status', pill(r ? r.status : 'New'))}<div class="rm-tot">${tot}</div></div></section>
    <section class="card"><div class="card-h"><h2>Rule checks</h2></div><ul class="rm-checks">${C.map(c => `<li class="${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}"><i aria-hidden="true">${c.ok ? '✓' : c.warn ? '!' : '✕'}</i><span>${esc(c.t)}</span></li>`).join('')}</ul></section>
    ${r ? `<section class="card"><div class="card-h"><h2>Activity</h2></div><ul class="rm-tl">${(r.audit || []).slice().reverse().slice(0, 8).map(h => `<li><b>${esc(h.action)}</b><span>${fmtDate(String(h.at).slice(0, 10))} ${String(h.at).slice(11, 16)} · ${esc(h.by)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="card"><div class="card-b"><p class="note" style="margin:0 0 8px">Approval ${rmaY('approve') ? 'on' : 'off'} · window ${rmaC('window') || 0} days · charge ${rmaY('charge') ? esc(rmaC('chargeSvc')) + ' ' + (rmaC('chargeAt') === 'close' ? 'on closing' : 'on receipt') : 'off'}</p><button type="button" class="btn sm" data-do="rmaSettings">Returns settings</button></div></section></aside>`;
}

/* ---- step 1: RMA request ---- */
function rmaStep1(r) {
  const ed = !r || r.status === 'Draft', d = rmaD, os = d.client ? rmaOrders(d.client) : [], o = d.order && DB.orders.find(x => x.id === d.order), win = +rmaC('window') || 0, age = o ? rmaAge(o) : 0, late = !!(o && win && age > win);
  const L = o ? rmaShip(o, r && r.id) : [], whs = DB.warehouses.filter(w => w.status !== 'Inactive' && (!o || w.loc === whRec(o.wh).loc)), dis = ed ? '' : 'disabled';
  const S = (n, list, v, ph) => `<select name="${n}" ${dis}>${ph != null ? `<option value="">${esc(ph)}</option>` : ''}${opt(list.map(([a, b]) => [String(a), b]), String(v ?? ''))}</select>`;
  const I = (n, v, x = {}) => `<input name="${n}" type="${x.type || 'text'}" value="${esc(v ?? '')}" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} ${ed ? '' : 'readonly'} autocomplete="off">`;
  const lines = o ? `<div class="tbl-wrap"><table class="rm-t"><thead><tr><th>#</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="num">Shipped</th><th class="num">Already returned</th><th class="num">Can return</th><th class="num">Return qty</th><th>Line reason</th></tr></thead><tbody>
    ${L.map((g, i) => { const k = g.sku + '|' + g.batch, can = g.shipped - g.prev, v = d.q[k]; return `<tr class="${+v > 0 ? 'on' : ''}"><td>${i + 1}</td><td>${itemCell(g.sku)}</td><td class="mono">${esc(g.batch || '—')}</td><td>${g.expiry ? fmtDate(g.expiry) : '—'}</td><td class="num">${n0(g.shipped)}</td><td class="num">${n0(g.prev)}</td><td class="num"><b>${n0(can)}</b></td>
      <td class="num"><input class="rm-q" type="number" min="0" max="${can}" data-k="${esc(k)}" value="${v == null || v === '' ? '' : esc(v)}" ${can > 0 && ed ? '' : 'disabled'} placeholder="0" aria-label="Return quantity, line ${i + 1}"></td>
      <td><select class="rm-lr" data-k="${esc(k)}" ${dis} aria-label="Line reason"><option value="">Same as header</option>${opt(optA(RMA_REASONS), d.lr[k] || '')}</select></td></tr>`; }).join('')}</tbody></table></div>
    ${ed ? `<div class="card-b rm-quick"><button type="button" class="btn sm" data-do="rmaAll">Return everything</button><button type="button" class="btn sm" data-do="rmaClear">Clear</button><span class="note">Lines come from what was shipped on the order, with batch and expiry.</span></div>` : ''}`
    : '<div class="empty">Choose the customer and the original order. The shipped lines appear here.</div>';
  const body = `<form id="rmaF1" onsubmit="return false">
    ${ibSec2('A · Customer &amp; source', `<div class="card-b fgrid f3">
      ${fld('Customer', S('client', DB.customers.map(c => [c.id, c.name]), d.client), 1)}
      ${fld('Original order / delivery note', S('order', os.map(x => [x.id, `${x.id}${x.dn ? ' · ' + x.dn : ''} · ${x.customer || ''} · ${fmtDate(String(x.dispatchedAt || '').slice(0, 10))}`]), d.order, os.length ? 'Choose the order…' : 'No dispatched orders'), 1, 'span2')}
      ${ibRO2('Consignee', o ? o.customer || '' : '')}${ibRO2('Dispatched', o ? fmtDate(String(o.dispatchedAt || '').slice(0, 10)) + ' · ' + o.status : '')}
      ${fld('Days since dispatch', `<div class="rm-ro">${o ? `<b>${age}</b> day${age === 1 ? '' : 's'}${win ? ` <span class="pill p-${late ? 'bad' : 'good'}">${late ? 'Outside' : 'Within'} ${win}-day window</span>` : ''}` : '—'}</div>`)}
      ${fld('Return warehouse', S('wh', whs.map(w => [w.id, w.name]), d.wh || (o && o.wh)), 1)}${ibRO2('Return bin', 'RET-01 · returns dock')}
      ${late && !rmaY('block') && rmaY('lateRef') ? fld('Late return approval ref.', I('lateRef', d.lateRef, { ph: 'Customer approval for late return' }), 1) : ''}
    </div>${late ? `<div class="card-b"><div class="${rmaY('block') ? 'err' : 'warnbox'}">${rmaY('block') ? 'The return window has passed. Returns are blocked in Returns settings.' : 'The return window has passed. Allowed by settings' + (rmaY('lateRef') ? ' with an approval reference.' : '.')}</div></div>` : ''}`)}
    ${ibSec2('B · Return details', `<div class="card-b fgrid f3">
      ${fld('Return reason', S('reason', optA(RMA_REASONS), d.reason), 1)}${fld('Reason details', I('reasonNote', d.reasonNote, { ph: 'e.g. cartons crushed on delivery' }), 0, 'span2')}
      ${fld('Customer ref. / authorisation', I('cref', d.cref, { ph: 'Email, PO or customer RMA no.' }), rmaY('reqAuth'))}${fld('Expected arrival', I('expected', d.expected, { type: 'date' }), rmaY('reqExpected'))}
      ${fld('Collection', S('collect', optA(['Customer delivers', 'Gray Lane collects']), d.collect))}
      ${fld('Contact name', I('contact', d.contact, { ph: 'Customer / consignee contact' }), rmaY('reqContact'))}${fld('Contact mobile', I('mobile', d.mobile, { ph: '+966 5x xxx xxxx' }), rmaY('reqContact'))}${fld('Attachment ref.', I('attach', d.attach, { ph: 'Photo / email reference' }))}
    </div>`)}
    ${ibSec2('C · Return lines', lines)}
    ${ibSec2('D · Notes', `<div class="card-b">${fld('Notes for the warehouse', `<textarea name="notes" rows="2" ${ed ? '' : 'readonly'} placeholder="Optional">${esc(d.notes || '')}</textarea>`)}</div>`)}
    <div class="err" id="rmaErr" role="alert"></div></form>`;
  let B = [];
  if (ed) B = [r && ['Delete draft', 'rmaDel|' + r.id, 'danger'], ['Cancel', 'rmaBack'], ['Save draft', 'rmaSave|draft'], [rmaY('approve') ? 'Submit for approval' : 'Submit &amp; approve', 'rmaSave|submit', 'pri']];
  else if (r.status === 'Requested') B = [['Return for correction', 'rmaCorrect|' + r.id], ['Reject', 'rmaReject|' + r.id, 'danger'], ['Approve RMA', 'rmaApprove|' + r.id, 'pri']];
  else if (r.status === 'Approved') B = [['Cancel RMA', 'rmaCancel|' + r.id, 'danger'], ['Go to Receive &amp; Inspect →', 'rmaGo|2', 'pri']];
  else if (['Receiving', 'Received', 'Closed'].includes(r.status)) B = [['Next step →', 'rmaGo|' + (r.status === 'Receiving' ? 2 : 3), 'pri']];
  return body + ibFoot(B);
}

/* ---- step 2: receive & inspect ---- */
function rmaStep2(r) {
  const ok = ['Approved', 'Receiving'].includes(r.status), def = rmaC('decision') || 'good', cold = r.lines.some(l => rmaCold(l.sku)), n = r.receipts.length + 1, V = (k, dv) => rmaRv[k] != null ? rmaRv[k] : dv;
  const I = (nm, v, x = {}) => `<input name="${nm}" type="${x.type || 'text'}" value="${esc(v ?? '')}" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} ${x.step ? `step="${x.step}"` : ''} autocomplete="off">`;
  let body = '';
  if (ok) body += `<form id="rmaF2" onsubmit="return false">
    ${ibSec2('A · Receipt details', `<div class="card-b fgrid f3">
      ${ibRO2('Receipt no.', r.id.replace(/^RMA/, 'RR') + '-' + n)}${fld('Received date', I('at', V('at', iso(today)), { type: 'date' }), 1)}${fld('Received time', I('time', V('time', new Date().toTimeString().slice(0, 5)), { type: 'time' }))}
      ${fld('Received by', `<select name="by">${opt(rmaUsers(), V('by', DATA.user.name))}</select>`, 1)}${ibRO2('Return bin', 'RET-01 · ' + whRec(r.wh).name)}
      ${fld('Vehicle no.', I('vehicle', V('vehicle', ''), { ph: 'ABC 1234' }), rmaY('reqVehicle'))}${fld('Driver name', I('driver', V('driver', ''), { ph: 'Driver' }), rmaY('reqVehicle'))}${fld('Driver mobile', I('dmobile', V('dmobile', ''), { ph: '+966 5x xxx xxxx' }))}${fld('Seal no.', I('seal', V('seal', ''), { ph: 'Optional' }))}
      ${cold ? fld('Truck temperature °C', I('ttemp', V('ttemp', ''), { type: 'number', step: '0.1', ph: 'On arrival' }), rmaY('reqTemp')) : ''}
      ${fld('Photo / evidence ref.', I('evidence', V('evidence', ''), { ph: 'Photo no., file name' }), rmaY('reqEvidence'), cold ? '' : 'span2')}
    </div>`)}
    ${ibSec2('B · Count &amp; inspect · per line', `<div class="tbl-wrap"><table class="rm-t rm-recv"><thead><tr><th>Item</th><th class="num">Authorised</th><th class="num">Received before</th><th class="num">Outstanding</th><th class="num">Received now</th><th class="num g">Good · restock</th><th class="num h">Hold</th><th class="num d">Damaged</th><th class="num x">Dispose</th><th>Batch</th><th>Expiry</th><th>Temp °C</th><th>Condition</th><th>Note</th><th></th></tr></thead><tbody>
      ${r.lines.map((l, i) => { const it = item(l.sku), cl = rmaCold(l.sku), out = rmaOut(l), off = out ? '' : 'disabled', rc = V('recv_' + i, out), dv = k => V(k + '_' + i, def === k ? rc : 0);
        return `<tr data-i="${i}" class="${out ? '' : 'done'}"><td>${itemCell(l.sku)}${it.temp && it.temp !== 'Ambient' ? `<br><span class="pill p-info">${esc(it.temp)}</span>` : ''}</td><td class="num">${n0(l.ret)}</td><td class="num">${n0(l.recv || 0)}</td><td class="num"><b>${n0(out)}</b></td>
        <td class="num"><input type="number" min="0" max="${out}" name="recv_${i}" value="${esc(rc)}" ${off} aria-label="Received now"></td>
        ${['good', 'hold', 'dmg', 'disp'].map(k => `<td class="num ${{ good: 'g', hold: 'h', dmg: 'd', disp: 'x' }[k]}"><input type="number" min="0" name="${k}_${i}" value="${esc(dv(k))}" ${off} aria-label="${k}"></td>`).join('')}
        <td><input name="batch_${i}" value="${esc(V('batch_' + i, l.batch || ''))}" class="mono" style="width:96px" ${off} aria-label="Batch"></td><td><input type="date" name="exp_${i}" value="${esc(V('exp_' + i, l.expiry || ''))}" style="width:136px" ${off} aria-label="Expiry"></td>
        <td><input type="number" step="0.1" name="temp_${i}" value="${esc(V('temp_' + i, ''))}" placeholder="${cl ? 'Required' : '—'}" ${cl && out ? '' : 'disabled'} style="width:70px" aria-label="Temperature"></td>
        <td><select name="cond_${i}" ${off} aria-label="Condition">${opt(optA(RMA_COND), V('cond_' + i, 'Good'))}</select></td>
        <td><input name="note_${i}" value="${esc(V('note_' + i, ''))}" placeholder="e.g. carton torn" style="width:140px" ${off} aria-label="Note"></td><td class="rm-chk" id="rmChk_${i}"></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="card-b rm-quick"><button type="button" class="btn sm" data-do="rmaFill" data-id="good">All good</button><button type="button" class="btn sm" data-do="rmaFill" data-id="hold">All hold</button><button type="button" class="btn sm" data-do="rmaFill" data-id="zero">Clear</button><span class="note">Good + Hold + Damaged + Dispose must equal Received now on every line.</span></div>
      <div class="card-b rm-legend"><span class="g">Good</span> creates an LPN in RET-01 and a put-away task · <span class="h">Hold</span> goes to QA-HOLD for the customer's decision · <span class="d">Damaged</span> is kept as damaged stock · <span class="x">Dispose</span> is written off${rmaY('dispCert') ? ' (certificate needed at closing)' : ''}.</div>`)}
    <div class="err" id="rmaErr" role="alert"></div></form>`;
  else body += `<div class="card card-b">${r.status === 'Closed' ? 'This RMA is closed.' : 'All goods for this RMA are received.'} Receipts are listed below.</div>`;
  if (r.receipts.length) body += ibSec2(`${ok ? 'C' : 'A'} · Receipts (${r.receipts.length})`, r.receipts.slice().reverse().map(x => `<div class="rm-rc"><div class="rm-rch"><b class="mono">${esc(x.no)}</b><span class="note">${fmtDate(x.at)}${x.time ? ' ' + esc(x.time) : ''} · ${esc(x.by || '')}${x.vehicle ? ' · ' + esc(x.vehicle) : ''}${x.driver ? ' · ' + esc(x.driver) : ''}${x.seal ? ' · seal ' + esc(x.seal) : ''}${x.ttemp !== '' && x.ttemp != null ? ' · ' + esc(x.ttemp) + ' °C' : ''}</span><button type="button" class="btn sm" data-do="rmaPrintRr" data-id="${esc(r.id + '|' + x.no)}">Print receipt</button></div>
    ${tbl([['Item', y => itemCell(r.lines[y.i].sku)], ['Received', y => `<b>${n0(y.recv)}</b>`, 1], ['Good', y => y.good || '—', 1], ['Hold', y => y.hold || '—', 1], ['Damaged', y => y.dmg || '—', 1], ['Dispose', y => y.disp || '—', 1], ['Batch / expiry', y => `<span class="mono">${esc(y.batch || '—')}</span>${y.expiry ? '<br><span class="note">' + fmtDate(y.expiry) + '</span>' : ''}`], ['Condition', y => esc(y.cond || '') + (y.note ? '<br><span class="note">' + esc(y.note) + '</span>' : '') + (y.temp ? '<br><span class="note">' + esc(y.temp) + ' °C</span>' : '')], ['LPNs', y => (y.lpns || []).map(p => `<a class="mono" href="#" data-do="invLpn" data-id="${esc(p)}">${esc(p)}</a>`).join('<br>') || '—']], x.lines.filter(y => y.recv), null, '')}</div>`).join(''));
  setTimeout(rmaRecvCheck, 0);
  return body + ibFoot(ok ? [['← RMA Request', 'rmaGo|1'], ['Confirm receipt', 'rmaReceive|' + r.id, 'pri']] : [['← RMA Request', 'rmaGo|1'], ['Go to Reconcile &amp; Close →', 'rmaGo|3', 'pri']]);
}
function rmaRecvCheck() { const f = $('#rmaF2'); if (!f) return; f.querySelectorAll('tr[data-i]').forEach(tr => { const i = tr.dataset.i, g = k => +(f.querySelector(`[name=${k}_${i}]`) || {}).value || 0, rc = g('recv'), s = g('good') + g('hold') + g('dmg') + g('disp'), c = $('#rmChk_' + i); if (!c) return;
  c.innerHTML = (f.querySelector(`[name=recv_${i}]`) || {}).disabled ? '<span style="color:var(--good)">✓ Done</span>' : s === rc ? '<span style="color:var(--good)" title="Split matches">✓</span>' : `<span style="color:var(--bad)" title="Split ${s} ≠ received ${rc}">${s}≠${rc}</span>`; }); }

/* ---- step 3: reconcile & close ---- */
function rmaStep3(r) {
  const ed = ['Receiving', 'Received'].includes(r.status), tasks = rmaTasks(r), short = sum(r.lines, rmaOut), hd = rmaTot(r, 'hold') + rmaTot(r, 'dmg'), dp = rmaTot(r, 'disp');
  const lp = r.receipts.flatMap(x => x.lines.flatMap(y => y.lpns || [])), stk = lp.map(id => lpnBy(id) || { lpn: id, closed: 1 }), ch = DB.charges.filter(c => c.ref === r.id);
  const basis = rmaC('chargeBasis'), pq = basis === 'unit' ? rmaTot(r, 'recv') : basis === 'line' ? r.lines.filter(l => l.recv > 0).length : 1, rt = rmaRate(r);
  const prev = rmaY('charge') && rmaC('chargeAt') === 'close' && r.status !== 'Closed' && rt.rate ? `<tr class="rm-prev"><td>Preview · on closing</td><td>${esc(svcBy(rmaC('chargeSvc')).name || '')}</td><td class="num">${n0(pq)}</td><td class="num">${sar(rt.rate)}</td><td class="num">${sar(pq * rt.rate)}</td><td>${esc(rt.src)}</td></tr>` : '';
  const D = (v, c) => v ? `<span style="color:var(--${c})">${n0(v)}</span>` : '—';
  let body = ibSec2('A · Reconciliation', `<div class="tbl-wrap"><table class="rm-t"><thead><tr><th>Item</th><th>Batch</th><th class="num">Authorised</th><th class="num">Received</th><th class="num">Short</th><th class="num">Good</th><th class="num">Hold</th><th class="num">Damaged</th><th class="num">Disposed</th><th>Result</th></tr></thead><tbody>
    ${r.lines.map(l => { const s = rmaOut(l); return `<tr><td>${itemCell(l.sku)}</td><td class="mono">${esc(l.batch || '—')}</td><td class="num">${n0(l.ret)}</td><td class="num"><b>${n0(l.recv || 0)}</b></td><td class="num">${D(s, 'bad')}</td><td class="num">${D(l.good, 'good')}</td><td class="num">${D(l.hold, 'warn')}</td><td class="num">${D(l.dmg, 'bad')}</td><td class="num">${l.disp ? n0(l.disp) : '—'}</td><td>${s ? '<span class="pill p-warn">Short</span>' : pill('Matched')}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="num">${n0(rmaTot(r, 'ret'))}</td><td class="num">${n0(rmaTot(r, 'recv'))}</td><td class="num">${short || '—'}</td><td class="num">${n0(rmaTot(r, 'good'))}</td><td class="num">${n0(rmaTot(r, 'hold'))}</td><td class="num">${n0(rmaTot(r, 'dmg'))}</td><td class="num">${n0(dp)}</td><td></td></tr></tfoot></table></div>`)
    + ibSec2('B · Put-away of restocked goods', tbl([['Task', t => `<span class="mono">${esc(t.id)}</span>`], ['LPN', t => `<a class="mono" href="#" data-do="invLpn" data-id="${esc(t.lpn)}">${esc(t.lpn)}</a>`], ['Item', t => { const s = lpnBy(t.lpn); return s ? itemCell(s.sku) : '—'; }], ['From', t => `<span class="mono">${esc(t.from || 'RET-01')}</span>`], ['To bin', t => `<span class="mono">${esc(t.to || '—')}</span>`], ['Status', t => pill(t.status)],
      ['', t => t.status === 'Open' ? `<button type="button" class="btn sm pri" data-do="putLoose" data-id="${esc(t.id)}">Confirm put-away</button>` : (t.done ? fmtDate(t.done) : '')]], tasks, null, 'No goods to put away.'))
    + ibSec2('C · Stock created', tbl([['LPN', s => s.closed ? `<span class="mono">${esc(s.lpn)}</span>` : `<a class="mono" href="#" data-do="invLpn" data-id="${esc(s.lpn)}">${esc(s.lpn)}</a>`], ['Item', s => s.sku ? itemCell(s.sku) : '<span class="note">Pallet no longer in stock</span>'], ['Bin', s => `<span class="mono">${esc(s.bin || '—')}</span>`], ['Qty', s => s.qty != null ? n0(s.qty) : '—', 1], ['Status', s => pill(s.closed ? 'Closed' : s.status)]], stk, null, 'No stock created yet.'))
    + ibSec2('D · Charges', ch.length || prev ? `<div class="tbl-wrap"><table><thead><tr><th>Charge</th><th>Service</th><th class="num">Qty</th><th class="num">Rate, SAR</th><th class="num">Amount, SAR</th><th>Note / invoice</th></tr></thead><tbody>${ch.map(c => `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.type)} <span class="note mono">${esc(c.svc)}</span></td><td class="num">${n0(c.qty)}</td><td class="num">${sar(c.rate)}</td><td class="num"><b>${sar(c.amount)}</b></td><td>${esc(c.note)} · ${c.invoice ? esc(c.invoice) : 'unbilled'}</td></tr>`).join('')}${prev}</tbody></table></div>`
      : `<div class="empty">${rmaY('charge') ? 'No charge yet. It is raised ' + (rmaC('chargeAt') === 'close' ? 'when the RMA is closed.' : 'on receipt.') : 'Returns charging is switched off in Returns settings.'}</div>`);
  if (ed || r.status === 'Closed') { const dis = ed ? '' : 'disabled', ro = ed ? '' : 'readonly', I = (n, v, x = {}) => `<input name="${n}" type="${x.type || 'text'}" value="${esc(v ?? '')}" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} ${ro} autocomplete="off">`, S = (n, list, v, ph) => `<select name="${n}" ${dis}>${ph ? `<option value="">${ph}</option>` : ''}${opt(list, v || '')}</select>`;
    body += `<form id="rmaF3" onsubmit="return false">${ibSec2('E · Closure', `<div class="card-b fgrid f3">
      ${short ? fld('Short quantity treatment', S('shortMode', [['open', 'Keep open — more goods to come'], ['close', 'Close short — approved']], r.shortMode || 'open'), 0, 'span2') + fld('Short closure approval ref.', I('shortRef', r.shortRef, { ph: 'Customer / manager approval' }), rmaY('shortRef')) : ''}
      ${hd ? fld('Hold / damaged decision', S('holdAct', optA(RMA_HOLD_ACT), r.holdAct, 'Choose…'), rmaY('holdOwner')) + fld('Responsible person', S('holdOwner', rmaUsers(), r.holdOwner, 'Choose…'), rmaY('holdOwner')) + fld('Follow-up case ref.', I('caseRef', r.caseRef, { ph: 'Claim / case no.' })) : ''}
      ${dp ? fld('Disposal certificate ref.', I('dispCert', r.dispCert, { ph: 'Certificate no.' }), rmaY('dispCert')) + fld('Disposal date', I('dispDate', r.dispDate || iso(today), { type: 'date' })) : ''}
      <div style="grid-column:1/-1">${fld('Closing notes', `<textarea name="closeNote" rows="2" ${ro} placeholder="Optional">${esc(r.closeNote || '')}</textarea>`)}</div>
    </div>${!short && !hd && !dp ? '<p class="note card-b" style="margin:0">Everything was received in good condition. Nothing else is needed to close.</p>' : ''}`)}<div class="err" id="rmaErr" role="alert"></div></form>`; }
  return body + ibFoot([['← Receive &amp; Inspect', 'rmaGo|2'], ed && ['Save · keep open', 'rmaClose|save'], ed && ['Close RMA' + (rmaY('charge') && rmaC('chargeAt') === 'close' ? ' &amp; charge' : ''), 'rmaClose|close', 'pri']]);
}

function rmaDoc(mode, id) {
  const step = mode === 'new' ? 1 : +String(mode).slice(1) || 1, r = mode === 'new' ? null : rmaR(id);
  CUR = { mod: 'returns', sub: ['rmareq', 'rmarecv', 'rmaclose'][step - 1] };
  if (mode !== 'new' && !r) return head2('Returns (RMA)', 'RMA not found', '<a class="btn" href="#returns">← Returns</a>') + '<div class="card empty">This return no longer exists.</div>';
  if (!rmaStepOk(r, step - 1)) { setTimeout(() => go(rmaHref(r, 1)), 0); return ''; }
  const key = mode === 'new' ? 'new:' + (id || '') : r.id; if (!rmaD || rmaD.key !== key) { rmaD = r ? rmaFromRec(r) : rmaBlank(id); rmaD.key = key; }
  const body = step === 1 ? rmaStep1(r) : step === 2 ? rmaStep2(r) : rmaStep3(r);
  const tabs = ['RMA Request', 'Receive & Inspect', 'Reconcile & Close'].map((t, i) => { const okk = rmaStepOk(r, i), dn = r && ((i === 0 && !['Draft', 'Requested'].includes(r.status)) || (i === 1 && ['Received', 'Closed'].includes(r.status)) || (i === 2 && r.status === 'Closed'));
    const inner = `<b>${dn ? '✓' : i + 1}</b><span><strong>${t}</strong><em>${!okk ? 'Locked' : dn ? 'Done' : step === i + 1 ? 'Current' : 'Open'}</em></span>`;
    return okk && r && step !== i + 1 ? `<a class="rm-step ${dn ? 'done' : ''}" href="${rmaHref(r, i + 1)}">${inner}</a>` : `<span class="rm-step ${step === i + 1 ? 'on' : ''} ${dn ? 'done' : ''} ${okk ? '' : 'off'}">${inner}</span>`; }).join('');
  const hdr = r ? `<div class="rm-hd card card-b"><div><div class="row" style="gap:6px;flex-wrap:wrap">${pill(r.status)}<span class="pill p-mute">${esc(r.reason)}</span>${r.cref ? `<span class="pill p-mute">Ref. ${esc(r.cref)}</span>` : ''}<span class="pill p-mute">Created ${fmtDate(r.created)}</span></div></div><div class="rm-cust"><span>Customer</span><b>${esc(clName(r.client))}</b><span>Order <span class="mono">${esc(r.order)}</span></span></div></div>` : '';
  return head2('<a href="#returns" style="color:inherit">Returns (RMA)</a>', r ? 'Return ' + esc(r.id) : 'New RMA request', '<a class="btn" href="#returns">← Back to returns</a>')
    + hdr + `<div class="rm-steps">${tabs}</div><div class="rm-doc"><div class="rm-main">${body}</div>${rmaSide(r, rmaD)}</div>`;
}
function rmaShow(page, mode, id) {
  if (page === 'rma') return rmaDoc(mode || 'new', id);
  CUR = { mod: 'returns', sub: page };
  if (mode === 'new') { setTimeout(() => go('#rma/new'), 0); return ''; }
  return page === 'returns' ? rmaDash() : rmaQueue(['rmareq', 'rmarecv', 'rmaclose'].indexOf(page));
}

/* ---- form events ---- */
document.addEventListener('input', e => { const t = e.target;
  if (t.closest && t.closest('#rmaF1')) rmaRead1();
  const f = t.closest && t.closest('#rmaF2'); if (!f) return; rmaRv[t.name] = t.value;
  const m = /^(recv|hold|dmg|disp)_(\d+)$/.exec(t.name); if (m) { const i = m[2], rc = +f.querySelector(`[name=recv_${i}]`).value || 0, others = ['hold', 'dmg', 'disp'].reduce((s, k) => s + (+f.querySelector(`[name=${k}_${i}]`).value || 0), 0), g = f.querySelector(`[name=good_${i}]`); g.value = Math.max(0, rc - others); rmaRv['good_' + i] = g.value; }
  rmaRecvCheck(); });
document.addEventListener('change', e => { const t = e.target;
  if (t.closest && t.closest('#rmaF2')) rmaRv[t.name] = t.value;
  if (!(t.closest && t.closest('#rmaF1'))) return; rmaRead1(); const d = rmaD;
  if (t.name === 'client') { d.order = ''; d.wh = ''; d.q = {}; d.lr = {}; }
  if (t.name === 'order') { const o = DB.orders.find(x => x.id === d.order); d.q = {}; d.lr = {}; d.wh = o ? o.wh : ''; }
  if (['client', 'order', 'wh'].includes(t.name)) route(); });

/* ---- actions ---- */
const rmaBox = e => { const b = $('#rmaErr'); if (b) { b.textContent = e.message; b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } toast(e.message); };
const rmaCurR = () => rmaD && rmaD.key && !String(rmaD.key).startsWith('new:') ? rmaR(rmaD.key) : null;
Object.assign(DO, {
  rmaKpi(s) { FILT.rma = { ...(FILT.rma || {}), status: (FILT.rma || {}).status === s ? '' : s }; route(); },
  rmaBack() { rmaD = null; go('#returns'); },
  rmaGo(s) { const r = rmaCurR(); if ($('#rmaF1')) rmaRead1(); if (r) go(rmaHref(r, +s)); },
  rmaAll() { const d = rmaRead1(), o = DB.orders.find(x => x.id === d.order); if (!o) return; rmaShip(o, rmaCurR() && rmaCurR().id).forEach(g => d.q[g.sku + '|' + g.batch] = g.shipped - g.prev); route(); },
  rmaClear() { const d = rmaRead1(); d.q = {}; route(); },
  rmaSave(mode) { try {
    const d = rmaRead1(), o = DB.orders.find(x => x.id === d.order), sub = mode === 'submit', ex = rmaCurR();
    if (!d.client) throw new Error('Choose the customer.'); if (!o) throw new Error('Choose the original order.'); if (!d.wh) throw new Error('Choose the return warehouse.');
    const lines = []; rmaShip(o, ex && ex.id).forEach(g => { const k = g.sku + '|' + g.batch, raw = d.q[k], q = raw === '' || raw == null ? 0 : +raw;
      if (!(q >= 0) || !Number.isInteger(q)) throw new Error(item(g.sku).name + ': enter the return quantity as a whole number.');
      if (q > g.shipped - g.prev) throw new Error(`${item(g.sku).name}${g.batch ? ' batch ' + g.batch : ''}: only ${g.shipped - g.prev} can be returned (shipped ${g.shipped}, already returned ${g.prev}).`);
      if (q > 0) lines.push({ sku: g.sku, batch: g.batch, expiry: g.expiry, ret: q, lreason: d.lr[k] || '', recv: 0, good: 0, hold: 0, dmg: 0, disp: 0, lpns: [], result: '' }); });
    if (sub) { const win = +rmaC('window') || 0, late = win && rmaAge(o) > win;
      if (late && rmaY('block')) throw new Error(`The return window (${win} days) has passed for ${o.id}. Returns are blocked in Returns settings.`);
      if (late && rmaY('lateRef') && !d.lateRef) throw new Error('Enter the approval reference for this late return.');
      if (!d.reason) throw new Error('Choose the return reason.'); if (rmaY('reqAuth') && !d.cref) throw new Error('Enter the customer authorisation reference.');
      if (rmaY('reqExpected') && !d.expected) throw new Error('Enter the expected arrival date.'); if (rmaY('reqContact') && (!d.contact || !d.mobile)) throw new Error('Enter the contact name and mobile.');
      if (d.mobile && !/^[+0-9 ()-]{7,}$/.test(d.mobile)) throw new Error('Contact mobile does not look like a phone number.');
      if (!lines.length) throw new Error('Enter the return quantity on at least one line.'); }
    const data = { order: o.id, client: o.client, wh: d.wh, loc: whRec(d.wh).loc, reason: d.reason, reasonNote: d.reasonNote, cref: d.cref, expected: d.expected, collect: d.collect, contact: d.contact, mobile: d.mobile, attach: d.attach, notes: d.notes, lateRef: d.lateRef, lines };
    let r = ex; if (!r) { r = { id: docNoL('RMA', whRec(d.wh).loc), created: iso(today), createdBy: DATA.user.name, audit: [], receipts: [], charges: [], ...data, status: 'Draft' }; DB.returns.push(r); ibAudit(r, 'Draft created'); } else Object.assign(r, data);
    if (sub) { r.status = rmaY('approve') ? 'Requested' : 'Approved'; if (r.status === 'Approved') { r.approvedBy = DATA.user.name + ' (auto)'; r.approvedAt = iso(today); }
      ibAudit(r, `Submitted: ${sum(lines, l => l.ret)} units on ${lines.length} line${lines.length === 1 ? '' : 's'}${r.status === 'Approved' ? ' · approval not required' : ' · waiting for approval'}`); } else ibAudit(r, 'Draft saved');
    persist(); rmaD = null; toast(r.id + (sub ? (r.status === 'Approved' ? ' approved. Receive the goods when they arrive.' : ' submitted for approval.') : ' saved as draft.'));
    if (location.hash === rmaHref(r, 1)) route(); else go(rmaHref(r, 1));
  } catch (e) { rmaBox(e); } },
  rmaDel(id) { const r = rmaR(id); if (!r || r.status !== 'Draft') return toast('Only drafts can be deleted.'); if (!confirm('Delete draft ' + id + '?')) return; DB.returns = DB.returns.filter(x => x !== r); persist(); toast(id + ' deleted.'); DO.rmaBack(); },
  rmaApprove(id) { const r = rmaR(id); if (r.status !== 'Requested') return toast('Not waiting for approval.'); r.status = 'Approved'; r.approvedBy = DATA.user.name; r.approvedAt = iso(today); ibAudit(r, 'Approved'); persist(); toast(id + ' approved. Receive the goods when they arrive.'); go(rmaHref(r, 2)); },
  rmaCorrect(id) { formModal('Return ' + id + ' for correction', [{ id: 'why', label: 'What needs correcting', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter what needs correcting.'); const r = rmaR(id); r.status = 'Draft'; ibAudit(r, 'Returned for correction: ' + v.why); rmaD = null; invDone(id + ' returned to draft.'); }, 'Return for correction'); },
  rmaReject(id) { formModal('Reject ' + id, [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); const r = rmaR(id); r.status = 'Rejected'; r.rejectWhy = v.why; ibAudit(r, 'Rejected: ' + v.why); invDone(id + ' rejected.'); }, 'Reject RMA'); },
  rmaCancel(id) { const r = rmaR(id); if (!['Draft', 'Requested', 'Approved'].includes(r.status)) return toast('Only RMAs not yet received can be cancelled.');
    formModal('Cancel ' + id, [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); r.status = 'Cancelled'; r.cancelWhy = v.why; ibAudit(r, 'Cancelled: ' + v.why); invDone(id + ' cancelled.'); }, 'Cancel RMA'); },
  rmaFill(k) { const f = $('#rmaF2'); if (!f) return; f.querySelectorAll('tr[data-i]').forEach(tr => { const i = tr.dataset.i, rc = f.querySelector(`[name=recv_${i}]`); if (rc.disabled) return; if (k === 'zero') rc.value = 0; const q = +rc.value || 0;
    ['good', 'hold', 'dmg', 'disp'].forEach(x => f.querySelector(`[name=${x}_${i}]`).value = k === x ? q : 0); ['recv', 'good', 'hold', 'dmg', 'disp'].forEach(x => rmaRv[x + '_' + i] = f.querySelector(`[name=${x}_${i}]`).value); }); rmaRecvCheck(); },
  rmaReceive(id) { const r = rmaR(id), f = $('#rmaF2'), g = n => ((f.querySelector(`[name="${n}"]`) || {}).value || '').trim(); try {
    if (!['Approved', 'Receiving'].includes(r.status)) throw new Error('This RMA is not waiting for goods.');
    const at = g('at'), by = g('by'); if (!at) throw new Error('Enter the received date.'); if (at > iso(today)) throw new Error('The received date cannot be in the future.'); if (!by) throw new Error('Choose who received the goods.');
    if (rmaY('reqVehicle') && (!g('vehicle') || !g('driver'))) throw new Error('Enter the vehicle number and driver.');
    if (r.lines.some(l => rmaCold(l.sku)) && rmaY('reqTemp') && g('ttemp') === '') throw new Error('Enter the truck temperature on arrival.');
    const minS = +rmaC('minShelf') || 0;
    const R = r.lines.map((l, i) => { const out = rmaOut(l); if (!out) return { i, recv: 0, good: 0, hold: 0, dmg: 0, disp: 0 };
      const x = { i, recv: +g('recv_' + i) || 0, good: +g('good_' + i) || 0, hold: +g('hold_' + i) || 0, dmg: +g('dmg_' + i) || 0, disp: +g('disp_' + i) || 0, batch: g('batch_' + i), expiry: g('exp_' + i), temp: g('temp_' + i), cond: g('cond_' + i), note: g('note_' + i) }, n = `Line ${i + 1} (${item(l.sku).name}): `, it = item(l.sku);
      if ([x.recv, x.good, x.hold, x.dmg, x.disp].some(v => v < 0 || !Number.isInteger(v))) throw new Error(n + 'quantities must be whole numbers, 0 or more.');
      if (x.recv > out) throw new Error(n + `received ${x.recv} is more than the ${out} outstanding. Raise another RMA for the extra.`);
      if (x.good + x.hold + x.dmg + x.disp !== x.recv) throw new Error(n + `Good + Hold + Damaged + Dispose (${x.good + x.hold + x.dmg + x.disp}) must equal Received (${x.recv}).`);
      if (!x.recv) return x;
      if (it.batch && !x.batch) throw new Error(n + 'enter the batch.'); if (it.expiry && !x.expiry) throw new Error(n + 'enter the expiry date.');
      if (x.good && x.expiry && rmaY('blockExpired') && x.expiry < at) throw new Error(n + 'the goods are expired and cannot be restocked. Put them on Hold or Dispose.');
      if (x.good && x.expiry && minS && daysBetween(at, x.expiry) < minS) throw new Error(n + `less than ${minS} days of shelf life left, so it cannot be restocked.`);
      if (rmaCold(l.sku) && rmaY('reqTemp') && x.temp === '') throw new Error(n + it.temp.toLowerCase() + ' item: enter the product temperature.');
      if ((x.dmg || x.disp || x.hold) && rmaY('reqNote') && !x.note && (!x.cond || x.cond === 'Good')) throw new Error(n + 'choose the condition or enter a note for Hold, Damaged or Dispose.');
      if (x.good && x.cond && !['Good', 'Packaging damaged'].includes(x.cond)) throw new Error(n + `condition is "${x.cond}": goods in that condition cannot be restocked.`);
      return x; });
    if (!R.some(x => x.recv > 0)) throw new Error('Nothing received. Enter the received quantity.');
    if (rmaY('reqEvidence') && R.some(x => x.hold || x.dmg || x.disp) && !g('evidence')) throw new Error('Enter the photo / evidence reference for goods that are not good.');
    if (r.lines.some((l, i) => R[i].recv < rmaOut(l)) && !rmaY('partial')) throw new Error('Partial receipts are switched off. Receive the full outstanding quantity.');
    const no = r.id.replace(/^RMA/, 'RR') + '-' + (r.receipts.length + 1), made = [], taken = [];
    R.forEach(x => { if (!x.recv) return; const l = r.lines[x.i]; x.lpns = [];
      [['good', 'Received', 'RET-01'], ['hold', 'Hold', 'QA-HOLD'], ['dmg', 'Damaged', (usageBin(r.wh, 'Damaged') || {}).code || 'QA-HOLD']].forEach(([k, st, bin]) => { if (!x[k]) return;
        const s = { lpn: seqNo('LPN', 'LPN-', 6), client: r.client, sku: l.sku, wh: r.wh, bin: binRec(r.wh, bin) ? bin : 'RET-01', batch: x.batch, expiry: x.expiry, qty: x[k], alloc: 0, status: st, received: at, qc: k === 'good' ? 'Accepted' : 'Rejected', asn: '', rma: r.id };
        DB.stock.push(s); ibMove(at, 'Return', no, s, x[k]); x.lpns.push(s.lpn); if (k !== 'good') ibMove(at, 'Status: ' + st, r.id, s, 0);
        if (k === 'good') { const b = ibSuggest(r.wh, l.sku, r.client, taken)[0], to = b ? b.code : ''; if (to) taken.push(to); const t = { id: seqNo('PUT', 'PUT-', 4), lpn: s.lpn, wh: r.wh, from: s.bin, to, suggested: to, status: 'Open', created: at, done: null, by: '', asn: '', rma: r.id }; DB.tasks.push(t); made.push(t.id); } });
      if (x.disp) DB.moves.push({ at, type: 'Return disposed', ref: r.id, lpn: '', sku: l.sku, client: r.client, wh: r.wh, bin: 'RET-01', qty: 0 });
      ['recv', 'good', 'hold', 'dmg', 'disp'].forEach(k => l[k] = (+l[k] || 0) + x[k]); if (x.batch) l.batch = x.batch; if (x.expiry) l.expiry = x.expiry; l.lpns = (l.lpns || []).concat(x.lpns);
      l.result = [l.good && 'Restock', l.hold && 'Hold', l.dmg && 'Damaged', l.disp && 'Dispose'].filter(Boolean).join(' / '); });
    r.receipts.push({ no, at, time: g('time'), by, vehicle: g('vehicle').toUpperCase(), driver: g('driver'), dmobile: g('dmobile'), seal: g('seal'), ttemp: g('ttemp'), evidence: g('evidence'), lines: R });
    r.recvAt = at; r.status = r.lines.some(rmaOut) ? 'Receiving' : 'Received';
    const units = sum(R, x => x.recv), ch = rmaCharge(r, 'receipt', units, R.filter(x => x.recv).length, at);
    ibAudit(r, `${no}: received ${units} · good ${sum(R, x => x.good)}, hold ${sum(R, x => x.hold)}, damaged ${sum(R, x => x.dmg)}, disposed ${sum(R, x => x.disp)}${made.length ? ' · put-away ' + made.join(', ') : ''}${ch.length ? ' · charge ' + ch.join(', ') : ''}`);
    const closed = rmaTryClose(r, true); rmaRv = {}; persist();
    toast(no + ' confirmed.' + (r.status === 'Receiving' ? ' More goods are still expected.' : '') + (made.length ? ' ' + made.length + ' put-away task' + (made.length > 1 ? 's' : '') + ' created.' : '') + (closed ? ' RMA closed.' : ''));
    go(rmaHref(r, r.status === 'Receiving' ? 2 : 3));
  } catch (e) { rmaBox(e); } },
  rmaClose(mode) { const r = rmaCurR(), f = $('#rmaF3'), g = n => { const x = f && f.querySelector(`[name="${n}"]`); return x ? x.value.trim() : null; }; try {
    ['shortMode', 'shortRef', 'holdAct', 'holdOwner', 'caseRef', 'dispCert', 'dispDate', 'closeNote'].forEach(k => { const v = g(k); if (v != null) r[k] = v; });
    if (mode === 'save') { ibAudit(r, 'Closure details saved'); const c = rmaTryClose(r, true); persist(); route(); return toast(c ? r.id + ' closed.' : 'Saved. The RMA stays open.'); }
    if (!['Receiving', 'Received'].includes(r.status)) throw new Error('Receive the goods first.');
    const short = sum(r.lines, rmaOut);
    if (short && r.shortMode !== 'close') throw new Error(`${short} unit${short === 1 ? ' is' : 's are'} not received. Choose "Close short — approved", or keep the RMA open.`);
    if (short && rmaY('shortRef') && !r.shortRef) throw new Error('Enter the approval reference for closing short.');
    if (rmaY('reqPutaway')) { const open = rmaTasks(r).filter(t => t.status === 'Open'); if (open.length) throw new Error('Confirm the put-away first: ' + open.map(t => t.id).join(', ') + '.'); }
    if (rmaTot(r, 'hold') + rmaTot(r, 'dmg') && rmaY('holdOwner') && !(r.holdAct && r.holdOwner)) throw new Error('Choose the hold / damaged decision and the responsible person.');
    if (rmaTot(r, 'disp') && rmaY('dispCert') && !r.dispCert) throw new Error('Enter the disposal certificate reference.');
    rmaCharge(r, 'close', rmaTot(r, 'recv'), r.lines.filter(l => l.recv > 0).length, iso(today));
    r.status = 'Closed'; r.closed = iso(today); ibAudit(r, short ? `Closed short (${short} not received) · ${r.shortRef}` : 'Closed');
    if (r.holdAct) ibAudit(r, 'Hold / damaged: ' + r.holdAct + ' · ' + r.holdOwner + (r.caseRef ? ' · case ' + r.caseRef : ''));
    persist(); route(); toast(r.id + ' closed.');
  } catch (e) { rmaBox(e); } },
  rmaSettings() { const F = []; RMA_CFG_F.forEach(([sec, list]) => { F.push({ type: 'html', html: `<h3 class="rm-cfgh">${sec}</h3>` }); list.forEach(([k, label, type, o]) => F.push(type === 'number' ? { id: k, label, type: 'number', min: 0, value: rmaC(k) } : { id: k, label, type: 'select', options: type === 'select' ? (typeof o === 'function' ? o() : o) : [['Yes', 'Yes'], ['No', 'No']], value: rmaC(k) })); });
    formModal('Returns settings', F, v => { Object.keys(v).forEach(k => { if (typeof RMA_DEF[k] === 'number' && !(+v[k] >= 0)) throw new Error('Enter 0 or more for every number.'); }); DB.rmaCfg = { ...RMA_DEF, ...(DB.rmaCfg || {}), ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof RMA_DEF[k] === 'number' ? +x : x])) }; invDone('Returns settings saved.'); }); },
  rmaPrintRr(k) { const [id, no] = k.split('|'), r = rmaR(id), x = r.receipts.find(y => y.no === no); if (!x) return; const T = (a, b, c, d) => `<tr><th>${a}</th><td>${b}</td><th>${c}</th><td>${d}</td></tr>`;
    modal('Return receipt ' + esc(no), `<div class="rm-print"><div class="rm-ph"><div><h3>Return Receipt</h3><div class="note">${esc(DATA.company)}</div></div><div style="text-align:right"><b class="mono">${esc(no)}</b><div class="note">RMA ${esc(r.id)}</div></div></div>
      <table class="rm-pt">${T('Customer', esc(clName(r.client)), 'Order', esc(r.order))}${T('Warehouse', esc(whRec(r.wh).name) + ' · RET-01', 'Received', fmtDate(x.at) + ' ' + esc(x.time || '') + ' · ' + esc(x.by || ''))}${T('Vehicle / driver', esc(x.vehicle || '—') + ' · ' + esc(x.driver || '—'), 'Seal / temp.', esc(x.seal || '—') + ' · ' + (x.ttemp !== '' && x.ttemp != null ? esc(x.ttemp) + ' °C' : '—'))}</table>
      <div class="tbl-wrap"><table><thead><tr><th>SKU</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="num">Received</th><th class="num">Good</th><th class="num">Hold</th><th class="num">Damaged</th><th class="num">Dispose</th><th>Condition</th><th>LPN</th></tr></thead><tbody>${x.lines.filter(y => y.recv).map(y => { const l = r.lines[y.i]; return `<tr><td class="mono">${esc(l.sku)}</td><td>${esc(item(l.sku).name || '')}</td><td>${esc(y.batch || '')}</td><td>${y.expiry ? fmtDate(y.expiry) : ''}</td><td class="num">${n0(y.recv)}</td><td class="num">${y.good || ''}</td><td class="num">${y.hold || ''}</td><td class="num">${y.dmg || ''}</td><td class="num">${y.disp || ''}</td><td>${esc(y.cond || '')} ${esc(y.note || '')}</td><td class="mono">${(y.lpns || []).join(', ')}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="rm-sig"><div>Driver</div><div>Received by</div><div>Supervisor</div></div></div>`, `<button type="button" class="btn" data-do="mClose">Close</button><button type="button" class="btn pri" data-do="rmaPrint">Print</button>`, 'lpn-modal'); },
  rmaPrint() { document.body.classList.add('pm'); const fin = () => { document.body.classList.remove('pm'); window.removeEventListener('afterprint', fin); }; window.addEventListener('afterprint', fin); setTimeout(() => { try { window.print(); } catch (e) { toast('Printing is not available here.'); } setTimeout(fin, 1500); }, 50); }
});
{ const pl = DO.putLoose, pa = DO.putAll; DO.putLoose = id => { pl(id); rmaAutoAll(); }; DO.putAll = () => { pa(); rmaAutoAll(); }; }

/* ---- first-run data: three dispatched orders and two returns against them ---- */
function rmaSeedOrder(wh, customer, lines, daysAgo) {
  const cl = item(lines[0][0]).client, c = client(cl), pc = primaryContact(c), at = iso(addDays(today, -daysAgo)), cr = iso(addDays(today, -daysAgo - 1)), loc = whRec(wh).loc;
  const o = obNorm({ id: obNo(wh), loc, client: cl, wh, customer, address: (c.billing || {}).city || '', contact: pc.name || '', phone: pc.mobile || '', due: at, ref: 'PO-' + (6900 + daysAgo), type: 'Customer dispatch', priority: 'Normal', status: 'New', created: cr, odate: cr, approvedBy: 'Hamza Kadenja', lines: lines.map(([sku, qty]) => ({ sku, qty, desc: '', picks: [], short: 0 })), audit: [] });
  while (DB.orders.some(x => x.id === o.id)) { DB.seq.OB[loc]++; o.id = obNo(wh); } DB.seq.OB[loc]++;
  try { obAllocate(o); } catch (e) { obRelease(o); return null; }
  DB.orders.push(o);
  const rows = obPickRows(o); o.pk = { ref: 'PICK-' + obSfx(o), picker: 'Khalid Mansour', verify: 'Accepted', pack: 'Yes', hu: rows.length, lines: rows.map(r => ({ picked: r.p.qty, reason: '' })) }; obConfirmPick(o, o.pk);
  const r2 = obPickRows(o); o.load = { carrier: 'Gray Lane fleet', vehicle: 'JED 4821', vtype: 'Normal truck', driver: 'Saeed Omar', mobile: '+966 55 410 2233', bay: 'DOCK-02', time: at + 'T08:30', pkgs: r2.length, seal: '', checks: OB_LOADCHK.map(() => true), lines: r2.map(r => ({ picked: r.p.qty, loaded: r.p.qty, cond: 'OK' })), reason: '' }; obConfirmLoad(o, o.load);
  o.disp = { cby: 'Hamza Kadenja', time: at + 'T10:00', checks: OB_DOCCHK.map(() => true), seal: '', bal: '' }; obPostDispatch(o, at);
  ['Order created', 'Order approved and released', 'Stock allocated', 'Pick confirmed by Khalid Mansour', 'Loading confirmed on JED 4821', 'Goods issue ' + o.gi + ' posted, ' + o.dn + ' raised'].forEach((a, j) => o.audit.push({ at: (j < 2 ? cr : at) + 'T' + String(8 + j).padStart(2, '0') + ':15:00', action: a, by: 'Hamza Kadenja' }));
  return o;
}
function seedReturns() {
  if (!DB.returns) DB.returns = []; if (!DB.charges) DB.charges = [];
  if (DB.returns.length) return;
  const o1 = rmaSeedOrder('WH-JED-01', 'Panda Hypermarket #112', [['RSF-RICE-5K', 20], ['RSF-OIL-1L', 12]], 5);
  const o2 = rmaSeedOrder('WH-JED-01', 'eXtra Jeddah', [['NJE-TV-55', 6]], 8);
  rmaSeedOrder('WH-JED-01', 'Online customer', [['SQS-ABY-M', 8]], 2);
  const mk = (o, sku, qty, reason, status, note, daysAgo) => { if (!o) return; const g = rmaShip(o).find(x => x.sku === sku); if (!g) return; const at = iso(addDays(today, -daysAgo));
    const r = { id: docNoL('RMA', o.loc), loc: o.loc, order: o.id, client: o.client, wh: o.wh, reason, reasonNote: note, cref: 'Email ' + fmtDate(at), expected: iso(addDays(today, 1)), collect: 'Gray Lane collects', contact: o.contact, mobile: o.phone, attach: '', notes: '', lateRef: '', status, created: at, createdBy: 'Noura Al-Otaibi', receipts: [], charges: [], audit: [],
      lines: [{ sku, batch: g.batch, expiry: g.expiry, ret: Math.min(qty, g.shipped), lreason: '', recv: 0, good: 0, hold: 0, dmg: 0, disp: 0, lpns: [], result: '' }] };
    r.audit.push({ at: at + 'T10:20:00', action: 'Draft created', by: 'Noura Al-Otaibi' }, { at: at + 'T10:25:00', action: `Submitted: ${r.lines[0].ret} units on 1 line · waiting for approval`, by: 'Noura Al-Otaibi' });
    if (status === 'Approved') { r.approvedBy = 'Hamza Kadenja'; r.approvedAt = at; r.audit.push({ at: at + 'T11:05:00', action: 'Approved', by: 'Hamza Kadenja' }); }
    DB.returns.push(r); };
  mk(o2, 'NJE-TV-55', 2, 'Refused by consignee', 'Approved', 'Consignee refused two units at the door', 3);
  mk(o1, 'RSF-RICE-5K', 4, 'Damaged in transit', 'Requested', 'Four cartons crushed on delivery', 1);
}
