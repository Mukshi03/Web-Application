'use strict';
/* =====================================================================
   DATA FLOWS  (ERP: what one module's work creates in the others)
   · GRN approved            → automatic inbound handling charge (per pallet received)
   · Order dispatched        → automatic order processing + outbound handling charges (per pallet picked)
   · Handling Services Performed on receipts and orders → confirmed lines become charges
   · Dashboard, top search, exceptions and pending approvals read the live records
   ===================================================================== */

/* ---- automatic charges at contract rate (standard rate when the service is not on the contract) ---- */
const FLOW_SVC = { in: 'HDL-001', order: 'HDL-003', out: 'HDL-002' };
function flowRate(cl, code) { const cr = ctrRate(cl, code), k = ctrActive(cl); return cr && +cr.rate ? { rate: +cr.rate, src: 'Contract ' + k.id } : { rate: +svcBy(code).rate || 0, src: 'Standard rate' }; }
function flowCharge(at, cl, code, ref, qty, note, extra) {
  const s = svcBy(code); if (!s.code || !(qty > 0)) return null;
  const r = flowRate(cl, code); if (!r.rate) return null;
  const minFee = +((ctrRate(cl, code) || {}).minFee || s.minFee || 0), base = qty * r.rate, amt = Math.max(base, minFee);
  const c = { id: seqNo('CHG', 'CHG-', 5), at: String(at || iso(today)).slice(0, 10), client: cl, type: s.name, svc: code, ref, qty, rate: r.rate, amount: +amt.toFixed(2), note: (note || 'per ' + s.unit) + (amt > base ? ' · minimum fee applied' : ''), invoice: '', vat: s.vat || '0.15', rateSrc: r.src, auto: 1, ...extra };
  DB.charges.push(c); return c;
}
const flowGrnPallets = g => g.lines.filter(l => +l.received > 0).length;
function flowChargeGrn(a, g) {
  if (DB.charges.some(c => c.auto && c.ref === g.id && c.svc === FLOW_SVC.in)) return null;
  const c = flowCharge(g.at, a.client, FLOW_SVC.in, g.id, flowGrnPallets(g), 'per pallet received', { src: 'GRN', doc: a.id });
  if (c) ibAudit(a, `Charge ${c.id} raised: ${c.type} × ${c.qty} = SAR ${sar(c.amount)}`); return c;
}
function flowChargeDispatch(o) {
  const made = [], ref = o.dn || o.id, at = o.dispatchedAt || iso(today);
  if (!DB.charges.some(c => c.auto && c.ref === ref && c.svc === FLOW_SVC.order)) made.push(flowCharge(at, o.client, FLOW_SVC.order, ref, 1, 'per order', { src: 'Dispatch', doc: o.id }));
  const pal = sum(o.lines, l => (l.picks || []).filter(p => p.qty > 0).length);
  if (!DB.charges.some(c => c.auto && c.ref === ref && c.svc === FLOW_SVC.out)) made.push(flowCharge(at, o.client, FLOW_SVC.out, ref, pal, 'per pallet picked', { src: 'Dispatch', doc: o.id }));
  made.filter(Boolean).forEach(c => ibAudit(o, `Charge ${c.id} raised: ${c.type} × ${c.qty} = SAR ${sar(c.amount)}`)); return made.filter(Boolean);
}
{ const g0 = ibDoGrn; ibDoGrn = function (a, gd) { spAutoConfirm('in', a); const g = g0(a, gd); flowChargeGrn(a, g); return g; }; }
{ const d0 = obPostDispatch; obPostDispatch = function (o, at) { spAutoConfirm('out', o); d0(o, at); flowChargeDispatch(o); }; }

/* ---- Handling Services Performed (manual work recorded on a receipt or an order) ---- */
Object.assign(BE_DEF, { spOn: 'Yes', spNonContract: 'approval', spSupervisor: 'Yes', spAutoConfirm: 'No', spBlockClose: 'Yes', spQtyCheck: 'Yes' });
{ const e0 = EXT.be; EXT.be = () => [...e0(), ['Handling services performed', 'Handling and VAS work recorded on receipts and outbound orders while it is done.', [
  ['spOn', 'Record services performed on inbound and outbound', 'select', () => SYN, 'Yes', 1], ['spNonContract', 'Service not on the customer contract', 'select', () => [['approval', 'Allowed · rate pending until approved'], ['standard', 'Allowed · use the standard rate'], ['block', 'Not allowed']], 'approval', 1],
  ['spSupervisor', 'A supervisor confirms each line before it is charged', 'select', () => SYN, 'Yes', 1], ['spAutoConfirm', 'Confirm open lines automatically when the GRN is approved or goods are dispatched', 'select', () => SYN, 'No', 1],
  ['spBlockClose', 'Block GRN approval and dispatch while lines are unconfirmed', 'select', () => SYN, 'Yes', 1], ['spQtyCheck', 'Warn when the quantity is more than the pallets or units received / shipped', 'select', () => SYN, 'Yes', 1]]]]; }
const spC = k => beC(k);
const SP_ST = { in: [['gate', 'Unloading / gate'], ['receiving', 'Receiving'], ['qc', 'QC / inspection'], ['grn', 'GRN'], ['putaway', 'Put-away']], out: [['alloc', 'Picking'], ['pack', 'Packing'], ['loading', 'Loading'], ['dispatch', 'Dispatch']] };
Object.assign(TONE, { Recorded: 'warn', Charged: 'good', Billed: 'info' });
const spDoc = (kind, id) => kind === 'in' ? DB.asns.find(a => a.id === id) : DB.orders.find(o => o.id === id);
const spRef = (kind, d) => kind === 'in' ? (d.grn || d.id) : (d.dn || d.id);
const spRefs = (kind, d) => kind === 'in' ? [d.id, d.grn].filter(Boolean) : [d.id, d.dn].filter(Boolean);
const spAuto = (kind, d) => DB.charges.filter(c => c.auto && c.client === d.client && spRefs(kind, d).includes(c.ref));
const spSvcOpts = cl => { const k = ctrActive(cl), on = new Set(k ? k.lines.map(l => l.code) : []), nc = spC('spNonContract');
  return M.services.filter(s => s.status === 'Active' && s.cat !== 'Storage' && (on.has(s.code) || nc !== 'block')).sort((a, b) => (on.has(b.code) - on.has(a.code)) || a.code.localeCompare(b.code)).map(s => [s.code, `${s.code} · ${s.name}${on.has(s.code) ? ' (on contract)' : nc === 'approval' ? ' (not on contract · rate pending)' : ' (standard rate)'}`]); };
function spRate(cl, code) { const k = ctrActive(cl), l = k && k.lines.find(x => x.code === code), s = svcBy(code);
  if (l && +l.rate) return { rate: +l.rate, src: 'Contract ' + k.id, pending: false }; if (spC('spNonContract') === 'standard') return { rate: +s.rate || 0, src: 'Standard rate', pending: false }; return { rate: +s.rate || 0, src: 'Not on contract', pending: true }; }
function spLimits(kind, d) { if (kind === 'in') { const rl = (d.receipt || {}).lines || []; return { pallets: rl.filter(l => +l.received > 0).length || d.lines.length, units: sum(rl, l => +l.received || 0) || sum(d.lines, l => +l.qty || 0) }; }
  return { pallets: sum(d.lines, l => (l.picks || []).length) || d.lines.length, units: sum(d.lines, l => (+l.qty || 0) - (+l.short || 0)) }; }
const spSt = l => { if (l.charge) { const c = DB.charges.find(x => x.id === l.charge); return c && chgDraft(c) ? 'Billed' : 'Charged'; } return l.rs && l.rs.pending && !l.rateOk ? 'Rate pending' : 'Recorded'; };
const spCanSup = () => can('billing', 'approve') || can(CUR.mod, 'approve');
const spOpenAll = () => [...DB.asns.map(d => ['in', d]), ...DB.orders.map(d => ['out', d])].flatMap(([k, d]) => (d.svcs || []).filter(l => !l.charge).map(l => ({ kind: k, d, l })));
function spSection(kind, d, stage) {
  if (spC('spOn') === 'No' || !d) return '';
  const L = d.svcs || [], A = spAuto(kind, d), lim = spLimits(kind, d), key = kind + '|' + d.id, open = L.filter(l => !l.charge), tot = sum(L, l => l.amount || 0) + sum(A, c => c.amount), stl = k => (SP_ST[kind].find(s => s[0] === k) || [k, k])[1], cnt = st => L.filter(l => spSt(l) === st).length;
  const B = (l, a, id, c) => `<button type="button" class="btn sm ${c || ''}" data-do="${a}" data-id="${esc(id)}">${l}</button>`;
  const rows = [...A.map(c => `<tr class="sp-auto"><td><span class="pill p-mute">Automatic</span></td><td><b>${esc(c.type)}</b><br><span class="note mono">${esc(c.svc || '')}</span> <span class="note">· ${esc(c.ref)}</span></td><td class="num"><b>${n0(c.qty)}</b> <span class="note">${esc(String(c.note || '').replace(/^per /, ''))}</span></td><td class="num">${beRate(c.rate)}<br><span class="note">${esc(c.rateSrc || '')}</span></td><td class="num"><b>${sar(c.amount)}</b></td><td><span class="note">System</span></td><td>${pill(chgDraft(c) ? 'Billed' : 'Charged')}</td><td></td></tr>`),
    ...L.map(l => { const st = spSt(l), s = svcBy(l.svc), k = key + '|' + l.id; return `<tr><td><span class="pill p-mute">${esc(stl(l.stage))}</span></td><td><b>${esc(s.name || l.svc)}</b><br><span class="note mono">${esc(l.svc)}</span>${l.note ? `<br><span class="note">${esc(l.note)}</span>` : ''}</td><td class="num"><b>${n0(l.qty)}</b> <span class="note">${esc(l.unit || '')}</span></td><td class="num">${beRate(l.rate || 0)}<br><span class="note">${esc(l.rateOk ? 'Approved rate' : (l.rs || {}).src || '')}</span></td><td class="num"><b>${sar(l.amount || 0)}</b></td><td>${esc(l.by || '—')}<br><span class="note">${l.date ? fmtDate(l.date) : ''}</span></td><td>${pill(st)}${l.charge ? `<br><span class="note mono">${esc(l.charge)}</span>` : ''}</td>
      <td><div class="rowicons">${st === 'Rate pending' ? B('Approve rate', 'spRateOk', k, 'pri') : ''}${st === 'Recorded' ? B('Confirm', 'spConfirm', k, 'pri') : ''}${!l.charge ? `<button type="button" class="icon-btn" data-do="spEdit" data-id="${esc(k)}" aria-label="Edit" title="Edit">${ICO.edit}</button><button type="button" class="icon-btn danger" data-do="spDel" data-id="${esc(k)}" aria-label="Delete" title="Delete">${ICO.del}</button>` : st === 'Charged' ? B('Reverse', 'spReverse', k) : ''}</div></td></tr>`; })];
  return `<section class="card sp-card"><div class="card-h"><div><h2>Handling services performed</h2><p class="note">Handling and VAS work done on this ${kind === 'in' ? 'receipt' : 'order'} · ${esc(clName(d.client))} · ${n0(lim.pallets)} pallets / ${n0(lim.units)} units</p></div>
    <div class="row"><span class="pill p-mute">${A.length + L.length} services</span>${cnt('Recorded') ? `<span class="pill p-warn">${cnt('Recorded')} to confirm</span>` : ''}${cnt('Rate pending') ? `<span class="pill p-bad">${cnt('Rate pending')} rate pending</span>` : ''}<b class="note">SAR ${sar(tot)}</b>${cnt('Recorded') ? B('Confirm all', 'spConfirmAll', key) : ''}<button type="button" class="btn sm pri" data-do="spAdd" data-id="${esc(key + '|' + stage)}">+ Add service</button></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Stage</th><th>Service</th><th class="num">Qty</th><th class="num">Rate, SAR</th><th class="num">Amount, SAR</th><th>Done by</th><th>Status</th><th></th></tr></thead><tbody>${rows.join('')}</tbody>
      <tfoot><tr><td colspan="4">Total · ${A.length} automatic, ${L.length} recorded${open.length ? ` · ${open.length} not yet charged` : ''}</td><td class="num">${sar(tot)}</td><td colspan="3"></td></tr></tfoot></table></div>`
      : `<div class="empty">No services recorded yet. Add unloading, wrapping, labelling, sorting, overtime and other work as it is done${kind === 'in' ? '. The inbound handling charge is raised automatically when the GRN is approved' : '. Order processing and outbound handling are charged automatically on dispatch'}.</div>`}</section>`;
}
const spPlace = (h, secHtml) => { if (!secHtml) return h; const k = h.lastIndexOf('<div class="form-foot">'); return k >= 0 ? h.slice(0, k) + secHtml + h.slice(k) : h + secHtml; };
{ const s0 = ibShow; ibShow = function (page, mode, id) { const h = s0(page, mode, id); if (mode !== 'edit' || !['receiving', 'grn', 'putaway'].includes(page)) return h; const a = DB.asns.find(x => x.id === id); return a && ibReach[page](a) && a.status !== 'Draft' ? spPlace(h, spSection('in', a, page)) : h; }; }
{ const s0 = obShow; obShow = function (page, mode, id) { const h = s0(page, mode, id); if (mode !== 'edit' || !['alloc', 'pick', 'loading', 'dispatch'].includes(page)) return h; const o = DB.orders.find(x => x.id === id); return o && obReach[page](o) && !['Draft', 'Cancelled'].includes(o.status) ? spPlace(h, spSection('out', o, page === 'pick' ? 'alloc' : page)) : h; }; }
function spCharge(kind, d, l) {
  const s = svcBy(l.svc); if (!(+l.rate > 0)) throw new Error('The rate for ' + l.svc + ' is 0. Set a rate on the contract or the service item.');
  const c = { id: seqNo('CHG', 'CHG-', 5), at: l.date || iso(today), client: d.client, type: s.name || l.svc, svc: l.svc, ref: spRef(kind, d), qty: l.qty, rate: l.rate, amount: l.amount, note: 'per ' + (s.unit || 'unit'), memo: l.note || '', invoice: '', vat: s.vat || '0.15', rateSrc: l.rateOk ? 'Approved exception rate' : (l.rs || {}).src, src: 'Services performed', spId: d.id + '/' + l.id, by: l.by };
  DB.charges.push(c); l.charge = c.id; l.confBy = DATA.user.name; l.confAt = iso(today); ibAudit(d, `Service charged: ${l.svc} × ${l.qty} = SAR ${sar(l.amount)} (${c.id})`); return c;
}
function spAutoConfirm(kind, d) { if (spC('spAutoConfirm') !== 'Yes' || !d) return; (d.svcs || []).filter(l => spSt(l) === 'Recorded').forEach(l => spCharge(kind, d, l)); }
function spGuard(kind, d) { if (spC('spOn') === 'No' || !d) return; const open = (d.svcs || []).filter(l => !l.charge); if (!open.length) return;
  const pend = open.some(l => spSt(l) === 'Rate pending'); if (spC('spBlockClose') === 'Yes' && (spC('spAutoConfirm') !== 'Yes' || pend)) throw new Error(`${open.length} handling service line${open.length === 1 ? ' is' : 's are'} not yet confirmed. Confirm ${open.length === 1 ? 'it' : 'them'} under Handling services performed first${pend ? ' (a rate is waiting for approval)' : ''}.`); }
{ const g0 = DO.grnApprove; DO.grnApprove = function () { try { spGuard('in', DB.asns.find(a => a.id === ibCur.id)); } catch (e) { return formErr('#ibErr', e); } return g0.apply(this, arguments); }; }
// with automatic GRN on, finishing receiving approves the GRN, so the same check applies there
{ const r0 = DO.rcvDone; DO.rcvDone = function () { if (IB_CFG.autoGrn) { try { spGuard('in', DB.asns.find(a => a.id === ibCur.id)); } catch (e) { return formErr('#ibErr', e); } } return r0.apply(this, arguments); }; }
{ const d0 = DO.obDispatch; DO.obDispatch = function () { try { spGuard('out', DB.orders.find(o => o.id === obCur.id)); } catch (e) { return formErr('#ibErr', e); } return d0.apply(this, arguments); }; }
const spGet = k => { const [kind, id, lid] = String(k).split('|'), d = spDoc(kind, id), l = d && (d.svcs || []).find(x => x.id === lid); return { kind, d, l }; };
let spF = null;
function spFormOpen(kind, d, stage, l) {
  spF = { kind, id: d.id, lid: l ? l.id : '' }; const lim = spLimits(kind, d), v = l || { stage: SP_ST[kind].some(s => s[0] === stage) ? stage : SP_ST[kind][0][0], date: iso(today), by: DATA.user.name };
  formModal(l ? 'Edit handling service' : 'Add handling service', [{ type: 'html', html: `<p class="note" style="margin:0">${kind === 'in' ? 'ASN' : 'Order'} ${esc(d.id)} · ${esc(clName(d.client))} · ${n0(lim.pallets)} pallets, ${n0(lim.units)} units ${kind === 'in' ? 'received' : 'shipped'}.</p>` },
    { id: 'stage', label: 'Stage', type: 'select', options: SP_ST[kind], value: v.stage }, { id: 'svc', label: 'Service', type: 'select', blank: 'Choose a service…', options: spSvcOpts(d.client), value: v.svc || '', req: 1 },
    { id: 'qty', label: 'Quantity', type: 'number', min: 0, step: 'any', value: v.qty ?? '', req: 1 }, { id: 'date', label: 'Date', type: 'date', value: v.date, req: 1 }, { id: 'by', label: 'Done by', type: 'select', options: M.users.filter(u => u.status !== 'Inactive').map(u => [u.name, u.name]), value: v.by },
    { id: 'note', label: 'Note / reason', value: v.note || '', full: 1, ph: 'e.g. customer asked to relabel all cartons' }, { type: 'html', html: '<div id="spPrev" class="row" style="gap:6px"></div>' }],
    x => DO.spSave(x), l ? 'Save changes' : 'Save');
  spPreview();
}
function spPreview() { const p = $('#spPrev'); if (!p || !spF) return; const d = spDoc(spF.kind, spF.id), f = $('#fmForm'), svc = f.querySelector('[name=svc]').value, q = +f.querySelector('[name=qty]').value || 0, s = svcBy(svc);
  if (!s.code) { p.innerHTML = '<span class="note">Choose a service to see the rate and amount.</span>'; return; }
  const r = spRate(d.client, s.code), lim = spLimits(spF.kind, d), u = String(s.unit || ''), over = spC('spQtyCheck') === 'Yes' && ((/pallet/i.test(u) && q > lim.pallets) || (/carton|case|piece|unit|box|label/i.test(u) && q > lim.units));
  p.innerHTML = `<span class="pill p-mute">${esc(s.code)} · ${esc(s.name)}</span><span class="pill p-mute">${n0(q)} ${esc(u)}</span><span class="pill p-mute">SAR ${sar(r.rate)} · ${esc(r.src)}</span><span class="pill p-info">SAR ${sar(q * r.rate)}</span>${r.pending ? '<span class="pill p-bad">Rate pending · needs approval</span>' : ''}${over ? `<span class="pill p-warn">More than the ${/pallet/i.test(u) ? n0(lim.pallets) + ' pallets' : n0(lim.units) + ' units'} ${spF.kind === 'in' ? 'received' : 'shipped'}</span>` : ''}`; }
document.addEventListener('input', e => { if (spF && e.target.closest && e.target.closest('#fmForm') && $('#spPrev')) spPreview(); });
document.addEventListener('change', e => { if (spF && e.target.closest && e.target.closest('#fmForm') && $('#spPrev')) spPreview(); });
// recording a service redraws the page: keep what the user has typed on the receiving / order form underneath
const SP_FORMS = ['rcvForm', 'grnForm', 'putForm', 'alForm', 'pkForm', 'ldForm', 'dsForm'];
function spKeep() { const f = SP_FORMS.map(id => document.getElementById(id)).find(Boolean); if (!f) return null;
  return { id: f.id, v: [...f.elements].map(el => [el.name, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value]) }; }
function spRestore(k) { const f = k && document.getElementById(k.id); if (!f) return; const els = [...f.elements]; if (els.length !== k.v.length) return;
  els.forEach((el, i) => { const [n, v] = k.v[i]; if (el.name !== n || el.disabled || el.readOnly) return; if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v; });
  els.forEach(el => el.dispatchEvent(new Event('input', { bubbles: true }))); }
const spRedraw = msg => { const k = spKeep(); persist(); closeModal(); route(); spRestore(k); if (msg) toast(msg); };
Object.assign(DO, {
  spAdd(k) { const [kind, id, stage] = String(k).split('|'), d = spDoc(kind, id); if (!d) return toast('Open the receipt or order first.'); spFormOpen(kind, d, stage, null); },
  spEdit(k) { const { kind, d, l } = spGet(k); if (l.charge) return toast('This line is already charged. Reverse it first.'); spFormOpen(kind, d, l.stage, l); },
  spSave(v) { const { kind, id, lid } = spF, d = spDoc(kind, id), l = lid ? (d.svcs || []).find(x => x.id === lid) : null, s = svcBy(v.svc);
    if (!v.svc || !s.code) throw new Error('Choose the service.'); const q = +v.qty; if (!(q > 0)) throw new Error('Enter a quantity above 0.'); if (!v.date) throw new Error('Enter the date.'); if (v.date > iso(today)) throw new Error('The date cannot be in the future.');
    const r = spRate(d.client, s.code); if (r.pending && spC('spNonContract') === 'block') throw new Error(s.code + ' is not on the customer contract.');
    if (spC('spQtyCheck') === 'Yes') { const lim = spLimits(kind, d), u = String(s.unit || ''), cap = /pallet/i.test(u) ? ['pallets', lim.pallets] : /carton|case|piece|unit|box|label/i.test(u) ? ['units', lim.units] : null; if (cap && cap[1] && q > cap[1] && !v.note) throw new Error(`Quantity ${q} is more than the ${cap[1]} ${cap[0]} on this ${kind === 'in' ? 'receipt' : 'order'}. Enter the reason in Note to continue.`); }
    const rec = { stage: v.stage, svc: s.code, unit: s.unit, qty: q, date: v.date, by: v.by, note: v.note, rs: r, rate: r.rate, amount: +(q * r.rate).toFixed(2) }; d.svcs = d.svcs || [];
    if (l) { if (l.rateOk && l.svc === rec.svc) { rec.rate = l.rate; rec.amount = +(q * l.rate).toFixed(2); rec.rateOk = l.rateOk; } else delete l.rateOk; Object.assign(l, rec); ibAudit(d, 'Handling service updated: ' + s.code + ' × ' + q); }
    else { const nl = { id: 'SP-' + String(1 + Math.max(0, ...d.svcs.map(x => +String(x.id).split('-')[1] || 0))).padStart(3, '0'), ...rec, created: new Date().toISOString(), createdBy: DATA.user.name }; d.svcs.push(nl); ibAudit(d, 'Handling service recorded: ' + s.code + ' × ' + q + (r.pending ? ' (rate pending)' : ''));
      if (spC('spSupervisor') === 'No' && !r.pending) spCharge(kind, d, nl); }
    spRedraw(s.code + (l ? ' updated.' : ' recorded.' + (r.pending ? ' The rate needs approval before it can be charged.' : spC('spSupervisor') === 'No' ? ' Charge raised.' : ' A supervisor confirms it to raise the charge.'))); },
  spDel(k) { const { kind, d, l } = spGet(k); if (l.charge) return toast('Charged lines cannot be deleted. Reverse it first.'); if (!confirm('Delete ' + l.svc + ' × ' + l.qty + '?')) return; d.svcs = d.svcs.filter(x => x !== l); ibAudit(d, 'Handling service deleted: ' + l.svc); spRedraw('Service line deleted.'); },
  spConfirm(k) { const { kind, d, l } = spGet(k); if (l.charge) return toast('Already charged.'); if (spSt(l) === 'Rate pending') return toast('Approve the rate first.'); if (spC('spSupervisor') === 'Yes' && !spCanSup()) return toast('Only a supervisor can confirm service lines.');
    try { const c = spCharge(kind, d, l); spRedraw(l.svc + ' confirmed. Charge ' + c.id + ' raised for billing.'); } catch (e) { toast(e.message); } },
  spConfirmAll(k) { const [kind, id] = String(k).split('|'), d = spDoc(kind, id); if (spC('spSupervisor') === 'Yes' && !spCanSup()) return toast('Only a supervisor can confirm service lines.'); const L = (d.svcs || []).filter(l => spSt(l) === 'Recorded');
    try { L.forEach(l => spCharge(kind, d, l)); spRedraw(L.length + ' service line' + (L.length === 1 ? '' : 's') + ' confirmed and charged.'); } catch (e) { persist(); route(); toast(e.message); } },
  spRateOk(k) { const { kind, d, l } = spGet(k), s = svcBy(l.svc); if (!can('billing', 'approve')) return toast('Only a user with approve rights in Billing can approve a rate.');
    formModal('Approve rate · ' + l.svc, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(clName(d.client))} has no contract rate for ${esc(s.name)}. Standard rate SAR ${sar(s.rate)} per ${esc(s.unit)}. The approved rate applies to this line only.</p>` }, { id: 'rate', label: 'Approved rate, SAR per ' + (s.unit || 'unit'), type: 'number', min: 0, step: '0.01', value: s.rate, req: 1 }, { id: 'ref', label: 'Customer approval reference', req: 1 }],
      v => { if (!(+v.rate > 0)) throw new Error('Enter the approved rate.'); if (!v.ref) throw new Error('Enter the customer approval reference.'); l.rate = +v.rate; l.amount = +(l.qty * l.rate).toFixed(2); l.rateOk = { by: DATA.user.name, ref: v.ref };
        ibAudit(d, `Rate approved for ${l.svc}: SAR ${sar(l.rate)} (${v.ref})`); if (spC('spSupervisor') === 'No') spCharge(kind, d, l); spRedraw('Rate approved for ' + l.svc + '.'); }, 'Approve rate'); },
  spReverse(k) { const { kind, d, l } = spGet(k), c = DB.charges.find(x => x.id === l.charge); if (c && chgDraft(c)) return toast('This charge is on draft invoice ' + c.bdraft + '. Cancel the draft invoice first.');
    formModal('Reverse ' + l.svc, [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); DB.charges = DB.charges.filter(x => x.id !== l.charge); delete l.charge; delete l.confBy; ibAudit(d, 'Service charge reversed: ' + l.svc + ' · ' + v.why); spRedraw('Charge reversed. The line is back to Recorded.'); }, 'Reverse charge'); }
});

/* ---- exceptions and pending approvals include service lines ---- */
{ const x0 = billExceptions; billExceptions = function () { const X = x0(); spOpenAll().forEach(({ kind, d, l }) => { const st = spSt(l), href = kind === 'in' ? '#' + (d.grn ? 'grn' : 'receiving') + '/edit/' + d.id : '#' + ({ Dispatched: 'dispatch', Picked: 'dispatch', Picking: 'loading', Allocated: 'pick' }[d.status] || 'alloc') + '/edit/' + d.id;
    X.push({ id: 'sp' + d.id + l.id, kind: st === 'Rate pending' ? 'Service rate pending' : 'Service not confirmed', ref: d.id + ' · ' + l.svc, client: d.client, detail: `${svcBy(l.svc).name || l.svc} × ${l.qty} recorded ${fmtDate(l.date)}${st === 'Rate pending' ? ' has no contract rate.' : ' is not charged until confirmed.'}`, act: ['Open', href] }); }); return X; }; }
{ const p0 = rpPending; rpPending = function () { const R = p0(); spOpenAll().filter(x => spSt(x.l) === 'Rate pending').forEach(({ kind, d, l }) => R.push({ id: 'sp' + d.id + l.id, what: 'Handling service rate', ref: d.id + ' · ' + l.svc, client: d.client, since: l.date, days: Math.max(0, rpDays(l.date, iso(today))), href: kind === 'in' ? '#receiving/edit/' + d.id : '#alloc/edit/' + d.id })); return R.sort((a, b) => b.days - a.days); }; }

/* ---- live operations dashboard ---- */
withSaved = function (d) {
  const T = iso(today), tm = iso(addDays(today, 1)), mo = T.slice(0, 7), act = DB.warehouses.filter(w => w.status !== 'Inactive');
  const whs = act.map(w => { const o = rpOccW(w.id); return { name: w.name, capacity: o.c, pallets: o.u }; });
  const sh30 = DB.orders.filter(o => o.dispatchedAt && String(o.dispatchedAt).slice(0, 10) >= iso(addDays(today, -30))), ok = sh30.filter(o => !o.due || String(o.dispatchedAt).slice(0, 10) <= o.due).length;
  const chM = DB.charges.filter(c => String(c.at).slice(0, 7) === mo), unb = DB.charges.filter(bdFree), mix = {}; BE_CATS.forEach(k => mix[k] = sum(chM.filter(c => beCat(c) === k), c => c.amount));
  const flow = [...Array(7)].map((_, i) => { const day = iso(addDays(today, i - 6)), mv = DB.moves.filter(m => String(m.at).slice(0, 10) === day); return { date: day, in: sum(mv.filter(m => ['Receipt', 'Return', 'Transfer in'].includes(m.type) && m.qty > 0), m => m.qty), out: -sum(mv.filter(m => m.type === 'Goods issue'), m => m.qty) }; });
  const Q = [['ASNs to approve', 'Inbound', DB.asns.filter(a => a.status === 'Submitted').length, '#asn'], ['ASNs expected', 'Inbound', DB.asns.filter(a => a.status === 'Approved' && !(a.receipt && a.receipt.status === 'Completed')).length, '#receiving'],
    ['GRNs to approve', 'Inbound', DB.asns.filter(a => (a.qc || {}).status === 'Completed' && a.grnStatus !== 'Approved' && a.status !== 'Cancelled').length, '#grn'], ['Put-away tasks open', 'Inbound', DB.tasks.filter(t => t.status === 'Open').length, '#putaway'],
    ['Orders to approve', 'Outbound', DB.orders.filter(o => o.status === 'Draft').length, '#oborders'], ['Orders to allocate', 'Outbound', DB.orders.filter(o => o.status === 'New').length, '#alloc'], ['Pick lists in progress', 'Outbound', DB.orders.filter(o => o.status === 'Allocated').length, '#pick'], ['To load', 'Outbound', DB.orders.filter(o => o.status === 'Picking').length, '#loading'], ['Ready to dispatch', 'Outbound', DB.orders.filter(o => o.status === 'Picked').length, '#dispatch'],
    ['Bin moves open', 'Inventory', (DB.moveOrders || []).filter(m => m.status === 'Open').length, '#moves'], ['Counts open', 'Inventory', (DB.counts || []).filter(c => c.status === 'Open').length, '#counts'], ['Adjustments to approve', 'Inventory', (DB.adjustments || []).filter(a => a.status === 'Pending').length, '#adjust'], ['Transfers in transit', 'Inventory', (DB.transfers || []).filter(t => t.status === 'In transit').length, '#transfers'],
    ['Returns to approve', 'Returns', (DB.returns || []).filter(r => r.status === 'Requested').length, '#rmareq'], ['Returns to inspect', 'Returns', (DB.returns || []).filter(r => ['Approved', 'Receiving'].includes(r.status)).length, '#rmarecv'],
    ['VAS to approve', 'VAS', (DB.vas || []).filter(v => ['Rate pending', 'Pending approval'].includes(v.status)).length, '#vasreq'], ['VAS work in progress', 'VAS', (DB.vas || []).filter(v => ['Approved', 'In progress', 'On hold'].includes(v.status)).length, '#vaswo'], ['VAS to verify', 'VAS', (DB.vas || []).filter(v => v.status === 'Awaiting verification').length, '#vasdone'],
    ['Service lines to confirm', 'Billing', spOpenAll().length, '#billexc'], ['Billing runs to approve', 'Billing', (DB.bruns || []).filter(r => ['Calculated', 'Approved'].includes(r.status)).length, '#billrun']].filter(q => q[2] > 0).map(([task, module, open, href]) => ({ task, module, open, href }));
  const A = [], al = (level, title, detail) => A.push({ level, title, detail });
  whs.forEach(w => { const p = w.capacity ? Math.round(w.pallets / w.capacity * 100) : 0; if (p > 90) al('High', `${w.name} is ${p}% full`, 'Plan overflow space or slow inbound'); else if (p > 80) al('Medium', `${w.name} is ${p}% full`, 'Approaching capacity'); });
  const late = DB.orders.filter(isLate); if (late.length) al('High', `${late.length} outbound order${late.length === 1 ? '' : 's'} past the requested date`, late.slice(0, 3).map(o => o.id).join(', '));
  const exp = DB.stock.filter(s => s.expiry && s.expiry < T); if (exp.length) al('High', `${exp.length} pallet${exp.length === 1 ? '' : 's'} expired in stock`, 'Move to the expiry bin or dispose · Inventory → Batch & Expiry');
  const soon = DB.stock.filter(s => s.expiry && s.expiry >= T && daysBetween(T, s.expiry) <= SET_EXP_DAYS); if (soon.length) al('Medium', `${soon.length} pallet${soon.length === 1 ? '' : 's'} expire within ${SET_EXP_DAYS} days`, [...new Set(soon.map(s => clName(s.client)))].join(', '));
  const hold = DB.stock.filter(s => ['Hold', 'Damaged'].includes(s.status)); if (hold.length) al('Info', `${hold.length} pallet${hold.length === 1 ? '' : 's'} on hold or damaged`, 'Not available for orders · Inventory → Holds & Quarantine');
  const ctr = DB.contracts.filter(k => ctrState(k) === 'Active' && ctrDaysLeft(k) != null && ctrDaysLeft(k) <= 30); if (ctr.length) al('Medium', `${ctr.length} contract${ctr.length === 1 ? '' : 's'} end within 30 days`, ctr.map(k => clName(k.client)).join(', '));
  const rp = (DB.vas || []).filter(v => v.status === 'Rate pending').length + spOpenAll().filter(x => spSt(x.l) === 'Rate pending').length; if (rp) al('Medium', `${rp} job${rp === 1 ? '' : 's'} waiting for a rate`, 'Work without an agreed rate cannot be billed');
  const old = unb.filter(c => daysBetween(c.at, T) > 45); if (old.length) al('Medium', `${old.length} charge${old.length === 1 ? '' : 's'} unbilled for over 45 days`, 'SAR ' + sar(sum(old, c => c.amount)) + ' · run billing');
  const mat = DB.materials.filter(m => m.status === 'Active' && m.onHand <= m.reorder); if (mat.length) al('Info', `${mat.length} VAS material${mat.length === 1 ? '' : 's'} at reorder level`, mat.map(m => m.name).join(', '));
  const ord = { High: 0, Medium: 1, Info: 2 }; A.sort((a, b) => ord[a.level] - ord[b.level]);
  const rec = DB.orders.filter(o => o.status !== 'Draft').slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || b.id.localeCompare(a.id)).slice(0, 6).map(o => ({ id: o.id, customer: clName(o.client), shipTo: o.customer, warehouse: whRec(o.wh).name, lines: o.lines.filter(l => l.sku).length, units: sum(o.lines, l => +l.qty || 0), due: o.due, status: o.status }));
  return { ...d, customers: DB.customers.filter(c => c.status !== 'Inactive').length, skus: DB.items.filter(i => stockable(i) && i.variant !== 'template').length, pallets: DB.stock.length, units: sum(DB.stock, s => s.qty), warehouses: whs,
    shippedToday: DB.orders.filter(o => String(o.dispatchedAt || '').slice(0, 10) === T).length, dueSoon: DB.orders.filter(o => ['New', 'Allocated', 'Picking', 'Picked'].includes(o.status) && [T, tm].includes(o.due)).length,
    onTime: { ok, total: sh30.length }, revenueMonth: sum(chM, c => c.amount), unbilled: sum(unb, c => c.amount), chargesMonth: chM.length, invoicesIssued: (DB.bdrafts || []).filter(x => x.status !== 'Cancelled').length, overdue: 0, inDrafts: sum(DB.charges.filter(c => chgDraft(c)), c => c.amount),
    revenueMix: mix, flow, queue: Q, alerts: A, orders: rec };
};
kpis = (k0 => function (d) { return k0(d).replace(`${n0(d.onTime.ok)} of ${n0(d.onTime.total)} orders by due date`, `${n0(d.onTime.ok)} of ${n0(d.onTime.total)} orders on time · 30 days`); })(kpis);
billing = (b0 => function (d) { return b0(d).replace('<span>Invoices issued</span>', '<span>Draft invoices</span>').replace(`<span>Overdue, SAR</span><b style="color:${d.overdue ? 'var(--bad)' : 'inherit'}">${sar(d.overdue)}</b>`, `<span>In draft invoices, SAR</span><b>${sar(d.inDrafts)}</b>`); })(billing);
workQueue = (q0 => function (d) { return d.queue.length ? q0(d) : card("Today's work queue", '<div class="empty">Nothing waiting. All work is up to date.</div>'); })(workQueue);

/* ---- top search: one box for customers, items, pallets, documents and charges ---- */
function gSearch(q) {
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const R = [], has = (...x) => x.some(v => String(v || '').toLowerCase().includes(q)), add = (type, label, sub, href, doAct) => R.push({ type, label, sub, href, doAct });
  DB.customers.forEach(c => { if (has(c.id, c.name, c.name2, c.company)) add('Customer', c.name, c.id, '#customers/edit/' + encodeURIComponent(c.id)); });
  DB.items.forEach(i => { if (has(i.sku, i.code, i.name, i.custCode, i.barcode)) add('Item', i.name, (i.code || '') + ' · ' + i.sku + ' · ' + clName(i.client), '#items/edit/' + encodeURIComponent(i.sku)); });
  DB.stock.forEach(s => { if (has(s.lpn, s.batch)) add('Pallet', s.lpn, item(s.sku).name + ' · ' + s.bin + ' · ' + s.status, '', ['invLpn', s.lpn]); });
  DB.asns.forEach(a => { if (has(a.id, a.ref, a.grn, a.container, a.vehicle)) add(a.grn && has(a.grn) ? 'GRN' : 'ASN', a.grn && has(a.grn) ? a.grn : a.id, clName(a.client) + ' · ' + a.status, a.grn && has(a.grn) ? '#grn/edit/' + encodeURIComponent(a.id) : '#asn/edit/' + encodeURIComponent(a.id)); });
  DB.orders.forEach(o => { if (has(o.id, o.ref, o.dn, o.customer)) add(o.dn && has(o.dn) ? 'Delivery note' : 'Outbound order', o.dn && has(o.dn) ? o.dn : o.id, clName(o.client) + ' · ' + (o.customer || '') + ' · ' + o.status, '#oborders/edit/' + encodeURIComponent(o.id)); });
  (DB.returns || []).forEach(r => { if (has(r.id, r.order, r.cref)) add('Return (RMA)', r.id, clName(r.client) + ' · ' + r.status, '#rma/s1/' + encodeURIComponent(r.id)); });
  (DB.vas || []).forEach(v => { if (has(v.id, v.cref, v.type)) add('VAS work order', v.id, clName(v.client) + ' · ' + v.type + ' · ' + v.status, '#vasw/' + encodeURIComponent(v.id)); });
  DB.quotes.forEach(x => { if (has(x.id, x.subject)) add('Quotation', x.id, clName(x.client) + ' · ' + (x.subject || ''), '#quotes/edit/' + encodeURIComponent(x.id)); });
  DB.contracts.forEach(k => { if (has(k.id, k.ref)) add('Contract', k.id, clName(k.client) + ' · ' + ctrState(k), '#contracts/edit/' + encodeURIComponent(k.id)); });
  (DB.bdrafts || []).forEach(x => { if (has(x.id, x.run)) add('Draft invoice', x.id, clName(x.client) + ' · SAR ' + sar(x.total), '#bdrafts/view/' + encodeURIComponent(x.id)); });
  (DB.bruns || []).forEach(x => { if (has(x.id)) add('Billing run', x.id, x.status, '#billrun/view/' + encodeURIComponent(x.id)); });
  DB.charges.forEach(c => { if (has(c.id)) add('Charge', c.id, clName(c.client) + ' · ' + c.type + ' · SAR ' + sar(c.amount), '', ['gChg', c.id]); });
  [['moveOrders', 'Bin move', '#moves'], ['transfers', 'Warehouse transfer', '#transfers'], ['adjustments', 'Adjustment', '#adjust'], ['damages', 'Damage case', '#damage'], ['counts', 'Stock count', '#counts']].forEach(([k, t, h]) => (DB[k] || []).forEach(x => { if (has(x.id)) add(t, x.id, (x.client ? clName(x.client) + ' · ' : '') + (x.status || x.claim || ''), h); }));
  M.services.forEach(s => { if (has(s.code, s.name)) add('Service item', s.name, s.code + ' · SAR ' + sar(s.rate) + ' per ' + s.unit, '#svc/view/' + encodeURIComponent(s.code)); });
  DB.warehouses.forEach(w => { if (has(w.id, w.name)) add('Warehouse', w.name, w.id, '#warehouses/edit/' + encodeURIComponent(w.id)); });
  return R.slice(0, 14);
}
let gsSel = -1;
function gsRender() { const q = $('#q'), box = $('#qRes'); if (!q || !box) return; const R = gSearch(q.value); gsSel = R.length ? 0 : -1;
  box.hidden = q.value.trim().length < 2; box.innerHTML = R.length ? R.map((r, i) => `<button type="button" class="gs-i ${i === gsSel ? 'on' : ''}" data-gs="${i}" role="option"><span class="pill p-mute">${esc(r.type)}</span><span class="gs-t"><b>${esc(r.label)}</b><em>${esc(r.sub || '')}</em></span></button>`).join('') : '<div class="gs-none">No match. Try a code, LPN, ASN, order, RMA, VAS, charge or customer name.</div>'; box._r = R; }
function gsOpen(i) { const box = $('#qRes'), r = box && box._r && box._r[i]; if (!r) return; box.hidden = true; $('#q').value = ''; $('#q').blur(); if (r.doAct) DO[r.doAct[0]](r.doAct[1]); else go(r.href); }
{ const q = $('#q'); if (q) { q.insertAdjacentHTML('afterend', '<div id="qRes" class="gs" role="listbox" hidden></div>'); q.closest('.search').style.position = 'relative';
  q.addEventListener('input', gsRender); q.addEventListener('focus', () => { if (q.value.trim().length >= 2) gsRender(); });
  q.addEventListener('keydown', e => { const box = $('#qRes'), n = (box._r || []).length; if (e.key === 'Escape') { box.hidden = true; return; } if (!n) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); gsSel = (gsSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; box.querySelectorAll('.gs-i').forEach((b, i) => b.classList.toggle('on', i === gsSel)); }
    if (e.key === 'Enter') { e.preventDefault(); gsOpen(Math.max(0, gsSel)); } }); } }
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-gs]'); if (b) return gsOpen(+b.dataset.gs); const box = $('#qRes'); if (box && !e.target.closest('.search')) box.hidden = true; });
DO.gChg = id => { const c = DB.charges.find(x => x.id === id); FILT.chg = { q: id }; go('#charges'); if (c) toast(c.id + ' · ' + c.type + ' · SAR ' + sar(c.amount)); };

/* ---- one-time: give existing GRNs, dispatches and opening stock their links ---- */
function flowBackfill() {
  // sample handling charges are replaced by the real ones the GRNs and dispatches raise
  DB.charges = DB.charges.filter(c => !(c.sample && [FLOW_SVC.in, FLOW_SVC.out, FLOW_SVC.order].includes(c.svc) && bdFree(c)));
  DB.grns.forEach(g => { const a = DB.asns.find(x => x.id === g.asn); if (a) flowChargeGrn(a, g); });
  DB.orders.filter(o => o.status === 'Dispatched' || o.dispatchedAt).forEach(o => flowChargeDispatch(o));
  DB.stock.forEach(s => { if (!DB.moves.some(m => m.lpn === s.lpn && m.qty > 0)) DB.moves.push({ at: String(s.received || iso(today)).slice(0, 10), type: 'Opening stock', ref: 'Opening balance', lpn: s.lpn, sku: s.sku, client: s.client, wh: s.wh, bin: s.bin, qty: s.qty }); });
  DB.moves.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/* ---- customers: billed and unbilled come from the billing engine, not typed-in figures ---- */
const custBilled = id => sum((DB.bdrafts || []).filter(d => d.client === id && d.status !== 'Cancelled'), d => d.total);
const custUnbilled = id => sum(DB.charges.filter(c => c.client === id && bdFree(c)), c => c.amount);
{ const r = CUST_COLS.find(c => c.k === 'recv'), u = CUST_COLS.find(c => c.k === 'unused');
  Object.assign(r, { h: 'Billed (draft invoices), SAR', s: c => custBilled(c.id), v: c => { const exp = custBilled(c.id) + custUnbilled(c.id), over = c.credit && exp > c.credit; return `<b style="color:${over ? 'var(--bad)' : 'inherit'}">${sar(custBilled(c.id))}</b>${over ? `<br><span class="pill p-bad" title="Billed + unbilled SAR ${sar(exp)} is over the SAR ${sar(c.credit)} credit limit">Over limit</span>` : ''}`; } });
  Object.assign(u, { h: 'Unbilled, SAR', s: c => custUnbilled(c.id), v: c => { const x = custUnbilled(c.id); return x ? `<b style="color:var(--warn)">${sar(x)}</b>` : sar(0); } }); }
{ const c0 = customersPage; customersPage = function () { DB.customers.forEach(c => { c.recv = custBilled(c.id); c.unused = custUnbilled(c.id); }); return c0(); }; }
{ const d0 = DO.delCust; DO.delCust = function (id) { const c = client(id), used = [[DB.stock, 'pallet', 'pallets', ' in stock'], [DB.returns || [], 'return', 'returns'], [DB.vas || [], 'VAS work order', 'VAS work orders'], [DB.charges, 'charge', 'charges'], [DB.bdrafts || [], 'draft invoice', 'draft invoices']].map(([l, one, many, tail]) => { const n = l.filter(x => x.client === id).length; return n ? n + ' ' + (n === 1 ? one : many) + (tail || '') : ''; }).filter(Boolean);
  if (used.length) return toast(`${c.name} has ${used.join(', ')}. Set the customer to Inactive instead of deleting.`); return d0.call(this, id); }; }
