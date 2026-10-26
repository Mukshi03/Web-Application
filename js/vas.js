'use strict';
/* =====================================================================
   VALUE-ADDED SERVICES  (ERP: requests → rate / work approval → work order → completion → verification → charge)
   ===================================================================== */
const VAS_PRI = ['Normal', 'High', 'Urgent'];
const VAS_LINK = ['None', 'ASN / receipt', 'Stock (LPN)', 'Outbound order'];
const VAS_CH = ['Email', 'Phone', 'Customer portal', 'WhatsApp', 'Walk-in', 'Internal'];
const VAS_OPTS = [['photo', 'Photo evidence required'], ['qc', 'Quality check after work'], ['custMat', 'Customer supplies the material'], ['notify', 'Notify customer when completed']];
const VAS_REQ_ST = ['Draft', 'Rate pending', 'Pending approval', 'Rejected'], VAS_WO_ST = ['Approved', 'In progress', 'On hold'], VAS_DONE_ST = ['Awaiting verification', 'Completed', 'Cancelled'];
const VAS_ALL_ST = [...VAS_REQ_ST, ...VAS_WO_ST, ...VAS_DONE_ST, 'Billed'];
Object.assign(TONE, { 'Rate pending': 'bad', 'Pending approval': 'warn', 'In progress': 'info', 'On hold': 'warn', 'Awaiting verification': 'warn', Billed: 'good' });
const VAS_DEF = { rateAppr: 'Yes', workAppr: 'Yes' };
const vasC = k => ((DB.vasCfg || {})[k] ?? VAS_DEF[k]) === 'Yes';
const vasW = id => DB.vas.find(v => v.id === id);
const vasHist = (w, what) => ibAudit(w, what);
const vasSvcList = () => M.services.filter(s => s.cat === 'VAS');
const vasSvcOpts = cl => { const k = cl && ctrActive(cl); return vasSvcList().map(s => [s.code, `${s.code} · ${s.name}${k ? (k.lines.some(l => l.code === s.code) ? ' (on contract)' : ' (not on contract)') : ''}`]); };
function vasRateFor(cl, code) { const k = ctrActive(cl), l = k && k.lines.find(x => x.code === code); return l ? { rate: +l.rate, minFee: +l.minFee || 0, material: l.material || 'Included', src: 'Contract ' + k.id, contract: k.id, vat: '0.15' } : null; }
const vasEst = w => w.rs ? Math.max((+w.qty || 0) * w.rs.rate, w.rs.minFee || 0) : null;
const vasCharge = w => w.charge && DB.charges.find(c => c.id === w.charge);
const vasSt = w => w.status === 'Completed' && (vasCharge(w) || {}).invoice ? 'Billed' : w.status;
const vasStage = w => ({ Draft: 'Draft', 'Rate pending': '1 · Rate approval', 'Pending approval': '2 · Work approval', Rejected: 'Rejected', 'Awaiting verification': '4 · Verification', Cancelled: 'Cancelled', Completed: '5 · Completed' }[w.status] || '3 · Work order');
const vasOnHand = (cl, sku) => sum(DB.stock.filter(s => s.client === cl && s.sku === sku), s => s.qty);
const vasHref = w => '#vasw/' + encodeURIComponent(w.id);
const vasSub = w => VAS_REQ_ST.includes(w.status) ? 'vasreq' : VAS_WO_ST.includes(w.status) ? 'vaswo' : 'vasdone';
const vasDue = w => { if (!w.due || ['Completed', 'Cancelled', 'Rejected'].includes(w.status)) return ''; const d = daysBetween(iso(today), w.due); return d < 0 ? `<span class="pill p-bad">Overdue ${-d} day${d === -1 ? '' : 's'}</span>` : d === 0 ? '<span class="pill p-warn">Due today</span>' : ''; };
const vasCols = (x = []) => [['Work order', w => `<b class="mono">${esc(w.id)}</b>${w.cref ? `<br><span class="note">${esc(w.cref)}</span>` : ''}`], ['Customer', w => esc(clName(w.client))], ['Service', w => `<span class="mono note">${esc(w.svc)}</span><br>${esc(svcBy(w.svc).name || w.type)}`], ['Item', w => w.sku ? itemCell(w.sku) : '—'],
  ['Requested', w => n0(w.qty) + ' <span class="note">' + esc(w.unit || '') + '</span>', 1], ['Due', w => fmtDate(w.due) + (w.priority && w.priority !== 'Normal' ? ` <span class="pill p-${w.priority === 'Urgent' ? 'bad' : 'warn'}">${esc(w.priority)}</span>` : '') + ' ' + vasDue(w)], ...x, ['Status', w => pill(vasSt(w))]];
const vasBtn = (l, d, id, cls = '') => `<button type="button" class="btn sm ${cls}" data-do="${d}" data-id="${esc(id)}">${l}</button>`;
const vasHeadActs = () => `<button type="button" class="btn" data-do="vasSettings">Approval settings</button><a class="btn pri" href="#vasreq/new">+ New VAS request</a>`;

/* ---- pages ---- */
function vasDash() {
  const W = DB.vas, c = st => W.filter(w => w.status === st).length, unb = DB.charges.filter(x => !x.invoice && /^VAS/.test(x.type));
  const active = W.filter(w => ['Rate pending', 'Pending approval', 'Approved', 'In progress', 'On hold', 'Awaiting verification'].includes(w.status)).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const low = DB.materials.filter(m => m.status === 'Active' && m.onHand <= m.reorder);
  const K = [['Rate pending', c('Rate pending'), 'vasreq'], ['Waiting for approval', c('Pending approval'), 'vasreq'], ['Approved, not started', c('Approved'), 'vaswo'], ['In progress / on hold', c('In progress') + c('On hold'), 'vaswo'], ['Awaiting verification', c('Awaiting verification'), 'vasdone'], ['Unbilled VAS, SAR', sar(sum(unb, x => x.amount)), 'vasdone']];
  return head2('Value-Added Services', 'VAS dashboard', vasHeadActs())
    + `<div class="rm-flow">${[['1', 'VAS Requests', 'Request, rate check, approval', 'vasreq'], ['2', 'Work Orders', 'Start, hold, record completion', 'vaswo'], ['3', 'Completion & Verification', 'Supervisor check, charge', 'vasdone']].map((x, i) => `${i ? '<i aria-hidden="true">→</i>' : ''}<a class="rm-fb" href="#${x[3]}"><b>${x[0]}</b><span><strong>${x[1]}</strong>${x[2]}</span></a>`).join('')}</div>`
    + `<div class="grid g-kpi">${K.map(k => `<a class="card kpi rm-kpi" href="#${k[2]}"><span>${k[0]}</span><b>${k[1]}</b></a>`).join('')}</div>`
    + (low.length ? `<div class="warnbox"><b>Materials at or below reorder level:</b> ${low.map(m => `<a href="#materials">${esc(m.name)}</a> (${n0(m.onHand)} ${esc(m.unit)})`).join(', ')}</div>` : '')
    + card(`${active.length} open jobs, by due date`, tbl(vasCols([['Est. charge, SAR', w => vasEst(w) == null ? '<span class="pill p-bad">Rate pending</span>' : sar(vasEst(w)), 1]]), active, vasHref, 'No open VAS jobs.'));
}
function vasReqPage() {
  const wait = w => ['Rate pending', 'Pending approval', 'Draft'].includes(w.status) ? 0 : 1, c = st => DB.vas.filter(w => w.status === st).length;
  const rows = applyFilt('vreq', DB.vas.slice().reverse().sort((a, b) => wait(a) - wait(b)), { status: (w, x) => vasSt(w) === x });
  const flow = `Draft → ${vasC('rateAppr') ? '<b>Rate approval</b> (only when there is no contract rate) → ' : ''}${vasC('workAppr') ? '<b>Work approval</b> → ' : ''}Work order → Verification → Charged`;
  return head2('Value-Added Services', 'VAS requests', vasHeadActs())
    + kpis4([['Waiting for rate approval', c('Rate pending')], ['Waiting for work approval', c('Pending approval')], ['Drafts', c('Draft')], ['Approved / in work', DB.vas.filter(w => VAS_WO_ST.includes(w.status)).length], ['Rejected', c('Rejected')]])
    + filterBar('vreq', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(VAS_ALL_ST) }])
    + card(`${rows.length} requests`, tbl(vasCols([['Stage', w => `<span class="note">${esc(vasStage(w))}</span>`], ['Est. charge, SAR', w => vasEst(w) == null ? '—' : sar(vasEst(w)), 1], ['Rate source', w => w.rs ? `<span class="note">${esc(w.rs.src)}</span>` : '<span class="pill p-bad">No contract rate</span>'], ['Requested by', w => esc(w.reqBy || '—')],
      ['', w => `<div class="rowicons">${w.status === 'Rate pending' ? vasBtn('Approve rate', 'vasApproveRate', w.id, 'pri') : w.status === 'Pending approval' ? vasBtn('Approve', 'vasApprove', w.id, 'pri') + vasBtn('Reject', 'vasReject', w.id, 'danger') : w.status === 'Draft' ? `<a class="btn sm" href="#vasreq/edit/${encodeURIComponent(w.id)}">Edit</a>` : ''}</div>`]]), rows, vasHref, 'No VAS requests yet. Use + New VAS request.'))
    + `<p class="note"><b>Approval flow</b>: ${flow}. The system first checks that the stock belongs to the customer and whether the service is on the customer's contract.</p>`;
}
function vasWoPage() {
  const rows = applyFilt('vwo', DB.vas.filter(w => VAS_WO_ST.includes(w.status)).slice().reverse(), {});
  return head2('Value-Added Services', 'Work orders', vasHeadActs()) + filterBar('vwo', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(VAS_WO_ST) }])
    + card(`${rows.length} approved work orders`, tbl(vasCols([['Operator', w => esc(w.operator || '—')], ['', w => `<div class="rowicons">${w.status === 'Approved' ? vasBtn('Start', 'vasStart', w.id, 'pri') : w.status === 'In progress' ? vasBtn('Record completion', 'vasComplete', w.id, 'pri') + vasBtn('Hold', 'vasHold', w.id) : w.status === 'On hold' ? vasBtn('Resume', 'vasResume', w.id, 'pri') : ''}</div>`]]), rows, vasHref, 'No approved work orders.'))
    + `<p class="note">Only approved work orders can start. If the quantity or scope changes, use Amend on the work order: it goes back for approval.</p>`;
}
function vasDonePage() {
  const wait = DB.vas.filter(w => w.status === 'Awaiting verification'), done = applyFilt('vdn', DB.vas.filter(w => ['Completed', 'Cancelled'].includes(w.status)).slice().reverse(), { status: (w, x) => vasSt(w) === x });
  const q = [['Completed', w => `<b>${n0(w.compQty)}</b>`, 1], ['Rejected / pending', w => { const d = (w.qty || 0) - (w.compQty || 0); return d ? `<span style="color:var(--bad)">${n0(w.rejQty || 0)} / ${n0(Math.max(0, d - (w.rejQty || 0)))}</span>` : '0'; }, 1], ['Operator', w => esc(w.operator || '—')]];
  return head2('Value-Added Services', 'Completion & verification', vasHeadActs())
    + card(`${wait.length} waiting for supervisor verification`, tbl(vasCols([...q, ['Charge, SAR', w => w.rs ? sar(w.compQty ? Math.max(w.compQty * w.rs.rate, w.rs.minFee || 0) : 0) : '—', 1], ['', w => `<div class="rowicons">${vasBtn('Verify &amp; charge', 'vasVerify', w.id, 'pri')}${vasBtn('Send back', 'vasSendBack', w.id)}</div>`]]), wait, vasHref, 'Nothing waiting for verification.'))
    + filterBar('vdn', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(['Completed', 'Billed', 'Cancelled']) }])
    + card('Completed and cancelled', tbl(vasCols([...q, ['Verified by', w => esc(w.verifiedBy || '—')], ['Charge', w => { const c = vasCharge(w); return c ? `<span class="mono">${esc(c.id)}</span> · SAR ${sar(c.amount)}${c.invoice ? ' · <span class="mono">' + esc(c.invoice) + '</span>' : ' <span class="pill p-warn">Unbilled</span>'}` : '—'; }]]), done, vasHref, 'None yet.'))
    + `<p class="note">Only the completed quantity verified by a supervisor is charged, at the rate saved on the work order when it was approved. Each work order is charged once. A minimum fee applies only when the contract line has one. Materials are charged only when the rate says "Separate".</p>`;
}

/* ---- request form (full page) ---- */
let vrD = null, vrDup = null;
window.addEventListener('hashchange', () => { vrD = null; });
const vrDocs = (cl, link) => link === 'ASN / receipt' ? DB.asns.filter(a => a.client === cl).slice(-40).map(a => [a.id, a.status]) : link === 'Stock (LPN)' ? DB.stock.filter(s => s.client === cl).slice(0, 80).map(s => [s.lpn, s.sku + ' · ' + s.bin]) : link === 'Outbound order' ? DB.orders.filter(o => o.client === cl && o.status !== 'Cancelled').slice(-40).map(o => [o.id, o.status]) : [];
function vrForm(w) {
  const cl = w.client, k = cl && ctrActive(cl), s = svcBy(w.svc), items = DB.items.filter(i => stockable(i) && i.client === cl && i.variant !== 'template'), whs = DB.warehouses.filter(x => x.status !== 'Inactive');
  const I = (n, v, x = {}) => `<input name="${n}" type="${x.type || 'text'}" value="${esc(v ?? '')}" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} ${x.min != null ? `min="${x.min}"` : ''} ${x.list ? `list="${x.list}"` : ''} ${x.dis ? 'disabled' : ''} autocomplete="off">`;
  const S = (n, list, v, blank) => `<select name="${n}">${blank ? `<option value="">${blank}</option>` : ''}${opt(list.map(([a, b]) => [String(a), b]), String(v ?? ''))}</select>`;
  return `<form id="vrForm" onsubmit="return false">
    ${ibSec2('1 · Customer &amp; service', `<div class="card-b fgrid f3">
      ${fld('Customer', S('client', DB.customers.filter(c => c.status !== 'Inactive').map(c => [c.id, c.name]), cl), 1)}
      ${fld('Contract', `<div class="rm-ro">${k ? `<span class="mono">${esc(k.id)}</span> <span class="pill p-good">Active</span>` : '<span class="pill p-bad">No active contract</span>'}</div>`)}
      ${fld('Customer reference', I('cref', w.cref, { ph: 'PO / email ref.' }))}
      ${fld('Service', S('svc', vasSvcOpts(cl), w.svc, 'Choose…'), 1, 'span2')}${fld('Request channel', S('channel', optA(VAS_CH), w.channel || 'Email'))}
    </div>`)}
    ${ibSec2('2 · Stock &amp; reference', `<div class="card-b fgrid f3">
      ${fld('Item (customer stock)', S('sku', items.map(i => [i.sku, (i.code || i.sku) + ' · ' + i.name]), w.sku, '— Not item specific —'), 0, 'span2')}
      ${fld('Stock on hand', `<div class="rm-ro" id="vr_onhand">—</div>`)}
      ${fld('Related to', S('link', optA(VAS_LINK), w.link || 'None'))}${fld('Related document no.', I('docRef', w.docRef, { ph: 'ASN, LPN or order', list: 'vr_docs', dis: (w.link || 'None') === 'None' }) + '<datalist id="vr_docs"></datalist>')}
      ${fld('Warehouse', S('wh', whs.map(x => [x.id, x.name]), w.wh || (DB.stock.find(x => x.client === cl && (!w.sku || x.sku === w.sku)) || {}).wh || (whs[0] || {}).id))}
    </div>`)}
    ${ibSec2('3 · Quantity &amp; schedule', `<div class="card-b fgrid f3">
      ${fld('Requested quantity', `<div class="vr-in">${I('qty', w.qty, { type: 'number', min: 1 })}<em id="vr_unit">${esc(s.unit || '')}</em></div>`, 1)}
      ${fld('Due date', I('due', w.due || iso(addDays(today, 2)), { type: 'date' }), 1)}${fld('Priority', S('priority', optA(VAS_PRI), w.priority || 'Normal'))}
      ${fld('Requested by', I('reqBy', w.reqBy || DATA.user.name), 1)}${fld('Customer contact', I('contact', w.contact, { ph: 'Name / mobile' }), 0, 'span2')}
    </div>`)}
    ${ibSec2('4 · Instructions', `<div class="card-b fgrid">
      ${fld('Reason / instructions', `<textarea name="reason" rows="3" placeholder="What must be done, e.g. apply Arabic labels on each carton">${esc(w.reason || '')}</textarea>`, 1)}
      ${fld('Special handling notes', `<textarea name="notes" rows="2" placeholder="Optional">${esc(w.notes || '')}</textarea>`)}
      <div class="row" style="gap:4px 20px">${VAS_OPTS.map(([k2, l]) => `<label class="chk"><input type="checkbox" name="opt_${k2}" ${(w.opts || {})[k2] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    </div>`)}
    <div class="err" id="vrErr" role="alert"></div></form>`;
}
function vrRead() { const f = $('#vrForm'); if (!f) return vrD; const v = { ...(vrD || {}) }; f.querySelectorAll('[name]').forEach(x => { if (x.type === 'checkbox') v[x.name] = x.checked; else v[x.name] = x.value.trim(); }); v.opts = {}; VAS_OPTS.forEach(([k]) => { v.opts[k] = !!v['opt_' + k]; delete v['opt_' + k]; }); return v; }
function vrSide(v) {
  const s = svcBy(v.svc), rs = v.svc ? vasRateFor(v.client, v.svc) : null, qty = +v.qty || 0, est = rs ? Math.max(qty * rs.rate, rs.minFee || 0) : null, R = (k, x) => `<div class="rm-row"><span>${k}</span><b>${x}</b></div>`;
  const route = !v.svc ? '—' : !rs && vasC('rateAppr') ? '<span class="pill p-bad">Rate pending</span><p class="note">No contract rate. Commercial approves a rate first.</p>' : vasC('workAppr') ? '<span class="pill p-warn">Pending approval</span><p class="note">A supervisor approves before work starts.</p>' : '<span class="pill p-good">Approved</span><p class="note">Approval is switched off; work can start.</p>';
  const oh = v.sku ? vasOnHand(v.client, v.sku) : 0;
  return `<section class="card"><div class="card-h"><h2>Rate preview</h2></div><div class="card-b">${R('Service', esc(s.code || '—'))}${R('Unit', esc(s.unit || '—'))}${R('Rate', rs ? 'SAR ' + sar(rs.rate) : s.code ? '<span style="color:var(--bad)">No contract rate</span>' : '—')}${R('Standard rate', s.code ? 'SAR ' + sar(s.rate || 0) : '—')}${R('Minimum fee', rs && rs.minFee ? 'SAR ' + sar(rs.minFee) : '—')}${R('Material', rs ? esc(rs.material) : '—')}${R('Rate source', rs ? esc(rs.src) : '—')}
      <div class="rm-tot">${R('Estimated charge', est == null ? '—' : 'SAR ' + sar(est))}${R('VAT 15%', est == null ? '—' : 'SAR ' + sar(est * 0.15))}${R('<b>Total</b>', est == null ? '—' : 'SAR ' + sar(est * 1.15))}</div></div></section>
    <section class="card"><div class="card-h"><h2>Approval route</h2></div><div class="card-b">${route}${v.due && v.due < iso(today) ? '<p class="note" style="color:var(--bad)">Due date is in the past.</p>' : ''}${v.sku && qty && /carton|unit|piece|box/i.test(s.unit || '') && qty > oh ? `<p class="note" style="color:var(--warn)">Requested ${n0(qty)} is more than the ${n0(oh)} on hand.</p>` : ''}</div></section>
    <section class="card"><div class="card-h"><h2>Process</h2></div><ol class="vas-proc"><li>Request</li><li>Rate check</li><li>Approval</li><li>Work in progress</li><li>Supervisor verification</li><li>Charge raised for billing</li></ol></section>`;
}
function vrRefresh() { const v = vrRead(); if (!v) return; vrD = v; const s = svcBy(v.svc), u = $('#vr_unit'); if (u) u.textContent = s.unit || '';
  const oh = $('#vr_onhand'); if (oh) { const st = DB.stock.filter(x => x.client === v.client && x.sku === v.sku); oh.innerHTML = v.sku ? `<b>${n0(sum(st, x => x.qty))}</b> ${esc(item(v.sku).uom || '')} <span class="note">· ${st.length} LPN${st.length === 1 ? '' : 's'}</span>` : '<span class="note">Choose an item</span>'; }
  const dl = $('#vr_docs'), dr = $('#vrForm [name=docRef]'); if (dl) dl.innerHTML = vrDocs(v.client, v.link).map(([a, b]) => `<option value="${esc(a)}">${esc(b)}</option>`).join(''); if (dr) { dr.disabled = v.link === 'None'; if (dr.disabled) dr.value = ''; }
  const sd = $('#vrSide'); if (sd) sd.innerHTML = vrSide(v); }
function vasReqForm(editId) {
  CUR = { mod: 'vas', sub: 'vasreq' };
  const ex = editId && vasW(editId); if (editId && (!ex || ex.status !== 'Draft')) return head2('Value-Added Services', 'Cannot edit', '<a class="btn" href="#vasreq">← VAS requests</a>') + `<div class="card empty">${ex ? 'Only drafts can be edited. Use Amend on the work order.' : 'This request no longer exists.'}</div>`;
  const key = editId || 'new'; if (!vrD || vrD.key !== key) { vrD = ex ? JSON.parse(JSON.stringify(ex)) : vrDup ? { ...vrDup } : { client: (DB.customers[0] || {}).id }; vrDup = null; vrD.key = key; }
  setTimeout(vrRefresh, 0);
  return head2('<a href="#vasreq" style="color:inherit">Value-Added Services · VAS requests</a>', editId ? 'Edit VAS request · ' + esc(editId) : 'New VAS request', `<a class="btn" href="${editId ? '#vasw/' + encodeURIComponent(editId) : '#vasreq'}">Cancel</a><button type="button" class="btn" data-do="vasReqSave" data-id="draft">Save as draft</button><button type="button" class="btn pri" data-do="vasReqSave" data-id="submit">Submit request</button>`)
    + `<p class="note" style="margin:0">The request is checked against the customer's contract. Work starts only after approval.</p><div class="rm-doc"><div class="rm-main">${vrForm(vrD)}</div><aside class="rm-side" id="vrSide"></aside></div>`;
}
document.addEventListener('change', e => { const f = e.target.closest && e.target.closest('#vrForm'); if (!f) return;
  if (e.target.name === 'client') { const v = vrRead(); Object.assign(vrD, v, { svc: '', sku: '', docRef: '', wh: '' }); route(); return; }
  if (e.target.name === 'sku') { const st = DB.stock.find(x => x.client === vrRead().client && x.sku === e.target.value); if (st) { const ws = f.querySelector('[name=wh]'); if (ws) ws.value = st.wh; } }
  vrRefresh(); });
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#vrForm') && ['qty', 'due'].includes(e.target.name)) vrRefresh(); });

/* ---- work order page ---- */
function vasView(id) {
  const w = vasW(id); if (!w) return head2('Value-Added Services', 'Not found', '<a class="btn" href="#vas">← VAS dashboard</a>') + '<div class="card empty">This VAS work order no longer exists.</div>';
  CUR = { mod: 'vas', sub: vasSub(w) };
  const s = svcBy(w.svc), c = vasCharge(w), it = w.sku ? item(w.sku) : null, st = vasSt(w), k = ctrActive(w.client), est = vasEst(w), oh = it ? vasOnHand(w.client, w.sku) : null;
  const steps = ['Requested', 'Rate', 'Approved', 'In progress', 'Verification', 'Completed', 'Billed'], at = { Draft: 0, 'Rate pending': 1, 'Pending approval': 1, Approved: 2, 'In progress': 3, 'On hold': 3, 'Awaiting verification': 4, Completed: 6, Billed: 7 }[st], stop = ['Cancelled', 'Rejected'].includes(w.status);
  const kv = (l, v, cls) => `<div><span>${l}</span><b class="${cls || ''}">${v == null || v === '' ? '—' : v}</b></div>`;
  const back = { vasreq: ['#vasreq', 'VAS requests'], vaswo: ['#vaswo', 'Work orders'], vasdone: ['#vasdone', 'Completion & verification'] }[vasSub(w)];
  const L = [['Print job sheet', 'vasPrint'], ['Duplicate', 'vasDup']], R = [];
  if (w.status === 'Draft') { L.push(['Delete', 'vasDelDraft', 'danger']); R.push(['Edit &amp; submit', 'vasEditDraft', 'pri']); }
  if (['Approved', 'In progress', 'On hold', 'Pending approval'].includes(w.status)) R.push(['Amend', 'vasAmend']);
  if (!['Completed', 'Cancelled', 'Rejected', 'Draft', 'Awaiting verification'].includes(w.status)) R.push(['Cancel work order', 'vasCancel', 'danger']);
  if (w.status === 'Rate pending') R.push(['Approve rate', 'vasApproveRate', 'pri']);
  if (w.status === 'Pending approval') R.push(['Reject', 'vasReject', 'danger'], ['Approve', 'vasApprove', 'pri']);
  if (w.status === 'Approved') R.push(['Start work', 'vasStart', 'pri']);
  if (w.status === 'In progress') R.push(['Hold', 'vasHold'], ['Record completion', 'vasComplete', 'pri']);
  if (w.status === 'On hold') R.push(['Resume', 'vasResume', 'pri']);
  if (w.status === 'Awaiting verification') R.push(['Send back', 'vasSendBack'], ['Verify &amp; charge', 'vasVerify', 'pri']);
  const B = ([l, d, cls]) => `<button type="button" class="btn ${cls || ''}" data-do="${d}" data-id="${esc(w.id)}">${l}</button>`;
  return head2(`<a href="${back[0]}" style="color:inherit">Value-Added Services · ${back[1]}</a>`, 'VAS work order ' + esc(w.id), `<a class="btn" href="${back[0]}">← ${back[1]}</a>`)
    + `<section class="card card-b vas-hero"><div class="vas-hd"><div><div class="vas-name">${esc(s.name || w.type)}</div><div class="row" style="gap:6px;margin-top:6px">${pill(st)}<span class="pill p-${w.priority === 'Urgent' ? 'bad' : w.priority === 'High' ? 'warn' : 'mute'}">${esc(w.priority || 'Normal')} priority</span>${vasDue(w)}${w.rs ? `<span class="pill p-mute">${esc(w.rs.src)}</span>` : '<span class="pill p-bad">No contract rate</span>'}</div></div>
      <div class="rm-cust"><span>Customer</span><b>${esc(clName(w.client))}</b><span>${k ? 'Contract ' + esc(k.id) : 'No active contract'}${w.cref ? ' · Ref. ' + esc(w.cref) : ''}</span></div></div>
      ${stop ? `<div class="warnbox" style="margin-top:12px">${esc(w.status)}. ${esc(((w.audit || []).slice().reverse().find(h => /^(Cancelled|Rejected)/.test(h.action)) || {}).action || '')}</div>` : `<ol class="vas-steps">${steps.map((x, i) => `<li class="${i < at ? 'ok' : i === at ? 'cur' : ''}"><i>${i < at ? '✓' : i + 1}</i><span>${x}</span></li>`).join('')}</ol>`}
      <div class="grid g-kpi" style="margin-top:12px">${[['Requested', n0(w.qty), esc(w.unit || '')], ['Completed', w.compQty != null ? n0(w.compQty) : '—', w.compQty == null ? 'Not recorded yet' : n0(w.rejQty || 0) + ' rejected'], [c ? 'Charged' : 'Estimated charge', c ? sar(c.amount) : est == null ? '—' : sar(est), 'SAR, ex VAT'], ['Due', w.due ? fmtDate(w.due) : '—', esc(w.priority || 'Normal')]].map(x => `<div class="kpi vas-kpi"><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></div>`).join('')}</div></section>
    <div class="grid g-2">
      ${ibSec2('Request details', `<div class="card-b dl">${kv('Service', `<span class="mono">${esc(w.svc)}</span> · ${esc(s.name || w.type)}`)}${kv('Category', esc(s.cat || 'VAS'))}${kv('Request channel', esc(w.channel || ''))}${kv('Requested by', esc(w.reqBy))}${kv('Customer contact', esc(w.contact || ''))}${kv('Created', w.created ? fmtDate(w.created) : '')}${kv('Approved by', esc(w.approvedBy || ''))}</div>`)}
      ${ibSec2('Item &amp; stock', `<div class="card-b dl">${kv('Item', it ? esc(it.name) : 'Not item specific')}${kv('SKU / code', it ? esc((it.code || '') + ' · ' + w.sku) : '', 'mono')}${kv('Stock on hand', oh == null ? '' : n0(oh) + ' ' + esc(it.uom || ''))}${kv('Warehouse', w.wh ? esc(whRec(w.wh).name) : '')}${kv('Related to', esc(w.link && w.link !== 'None' ? w.link : ''))}${kv('Document no.', esc(w.docRef || ''), 'mono')}${kv('Temperature', it ? esc(it.temp || '') : '')}</div>`)}
      ${ibSec2('Rate &amp; billing', `<div class="card-b dl">${kv('Rate', w.rs ? 'SAR ' + sar(w.rs.rate) + ' per ' + esc(w.unit) : '<span style="color:var(--bad)">Rate pending</span>')}${kv('Standard rate', 'SAR ' + sar(s.rate || 0))}${kv('Minimum fee', w.rs && w.rs.minFee ? 'SAR ' + sar(w.rs.minFee) : '')}${kv('Material', w.rs ? esc(w.rs.material) : '')}${kv('Rate source', w.rs ? esc(w.rs.src + (w.rs.ref ? ' · ' + w.rs.ref : '')) : '')}${kv('VAT', '15%')}${kv('Charge', c ? `<span class="mono">${esc(c.id)}</span> · SAR ${sar(c.amount)}` : 'Raised after verification')}${kv('Invoice', c ? (c.invoice ? `<span class="mono">${esc(c.invoice)}</span>` : 'Unbilled') : '')}</div>`)}
      ${ibSec2('Execution', `<div class="card-b dl">${kv('Operator', esc(w.operator || ''))}${kv('Started', esc((w.startedAt || '').replace('T', ' ')))}${kv('Completed', esc((w.completedAt || '').replace('T', ' ')))}${kv('Completed / rejected', w.compQty != null ? n0(w.compQty) + ' / ' + n0(w.rejQty || 0) : '')}${kv('Variance reason', esc(w.varReason || ''))}${kv('Materials used', (w.materials || []).map(x => esc(matBy(x.code).name || x.code) + ' × ' + n0(x.qty)).join(', '))}${kv('Evidence', esc(w.evidence || ''))}${kv('Verified by', esc(w.verifiedBy ? w.verifiedBy + ' · ' + fmtDate(w.verifiedAt) : ''))}</div>`)}
    </div>
    ${ibSec2('Reason / instructions', `<div class="card-b"><p style="margin:0 0 8px;white-space:pre-wrap">${esc(w.reason || '—')}</p>${w.notes ? `<p class="note" style="margin:0 0 8px"><b>Special handling:</b> ${esc(w.notes)}</p>` : ''}<div class="row" style="gap:6px">${VAS_OPTS.map(([k2, l]) => `<span class="pill p-${(w.opts || {})[k2] ? 'info' : 'mute'}">${(w.opts || {})[k2] ? '✓ ' : ''}${l}</span>`).join('')}</div></div>`)}
    ${ibSec2('History', `<ul class="rm-tl">${(w.audit || []).slice().reverse().map(h => `<li><b>${esc(h.action)}</b><span>${fmtDate(String(h.at).slice(0, 10))} ${String(h.at).slice(11, 16)} · ${esc(h.by)}</span></li>`).join('') || '<li><span>No history.</span></li>'}</ul>`)}
    <div class="form-foot"><div class="row" style="margin-right:auto">${L.map(B).join('')}</div>${R.map(B).join('')}</div>`;
}
function vasShow(page, mode, id) {
  if (page === 'vasw') return vasView(mode);
  if (mode === 'new' || (page === 'vasreq' && mode === 'edit')) { if (page !== 'vasreq') { setTimeout(() => go('#vasreq/new'), 0); return ''; } return vasReqForm(mode === 'edit' ? id : ''); }
  CUR = { mod: 'vas', sub: page };
  return { vas: vasDash, vasreq: vasReqPage, vaswo: vasWoPage, vasdone: vasDonePage }[page]();
}

/* ---- actions ---- */
const vasUsers = () => M.users.map(u => [u.name, u.name]);
Object.assign(DO, {
  vasReqSave(mode) { const v = vrRead(), box = $('#vrErr'); try {
    if (!v.client) throw new Error('Choose the customer.'); const s = svcBy(v.svc); if (!v.svc || !s.code) throw new Error('Choose the service.');
    const qty = +v.qty, draft = mode === 'draft';
    if (v.qty !== '' && !(qty > 0 && Number.isInteger(qty))) throw new Error('Enter the requested quantity as a whole number above 0.');
    if (!draft) { if (!(qty > 0)) throw new Error('Enter the requested quantity.'); if (!v.due) throw new Error('Enter the due date.'); if (!v.reqBy) throw new Error('Enter who requested the service.'); if (!v.reason) throw new Error('Enter the reason / instructions.'); }
    if (v.sku && item(v.sku).client !== v.client) throw new Error("That item belongs to another customer. VAS can only be done on the customer's own stock.");
    if (v.link === 'Stock (LPN)' && v.docRef) { const st = lpnBy(v.docRef.toUpperCase()); if (!st) throw new Error('LPN ' + v.docRef + ' not found.'); if (st.client !== v.client) throw new Error(st.lpn + ' belongs to another customer.'); v.docRef = st.lpn; }
    if (v.link === 'ASN / receipt' && v.docRef && !DB.asns.some(a => a.id === v.docRef && a.client === v.client)) throw new Error('ASN ' + v.docRef + ' is not one of this customer\'s ASNs.');
    if (v.link === 'Outbound order' && v.docRef && !DB.orders.some(o => o.id === v.docRef && o.client === v.client)) throw new Error('Order ' + v.docRef + ' is not one of this customer\'s orders.');
    if (!draft && v.link !== 'None' && !v.docRef) throw new Error('Enter the related document number, or set Related to = None.');
    const rs = vasRateFor(v.client, s.code) || (vasC('rateAppr') ? null : { rate: +s.rate || 0, minFee: 0, material: 'Included', src: 'Standard rate (rate approval off)', contract: '', vat: '0.15' });
    const loc = (v.wh && whRec(v.wh).loc) || 'JED';
    const data = { loc, wh: v.wh, client: v.client, cref: v.cref, channel: v.channel, svc: s.code, type: s.name, sku: v.sku, link: v.link, docRef: v.link === 'None' ? '' : v.docRef, qty: qty || 0, unit: s.unit, due: v.due, priority: v.priority || 'Normal', reqBy: v.reqBy, contact: v.contact, reason: v.reason, notes: v.notes, opts: v.opts, rs };
    const ed = vrD && vrD.key !== 'new' ? vasW(vrD.key) : null; let w = ed;
    if (w) Object.assign(w, data); else { w = { id: docNoL('VAS', loc), created: iso(today), audit: [], ...data }; DB.vas.push(w); }
    if (draft) { w.status = 'Draft'; vasHist(w, ed ? 'Draft updated' : 'Saved as draft'); }
    else { w.status = rs ? (vasC('workAppr') ? 'Pending approval' : 'Approved') : 'Rate pending'; if (w.status === 'Approved') w.approvedBy = DATA.user.name + ' (auto)'; vasHist(w, 'Requested' + (rs ? ' at ' + rs.src + ' rate SAR ' + sar(rs.rate) : ' — no contract rate, sent to Rate pending')); }
    persist(); vrD = null; toast(w.id + (draft ? ' saved as draft.' : w.status === 'Rate pending' ? ' created. No contract rate for this service: waiting for rate approval.' : w.status === 'Approved' ? ' created and approved.' : ' submitted for approval.')); go(vasHref(w));
  } catch (e) { if (box) { box.textContent = e.message; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } toast(e.message); } },
  vasEditDraft(id) { go('#vasreq/edit/' + encodeURIComponent(id)); },
  vasDelDraft(id) { const w = vasW(id); if (w.status !== 'Draft') return toast('Only drafts can be deleted.'); if (!confirm('Delete draft ' + id + '?')) return; DB.vas = DB.vas.filter(x => x !== w); persist(); toast(id + ' deleted.'); go('#vasreq'); },
  vasDup(id) { const w = JSON.parse(JSON.stringify(vasW(id))); ['id', 'status', 'audit', 'approvedBy', 'operator', 'startedAt', 'compQty', 'rejQty', 'varReason', 'materials', 'evidence', 'completedAt', 'completedBy', 'verifiedBy', 'verifiedAt', 'charge', 'rs'].forEach(k => delete w[k]);
    w.due = iso(addDays(today, 2)); w.reqBy = DATA.user.name; vrDup = w; vrD = null; go('#vasreq/new'); },
  vasApproveRate(id) { const w = vasW(id); if (w.status !== 'Rate pending') return toast('This work order is not waiting for a rate.'); const s = svcBy(w.svc);
    formModal('Approve rate · ' + id, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(clName(w.client))} has no contract rate for ${esc(s.name)}. Standard rate: SAR ${sar(s.rate)} per ${esc(s.unit)}. The approved rate is saved on this work order only; add it to the contract by amendment for future jobs.</p>` },
      { id: 'rate', label: 'Approved rate, SAR per ' + s.unit, type: 'number', min: 0, step: '0.01', value: s.rate, req: 1 }, { id: 'minFee', label: 'Minimum fee, SAR', type: 'number', min: 0, step: '0.01', value: 0 }, { id: 'material', label: 'Material', type: 'select', options: [['Included', 'Included in the rate'], ['Separate', 'Charged separately']] }, { id: 'ref', label: 'Customer approval reference (email, PO)', req: 1 }],
      v => { if (!(+v.rate > 0)) throw new Error('Enter the approved rate.'); if (!v.ref) throw new Error('Enter the customer approval reference.');
        w.rs = { rate: +v.rate, minFee: +v.minFee || 0, material: v.material, src: 'Approved exception rate', contract: '', vat: '0.15', by: DATA.user.name, ref: v.ref };
        w.status = vasC('workAppr') ? 'Pending approval' : 'Approved'; if (w.status === 'Approved') w.approvedBy = DATA.user.name; vasHist(w, 'Rate approved: SAR ' + sar(w.rs.rate) + ' (' + v.ref + ')'); invDone(id + ' rate approved.'); }, 'Approve rate'); },
  vasApprove(id) { const w = vasW(id); if (w.status !== 'Pending approval') return toast('Not waiting for approval.'); w.status = 'Approved'; w.approvedBy = DATA.user.name; vasHist(w, 'Approved'); persist(); route(); toast(id + ' approved. The warehouse can start the work.'); },
  vasReject(id) { formModal('Reject ' + id, [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); const w = vasW(id); w.status = 'Rejected'; vasHist(w, 'Rejected: ' + v.why); invDone(id + ' rejected.'); }, 'Reject'); },
  vasStart(id) { const w = vasW(id); if (w.status !== 'Approved') return toast('Only approved work orders can start.');
    formModal('Start ' + id, [{ id: 'op', label: 'Operator', type: 'select', options: vasUsers(), value: DATA.user.name }], v => { w.status = 'In progress'; w.operator = v.op; w.startedAt = new Date().toISOString().slice(0, 16); vasHist(w, 'Started by ' + v.op); invDone(id + ' started.'); }, 'Start work'); },
  vasHold(id) { formModal('Put ' + id + ' on hold', [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); const w = vasW(id); w.status = 'On hold'; vasHist(w, 'On hold: ' + v.why); invDone(id + ' on hold.'); }, 'Hold'); },
  vasResume(id) { const w = vasW(id); w.status = w.startedAt ? 'In progress' : 'Approved'; vasHist(w, 'Resumed'); persist(); route(); toast(id + ' resumed.'); },
  vasCancel(id) { const w = vasW(id); if (['Completed', 'Cancelled'].includes(w.status)) return toast(w.status === 'Completed' ? 'Completed work is reversed with a credit note, not cancelled.' : 'Already cancelled.');
    formModal('Cancel ' + id, [{ type: 'html', html: '<p class="note" style="margin:0">A cancelled work order is never charged.</p>' }, { id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); w.status = 'Cancelled'; vasHist(w, 'Cancelled: ' + v.why); invDone(id + ' cancelled.'); }, 'Cancel work order'); },
  vasAmend(id) { const w = vasW(id); if (!['Approved', 'In progress', 'On hold', 'Pending approval'].includes(w.status)) return toast('Only open work orders can be amended.');
    formModal('Amend ' + id, [{ id: 'qty', label: 'New requested quantity', type: 'number', min: 1, value: w.qty, req: 1 }, { id: 'due', label: 'Due date', type: 'date', value: w.due }, { id: 'why', label: 'Reason for the change', type: 'textarea', req: 1 }],
      v => { if (!(+v.qty > 0) || !Number.isInteger(+v.qty)) throw new Error('Enter the new quantity as a whole number.'); if (!v.why) throw new Error('Enter the reason.'); const old = w.qty; w.qty = +v.qty; w.due = v.due; vasHist(w, `Amended: ${old} → ${w.qty}. ${v.why}`);
        if (vasC('workAppr')) { w.status = 'Pending approval'; vasHist(w, 'Sent back for approval after amendment'); } invDone(id + ' amended' + (vasC('workAppr') ? ' and sent for approval.' : '.')); }, 'Save amendment'); },
  vasComplete(id) { const w = vasW(id); if (w.status !== 'In progress') return toast('Only work in progress can be completed.'); const mats = DB.materials.filter(m => m.status === 'Active').map(m => [m.code, `${m.code} · ${m.name} (${n0(m.onHand)} ${m.unit})`]);
    formModal('Record completion · ' + id, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(svcBy(w.svc).name)} · requested ${n0(w.qty)} ${esc(w.unit)}. A supervisor verifies the quantities before anything is charged.</p>` }, { id: 'comp', label: 'Completed quantity', type: 'number', min: 0, value: w.qty, req: 1 }, { id: 'rej', label: 'Rejected quantity', type: 'number', min: 0, value: 0 }, { id: 'op', label: 'Operator', type: 'select', options: vasUsers(), value: w.operator || DATA.user.name }, { id: 'ev', label: 'Evidence (photo / signed sheet ref.)' + ((w.opts || {}).photo ? ' *' : '') },
      { id: 'm1', label: 'Material used 1', type: 'select', blank: 1, options: mats }, { id: 'q1', label: 'Quantity', type: 'number', min: 0 }, { id: 'm2', label: 'Material used 2', type: 'select', blank: 1, options: mats }, { id: 'q2', label: 'Quantity', type: 'number', min: 0 }, { id: 'why', label: 'Reason for any difference', type: 'textarea' }],
      v => { const comp = +v.comp, rej = +v.rej || 0; if (v.comp === '' || !(comp >= 0) || !Number.isInteger(comp) || !Number.isInteger(rej) || rej < 0) throw new Error('Enter the completed and rejected quantities as whole numbers.');
        if (comp + rej > w.qty) throw new Error('Completed plus rejected cannot exceed the requested ' + w.qty + '.'); if (comp + rej < w.qty && !v.why) throw new Error('Enter the reason for the difference (' + (w.qty - comp - rej) + ' not done).'); if (rej && !v.why) throw new Error('Enter the reason for the rejected quantity.');
        if ((w.opts || {}).photo && !v.ev) throw new Error('This job needs photo evidence. Enter the photo / sheet reference.');
        if (v.m1 && v.m1 === v.m2) throw new Error('Choose each material once.');
        const materials = [[v.m1, v.q1], [v.m2, v.q2]].filter(([m, q]) => m && +q > 0).map(([code, q]) => { const m = matBy(code); if (+q > m.onHand) throw new Error(m.name + ': only ' + n0(m.onHand) + ' ' + m.unit + ' on hand.'); return { code, qty: +q }; });
        Object.assign(w, { compQty: comp, rejQty: rej, varReason: v.why, operator: v.op, materials, evidence: v.ev, completedAt: new Date().toISOString().slice(0, 16), completedBy: DATA.user.name, status: 'Awaiting verification' });
        vasHist(w, `Completion recorded: ${comp} done, ${rej} rejected${comp + rej < w.qty ? ', ' + (w.qty - comp - rej) + ' pending' : ''}`); invDone(id + ' sent for supervisor verification.'); }, 'Submit for verification'); },
  vasSendBack(id) { formModal('Send ' + id + ' back', [{ id: 'why', label: 'What needs correcting', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); const w = vasW(id); w.status = 'In progress'; vasHist(w, 'Sent back by supervisor: ' + v.why); invDone(id + ' sent back to the operator.'); }, 'Send back'); },
  vasVerify(id) { const w = vasW(id); if (w.status !== 'Awaiting verification') return toast('Not waiting for verification.'); if (w.charge) return toast('This work order has already been charged.'); const rs = w.rs; if (!rs) return toast('No approved rate on this work order.');
    const short = (w.materials || []).find(x => matBy(x.code).onHand < x.qty); if (short) return toast(matBy(short.code).name + ': not enough on hand any more. Send the job back to correct the materials.');
    const at = iso(today); (w.materials || []).forEach(x => { const m = matBy(x.code); m.onHand -= x.qty; DB.matMoves.push({ at: nowStamp(), code: x.code, type: 'Used on VAS', ref: w.id, qty: -x.qty, by: DATA.user.name }); matLog(m, 'Used ' + x.qty + ' ' + m.unit + ' on ' + w.id); });
    if (w.compQty > 0) { const base = +(w.compQty * rs.rate).toFixed(2), amt = Math.max(base, rs.minFee || 0);
      const c = { id: seqNo('CHG', 'CHG-', 5), at, client: w.client, type: 'VAS: ' + (svcBy(w.svc).name || w.type), svc: w.svc, ref: w.id, qty: w.compQty, rate: rs.rate, amount: +amt.toFixed(2), note: 'per ' + (w.unit || 'unit') + (amt > base ? ' · minimum fee applied' : '') + ' · ' + rs.src, invoice: '' }; DB.charges.push(c); w.charge = c.id; }
    if (rs.material === 'Separate') (w.materials || []).forEach(x => { const m = matBy(x.code); if (m.charge) DB.charges.push({ id: seqNo('CHG', 'CHG-', 5), at, client: w.client, type: 'VAS material: ' + m.name, svc: '', ref: w.id, qty: x.qty, rate: m.charge, amount: +(x.qty * m.charge).toFixed(2), note: 'per ' + m.unit, invoice: '', material: 1 }); });
    w.status = 'Completed'; w.verifiedBy = DATA.user.name; w.verifiedAt = at; vasHist(w, 'Verified' + (w.charge ? ' and charged (' + w.charge + ')' : ' — nothing completed, no charge'));
    persist(); route(); toast(id + ' verified.' + (w.charge ? ' Charge ' + w.charge + ' raised for billing.' : '')); },
  vasSettings() { formModal('VAS approval settings', [{ id: 'rateAppr', label: 'A job with no contract rate waits for rate approval', type: 'select', options: [['Yes', 'Yes — Rate pending until a rate is approved'], ['No', 'No — use the standard service rate']], value: vasC('rateAppr') ? 'Yes' : 'No' },
    { id: 'workAppr', label: 'Work orders need approval before work starts', type: 'select', options: [['Yes', 'Yes'], ['No', 'No — approved on submit']], value: vasC('workAppr') ? 'Yes' : 'No' }], v => { DB.vasCfg = { ...v }; invDone('VAS approval settings saved.'); }); },
  vasPrint(id) { const w = vasW(id), s = svcBy(w.svc), it = w.sku ? item(w.sku) : null, r = (a, b) => `<tr><th>${a}</th><td>${b || '—'}</td></tr>`;
    modal('VAS job sheet ' + esc(w.id), `<div class="rm-print"><div class="rm-ph"><div><h3>VAS Job Sheet</h3><div class="note">${esc(DATA.company)}</div></div><div style="text-align:right"><b class="mono">${esc(w.id)}</b><div class="note">${esc(w.status)}</div></div></div>
      <h4 class="vas-ph">Request</h4><table class="rm-pt vas-pt">${r('Customer', esc(clName(w.client)))}${r('Customer reference', esc(w.cref))}${r('Service', esc(w.svc + ' · ' + (s.name || w.type)))}${r('Item', it ? esc((it.code || w.sku) + ' · ' + it.name) : '')}${r('Related document', esc((w.link && w.link !== 'None' ? w.link + ' ' : '') + (w.docRef || '')))}${r('Warehouse', w.wh ? esc(whRec(w.wh).name) : '')}${r('Requested quantity', n0(w.qty) + ' ' + esc(w.unit || ''))}${r('Due date · priority', fmtDate(w.due) + ' · ' + esc(w.priority || 'Normal'))}${r('Requested by', esc(w.reqBy))}</table>
      <h4 class="vas-ph">Instructions</h4><table class="rm-pt vas-pt">${r('Reason / instructions', esc(w.reason))}${r('Special handling', esc(w.notes))}${r('Requirements', VAS_OPTS.filter(([k]) => (w.opts || {})[k]).map(x => x[1]).join(', '))}</table>
      <h4 class="vas-ph">Completion (filled by operator)</h4><table class="rm-pt vas-pt">${r('Completed quantity', w.compQty != null ? n0(w.compQty) : '')}${r('Rejected quantity', w.rejQty ? n0(w.rejQty) : '')}${r('Materials used', (w.materials || []).map(x => x.code + ' × ' + x.qty).join(', '))}${r('Start / finish time', '')}${r('Remarks', '')}</table>
      <div class="rm-sig"><div>Operator</div><div>Supervisor</div><div>Customer</div></div></div>`, `<button type="button" class="btn" data-do="mClose">Close</button><button type="button" class="btn pri" data-do="vasPrintGo" data-id="${esc(id)}">Print</button>`, 'lpn-modal'); },
  vasPrintGo(id) { const w = vasW(id); vasHist(w, 'Job sheet printed'); persist(); DO.rmaPrint(); }
});

/* ---- first-run data: VAS jobs at each stage ---- */
function seedVas() {
  if (!DB.vas) DB.vas = []; if (!DB.charges) DB.charges = []; if (DB.vas.length) return;
  const mk = (cl, svc, sku, qty, days, status, extra = {}) => { const s = svcBy(svc), st = DB.stock.find(x => x.client === cl && x.sku === sku), wh = st ? st.wh : 'WH-JED-01', created = iso(addDays(today, -days)), rs = vasRateFor(cl, svc);
    const w = { id: docNoL('VAS', whRec(wh).loc), loc: whRec(wh).loc, wh, client: cl, cref: 'PO-' + (8200 + DB.vas.length), channel: 'Email', svc, type: s.name, sku, link: st ? 'Stock (LPN)' : 'None', docRef: st ? st.lpn : '', qty, unit: s.unit, due: iso(addDays(today, 5 - days)), priority: days > 3 ? 'High' : 'Normal', reqBy: 'Noura Al-Otaibi', contact: primaryContact(client(cl)).name || '', reason: extra.reason || '', notes: '', opts: { qc: true, notify: true }, rs, created, audit: [], status };
    const A = (d, a, by = 'Noura Al-Otaibi') => w.audit.push({ at: iso(addDays(today, -d)) + 'T' + String(9 + w.audit.length).padStart(2, '0') + ':10:00', action: a, by });
    A(days, 'Requested' + (rs ? ' at ' + rs.src + ' rate SAR ' + sar(rs.rate) : ' — no contract rate, sent to Rate pending'));
    if (!['Rate pending', 'Pending approval'].includes(status)) { if (!rs) { w.rs = { rate: s.rate, minFee: 0, material: 'Included', src: 'Approved exception rate', contract: '', vat: '0.15', ref: 'Email ' + fmtDate(created) }; A(days, 'Rate approved: SAR ' + sar(s.rate), 'Hamza Kadenja'); } w.approvedBy = 'Hamza Kadenja'; A(days - 1 < 0 ? 0 : days - 1, 'Approved', 'Hamza Kadenja'); }
    if (['In progress', 'Awaiting verification', 'Completed'].includes(status)) { w.operator = 'Khalid Mansour'; w.startedAt = iso(addDays(today, -Math.max(0, days - 1))) + 'T10:00'; A(Math.max(0, days - 1), 'Started by Khalid Mansour', 'Khalid Mansour'); }
    if (['Awaiting verification', 'Completed'].includes(status)) { Object.assign(w, { compQty: qty, rejQty: 0, materials: extra.mat || [], evidence: 'IMG-' + (4400 + DB.vas.length), completedAt: iso(addDays(today, -Math.max(0, days - 2))) + 'T15:30', completedBy: 'Khalid Mansour' }); A(Math.max(0, days - 2), `Completion recorded: ${qty} done, 0 rejected`, 'Khalid Mansour'); }
    DB.vas.push(w); return w; };
  if (!DB.customers.length) return;
  mk('CL-001', 'VAS-001', 'RSF-RICE-5K', 120, 1, 'Pending approval', { reason: 'Apply Arabic ingredient labels on each carton for the Ramadan promotion.' });
  mk('CL-002', 'VAS-005', 'NJE-PHN-A5', 30, 2, 'Rate pending', { reason: 'Bundle each phone with a charger and screen protector; one shrink-wrapped kit per unit.' });
  mk('CL-004', 'VAS-001', 'SQS-ABY-M', 40, 3, 'Approved', { reason: 'Re-label with new price tags supplied by the customer.' });
  mk('CL-003', 'VAS-004', 'HJP-PAR-24', 4, 4, 'In progress', { reason: 'Shrink-wrap pallets before the Nahdi dispatch.' });
  mk('CL-001', 'VAS-003', 'RSF-OIL-1L', 3, 5, 'Awaiting verification', { reason: 'Re-palletise loose cartons onto export pallets.', mat: [{ code: 'MAT-003', qty: 3 }] });
  const done = mk('CL-002', 'VAS-001', 'NJE-TV-55', 24, 9, 'Completed', { reason: 'Apply SASO compliance stickers on each TV box.', mat: [{ code: 'MAT-002', qty: 24 }] });
  if (done) { const at = iso(addDays(today, -6)), c = { id: seqNo('CHG', 'CHG-', 5), at, client: done.client, type: 'VAS: ' + svcBy(done.svc).name, svc: done.svc, ref: done.id, qty: done.compQty, rate: done.rs.rate, amount: +(done.compQty * done.rs.rate).toFixed(2), note: 'per ' + done.unit + ' · ' + done.rs.src, invoice: '' };
    DB.charges.push(c); Object.assign(done, { charge: c.id, verifiedBy: 'Hamza Kadenja', verifiedAt: at }); (done.materials || []).forEach(x => { const m = matBy(x.code); if (!m.code) return; m.onHand -= x.qty; DB.matMoves.push({ at: at + ' 16:00', code: x.code, type: 'Used on VAS', ref: done.id, qty: -x.qty, by: 'Hamza Kadenja' }); }); done.audit.push({ at: at + 'T16:00:00', action: 'Verified and charged (' + c.id + ')', by: 'Hamza Kadenja' }); }
}
