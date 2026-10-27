'use strict';
/* =====================================================================
   BILLING ENGINE  (ERP: service items, rate card, customer rates, charges, storage capture,
   billing run → review & approve → send → draft invoices, exceptions)
   ===================================================================== */
const BE_CATS = ['Storage', 'Handling', 'VAS', 'Transport'];
const SVC_PREFIX = { Storage: 'STR', Handling: 'HDL', VAS: 'VAS', Transport: 'TRN' };
const SVC_VAT = [['0.15', 'VAT 15%'], ['0', 'Zero-rated 0%'], ['exempt', 'Exempt']];
const vatOf = v => v === 'exempt' ? 0 : v == null || v === '' ? 0.15 : +v;
Object.assign(TONE, { Calculated: 'warn', 'Draft Invoice': 'info', 'In draft invoice': 'info', Unbilled: 'warn', Invoiced: 'good' });
const BE_DEF = { stMethod: 'run', stBasis: '30', stMinDays: 0, inclStorage: 'Yes', inclHandling: 'Yes', inclVas: 'Yes', inclTransport: 'Yes', approve: 'Yes', terms: 'Net 30' };
const beC = k => ((DB.beCfg || {})[k] ?? BE_DEF[k]);
const svcNorm = s => ({ name2: '', desc: '', eff: '2026-01-01', minFee: 0, vat: '0.15', status: 'Active', hist: [], log: [], ...s });
const svcNextCode = cat => { const P = (SVC_PREFIX[cat] || String(cat || 'SVC').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'SVC') + '-'; let n = 1; while (M.services.some(s => s.code === P + String(n).padStart(3, '0'))) n++; return P + String(n).padStart(3, '0'); };
const svcLog = (s, what) => (s.log = s.log || []).push({ at: nowStamp(), by: DATA.user.name, what });
const svcCharges = s => DB.charges.filter(c => c.svc === s.code);
const beCat = c => { const s = c.svc && svcBy(c.svc); if (s && BE_CATS.includes(s.cat)) return s.cat; return /^VAS/.test(c.type || '') ? 'VAS' : /Storage/i.test(c.type || '') ? 'Storage' : /Transport|Delivery|Trip/i.test(c.type || '') ? 'Transport' : 'Handling'; };
const bdR = id => (DB.bdrafts || []).find(d => d.id === id);
const brR = id => (DB.bruns || []).find(r => r.id === id);
const chgDraft = c => c.bdraft && bdR(c.bdraft) && bdR(c.bdraft).status !== 'Cancelled' ? c.bdraft : '';
const bdFree = c => !c.invoice && !chgDraft(c);
const chgState = c => c.invoice ? 'Invoiced' : chgDraft(c) ? 'In draft invoice' : 'Unbilled';
const beRate = r => Math.abs(r * 100 - Math.round(r * 100)) > 1e-6 ? (+r).toFixed(4) : sar(r);
const noon = d => new Date(d + 'T12:00:00');
const beDays = (a, b) => { const o = []; let d = a; while (d <= b && o.length < 800) { o.push(d); d = iso(addDays(noon(d), 1)); } return o; };
const beNo = p => seqNo(p + '@' + iso(today).slice(0, 7), p + '-' + iso(today).slice(0, 7) + '-', 4);
const beHist = (r, what) => ibAudit(r, what);
const beTempSvc = t => { const S2 = M.services.filter(s => s.status === 'Active' && s.cat === 'Storage'); const re = { Frozen: /frozen/i, Chilled: /chill/i }[t] || /ambient|dry/i; return S2.find(s => re.test(s.name)) || S2[0] || null; };
const csvDownload = (name, rows) => { const txt = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast(name + ' downloaded.'); } catch (e) { toast('Download is not available here.'); } };

/* ---- pallet-days per customer and temperature, rebuilt from the stock ledger ---- */
function beStorage(cl, from, to) {
  const last = to > iso(today) ? iso(today) : to, cov = new Set();
  (DB.bdrafts || []).filter(d => d.client === cl && d.status !== 'Cancelled' && d.stRange).forEach(d => beDays(d.stRange[0], d.stRange[1]).forEach(x => cov.add(x)));
  const days = from <= last ? beDays(from, last).filter(x => !cov.has(x)) : []; if (!days.length) return [];
  const L = {}; DB.moves.filter(m => m.client === cl && m.lpn && m.qty).forEach(m => (L[m.lpn] = L[m.lpn] || []).push(m));
  const G = {}, mn = +beC('stMinDays') || 0;
  Object.entries(L).forEach(([lpn, ms]) => { ms.sort((a, b) => String(a.at).localeCompare(String(b.at))); const temp = item(ms[0].sku).temp || 'Ambient', k = /froz/i.test(temp) ? 'Frozen' : /chill/i.test(temp) ? 'Chilled' : 'Ambient'; let held = 0;
    days.forEach(d => { let q = 0; ms.forEach(m => { if (String(m.at).slice(0, 10) <= d) q += +m.qty || 0; }); if (q > 0) { (G[k] = G[k] || { temp: k, pd: 0, lpns: new Set() }); G[k].pd++; G[k].lpns.add(lpn); held++; } });
    if (mn && held && held < mn) G[k].pd += mn - held; });
  return Object.values(G).map(g => { const s = beTempSvc(g.temp), cr = s && ctrRate(cl, s.code), base = cr ? +cr.rate : s ? +s.rate : 0, unit = (s && s.unit) || '';
    const dim = new Date(+from.slice(0, 4), +from.slice(5, 7), 0).getDate(), perDay = /month/i.test(unit) ? base / (beC('stBasis') === 'actual' ? dim : 30) : base, rate = +perDay.toFixed(4);
    return { temp: g.temp, svc: s ? s.code : '', desc: s ? s.name : 'Storage — ' + g.temp + ' pallets', pd: g.pd, pallets: g.lpns.size, base, unit, rate, amount: +(g.pd * rate).toFixed(2), src: cr ? 'Contract ' + ctrActive(cl).id : s ? 'Standard rate' : 'No rate' }; });
}
function beCompute(o) {
  const res = [], run = beC('stMethod') !== 'snapshot', cls = o.clients && o.clients.length ? o.clients : DB.customers.map(c => c.id);
  cls.forEach(cl => { const ch = DB.charges.filter(c => c.client === cl && bdFree(c) && c.at >= o.from && c.at <= o.to).filter(c => { const k = beCat(c); return k === 'Storage' ? !run && o.inc.Storage : o.inc[k]; });
    const st = run && o.inc.Storage ? beStorage(cl, o.from, o.to).filter(x => x.pd > 0) : [];
    const tot = k => (k === 'Storage' ? sum(st, x => x.amount) : 0) + sum(ch.filter(c => beCat(c) === k), c => c.amount);
    const vat = sum(st, x => x.amount * vatOf(svcBy(x.svc).vat)) + sum(ch, c => c.amount * vatOf(c.vat ?? svcBy(c.svc).vat));
    const r = { client: cl, storage: st, charges: ch.map(c => c.id), incl: true }; BE_CATS.forEach(k => r[k] = +tot(k).toFixed(2));
    r.subtotal = +(r.Storage + r.Handling + r.VAS + r.Transport).toFixed(2); r.vat = +vat.toFixed(2); r.total = +(r.subtotal + r.vat).toFixed(2); if (r.subtotal > 0) res.push(r); });
  return res;
}
const brTot = (r, k) => sum(r.res.filter(x => x.incl), x => x[k]);
const BR_STEPS = ['Billing run', 'Review & approve', 'Send', 'Draft invoices'];
const brStepper = r => { const at = !r ? 0 : r.status === 'Calculated' ? 1 : r.status === 'Approved' ? 2 : r.status === 'Sent' ? 4 : 0; return `<ol class="vas-steps">${BR_STEPS.map((x, i) => `<li class="${i < at ? 'ok' : i === at ? 'cur' : ''}"><i>${i < at ? '✓' : i + 1}</i><span>${x}</span></li>`).join('')}</ol>`; };
const brOpenRuns = o => (DB.bruns || []).filter(r => ['Calculated', 'Approved'].includes(r.status) && r.from <= o.to && r.to >= o.from);
const brBusy = o => { const m = {}; brOpenRuns(o).forEach(r => r.res.filter(x => x.incl).forEach(x => m[x.client] = r.id)); return m; };
function beDraftFromRun(r, x, at) {
  const made = [];
  x.storage.forEach(s => { const c = { id: seqNo('CHG', 'CHG-', 5), at, client: x.client, type: s.desc, svc: s.svc, ref: r.id, qty: s.pd, rate: s.rate, amount: s.amount, note: 'pallet-days · ' + s.temp, invoice: '', vat: svcBy(s.svc).vat || '0.15', rateSrc: s.src, engine: 1, brun: r.id }; DB.charges.push(c); made.push(c.id); });
  const ids = [...x.charges, ...made], ch = DB.charges.filter(c => ids.includes(c.id)), G = {};
  ch.forEach(c => { const s = c.svc ? svcBy(c.svc) : {}, key = (c.svc || c.type) + '|' + c.rate, vr = vatOf(c.vat ?? s.vat);
    (G[key] = G[key] || { svc: c.svc || '', desc: s.name || c.type, unit: c.engine ? 'Pallet-day' : s.unit || '', rate: +c.rate, qty: 0, amount: 0, vatRate: vr, cat: beCat(c), src: c.rateSrc || '' }); G[key].qty += +c.qty || 0; G[key].amount += +c.amount || 0; });
  const lines = Object.values(G).map(g => ({ ...g, amount: +g.amount.toFixed(2), vat: +(g.amount * g.vatRate).toFixed(2) })).sort((a, b) => BE_CATS.indexOf(a.cat) - BE_CATS.indexOf(b.cat) || (a.svc || '').localeCompare(b.svc || ''));
  const sub = +sum(lines, l => l.amount).toFixed(2), vat = +sum(lines, l => l.vat).toFixed(2), k = ctrActive(x.client);
  const d = { id: beNo('DINV'), run: r.id, client: x.client, from: r.from, to: r.to, lines, charges: ids, subtotal: sub, vat, total: +(sub + vat).toFixed(2), contract: k ? k.id : '', agr: k ? k.ref || '' : '', terms: beC('terms'), currency: 'SAR', status: 'Draft Invoice', created: at, createdBy: DATA.user.name, audit: [] };
  if (x.storage.length) d.stRange = [r.from, r.to > iso(today) ? iso(today) : r.to];
  ch.forEach(c => c.bdraft = d.id); beHist(d, 'Created from billing run ' + r.id); DB.bdrafts.push(d); return d;
}

/* ---- 1. Service items ---- */
let svcTab = 'overview';
function svcList() {
  const rows = applyFilt('svc', M.services, { q: (s, v) => (s.code + s.name + (s.name2 || '')).toLowerCase().includes(v.toLowerCase()) });
  return head2('Billing Engine', 'Service items', `<button type="button" class="btn" data-do="beSettings">Billing settings</button><a class="btn pri" href="#svc/new">+ New service item</a>`)
    + filterBar('svc', [{ id: 'cat', label: 'Category', options: optA(BE_CATS) }, { id: 'status', label: 'Status', options: optA(['Active', 'Inactive']) }, { id: 'q', type: 'text', label: 'Search code or name' }])
    + card(`${rows.length} service items`, tbl([['Service code', s => `<span class="mono">${esc(s.code)}</span>`], ['Service name', s => `<b>${esc(s.name)}</b>${s.name2 ? `<br><span class="note" dir="rtl" lang="ar">${esc(s.name2)}</span>` : ''}`], ['Category', s => esc(s.cat)], ['Charge unit', s => esc(s.unit)], ['Standard rate, SAR', s => +s.rate ? sar(s.rate) : '<span class="pill p-warn">Not set</span>', 1],
      ['On contracts', s => DB.contracts.filter(k => ['Active', 'Pending approval', 'Draft'].includes(ctrState(k)) && k.lines.some(l => l.code === s.code)).length, 1], ['Status', s => pill(s.status)]], rows, s => '#svc/view/' + encodeURIComponent(s.code), 'No service items.'))
    + `<p class="note">Every chargeable service is defined once here and reused on quotations, contracts, VAS work orders and invoices. A customer's contract rate overrides the standard rate.</p>`;
}
function svcView(code) {
  const s = svcBy(code); if (!s.code) return head2('Billing Engine', 'Service item not found', '<a class="btn" href="#svc">← Service items</a>') + '<div class="card empty">This service item no longer exists.</div>';
  const ctr = DB.contracts.filter(k => k.lines.some(l => l.code === s.code)), act = ctr.filter(k => ctrState(k) === 'Active'), ch = svcCharges(s), kv = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const tabs = [['overview', 'Overview'], ['rates', 'Customer rates'], ['tx', 'Transactions'], ['history', 'History']];
  let main = '';
  if (svcTab === 'overview') { const last = (s.hist || []).slice(-1)[0], mon = iso(today).slice(0, 7), mc = ch.filter(c => String(c.at).slice(0, 7) === mon);
    main = `<div class="grid g-2">${ibSec2('Primary details', `<div class="card-b dl">${kv('Service code', `<span class="mono">${esc(s.code)}</span>`)}${kv('Service name', esc(s.name))}${kv('Secondary name', s.name2 ? `<span dir="rtl" lang="ar">${esc(s.name2)}</span>` : '—')}${kv('Category', esc(s.cat))}${kv('Description', esc(s.desc || '—'))}${kv('Status', pill(s.status))}${kv('Created', s.created ? fmtDate(s.created) + (s.by ? ' · ' + esc(s.by) : '') : 'Sample data')}</div>`)}
      ${ibSec2('Charging', `<div class="card-b dl">${kv('Charge unit', esc(s.unit))}${kv('Standard rate', `SAR ${sar(s.rate)} per ${esc(s.unit)}`)}${kv('Effective from', fmtDate(s.eff))}${kv('Minimum fee', s.minFee ? 'SAR ' + sar(s.minFee) : '—')}${kv('VAT', esc((SVC_VAT.find(v => v[0] === (s.vat || '0.15')) || [0, 'VAT 15%'])[1]))}${kv('Last rate change', last ? `${sar(last.from)} → ${sar(last.to)} on ${fmtDate(last.eff)} · ${esc(last.by)}` : '—')}</div>`)}</div>`
      + kpis4([['Active contracts', act.length], ['Charges this month', mc.length], ['Revenue this month, SAR', sar(sum(mc, c => c.amount))], ['Unbilled, SAR', sar(sum(ch.filter(bdFree), c => c.amount))]]); }
  if (svcTab === 'rates') main = card(`${ctr.length} contracts include this service`, tbl([['Customer', k => `<b>${esc(clName(k.client))}</b>`], ['Contract', k => `<span class="mono">${esc(k.id)}</span>${k.ref ? `<br><span class="note">${esc(k.ref)}</span>` : ''}`], ['Contract rate, SAR', k => `<b>${sar(k.lines.find(l => l.code === s.code).rate)}</b>`, 1], ['Standard, SAR', () => sar(s.rate), 1], ['Min. fee, SAR', k => { const l = k.lines.find(x => x.code === s.code); return l.minFee ? sar(l.minFee) : '—'; }, 1], ['Period', k => `${fmtDate(k.start)} – ${fmtDate(k.end)}`], ['Status', k => pill(ctrState(k))]], ctr.slice().reverse(), k => '#contracts/edit/' + encodeURIComponent(k.id), 'No contract includes this service yet.'));
  if (svcTab === 'tx') main = card(`${ch.length} charges · SAR ${sar(sum(ch, c => c.amount))}`, tbl([['Date', c => fmtDate(c.at)], ['Customer', c => esc(clName(c.client))], ['Source', c => `<span class="mono">${esc(c.ref)}</span>`], ['Qty', c => n0(c.qty), 1], ['Rate, SAR', c => beRate(c.rate), 1], ['Amount, SAR', c => sar(c.amount), 1], ['Rate source', c => `<span class="note">${esc(c.rateSrc || '—')}</span>`], ['Billing', c => pill(chgState(c))]], ch.slice().reverse(), null, 'No charges raised for this service yet.'));
  if (svcTab === 'history') { const H = [...(s.log || []), ...(s.hist || []).map(h => ({ at: h.at, by: h.by, what: `Standard rate ${sar(h.from)} → ${sar(h.to)} from ${fmtDate(h.eff)}${h.why ? ': ' + h.why : ''}` }))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    main = card('History', tbl([['Date', h => esc(String(h.at).slice(0, 16))], ['By', h => esc(h.by || '—')], ['Action', h => esc(h.what)]], H, null, 'No changes recorded.')); }
  return head2('<a href="#svc" style="color:inherit">Billing Engine · Service items</a>', esc(s.name), `<a class="btn" href="#svc">← Service items</a><button type="button" class="btn" data-do="svcToggle" data-id="${esc(s.code)}">${s.status === 'Inactive' ? 'Mark as active' : 'Mark as inactive'}</button><button type="button" class="btn" data-do="svcRate" data-id="${esc(s.code)}">Change standard rate</button><a class="btn pri" href="#svc/edit/${encodeURIComponent(s.code)}">Edit</a>`)
    + `<div class="row" style="gap:6px"><span class="pill p-mute mono">${esc(s.code)}</span><span class="pill p-mute">${esc(s.cat)}</span>${pill(s.status)}${s.name2 ? `<span class="note" dir="rtl" lang="ar">${esc(s.name2)}</span>` : ''}</div>`
    + `<nav class="be-tabs" aria-label="Service item">${tabs.map(([k, l]) => `<button type="button" class="${svcTab === k ? 'on' : ''}" data-do="svcTabGo" data-id="${k}" ${svcTab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>` + main;
}
function svcForm(code) {
  const ed = !!code, s = ed ? svcBy(code) : { code: '', name: '', name2: '', cat: 'Handling', unit: 'Pallet', rate: '', eff: iso(today), vat: '0.15', minFee: '', desc: '', status: 'Active' };
  if (ed && !s.code) return head2('Billing Engine', 'Service item not found', '<a class="btn" href="#svc">← Service items</a>') + '<div class="card empty">This service item no longer exists.</div>';
  const used = ed && (DB.contracts.some(k => k.lines.some(l => l.code === s.code)) || DB.charges.some(c => c.svc === s.code)), units = [...new Set([...SD_UNITS, ...M.services.map(x => x.unit)])];
  const btns = `<a class="btn" href="${ed ? '#svc/view/' + encodeURIComponent(code) : '#svc'}">Cancel</a>${ed ? '' : '<button type="button" class="btn" data-do="svcSave" data-id="new">Save &amp; new</button>'}<button type="button" class="btn pri" data-do="svcSave" data-id="close">${ed ? 'Save changes' : 'Save service item'}</button>`;
  return head2('<a href="#svc" style="color:inherit">Billing Engine · Service items</a>', ed ? esc(s.name) : 'New service item', btns)
    + `<form id="svcForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:16px"><div class="err" id="svcErr" role="alert"></div>
    ${ibSec2('Service item', `<div class="card-b fgrid f3">
      ${fld('Category', `<select name="cat" ${used ? 'disabled' : ''}>${opt(optA(BE_CATS), s.cat)}</select>`, 1)}
      ${fld('Service code', `<input name="code" class="mono ro-in" value="${esc(ed ? s.code : svcNextCode(s.cat))}" readonly tabindex="-1"><small class="hint">${ed ? (used ? 'Fixed: used on contracts or charges.' : 'Fixed for this service.') : 'Assigned from the category when you save.'}</small>`)}
      ${fld('Status', `<select name="status">${opt(optA(['Active', 'Inactive']), s.status)}</select>`)}
      ${fld('Service name (English)', `<input name="name" value="${esc(s.name)}" placeholder="e.g. Shrink wrapping" autocomplete="off">`, 1)}
      ${fld('Secondary name (Arabic)', `<input name="name2" dir="rtl" lang="ar" value="${esc(s.name2 || '')}" placeholder="مثال: تغليف بالانكماش" autocomplete="off">`)}
      ${fld('Description', `<input name="desc" value="${esc(s.desc || '')}" placeholder="Shown on quotations and invoices" autocomplete="off">`)}
    </div>`, ed ? '' : 'The service code is generated from the category')}
    ${ibSec2('Charging', `<div class="card-b fgrid f3">
      ${fld('Charge unit', `<input name="unit" list="dl_svcunit" value="${esc(s.unit)}" autocomplete="off"><datalist id="dl_svcunit">${units.map(u => `<option value="${esc(u)}">`).join('')}</datalist>`, 1)}
      ${fld('Standard rate, SAR', `<input name="rate" type="number" min="0" step="0.01" value="${esc(s.rate)}" ${ed ? 'readonly class="ro-in"' : ''}><small class="hint">${ed ? 'Use "Change standard rate" so the change is recorded with a date and reason.' : 'Per charge unit, excluding VAT.'}</small>`, 1)}
      ${fld('Effective from', `<input name="eff" type="date" value="${esc(s.eff || iso(today))}" ${ed ? 'readonly class="ro-in"' : ''}>`)}
      ${fld('Minimum fee, SAR', `<input name="minFee" type="number" min="0" step="0.01" value="${esc(s.minFee || '')}" placeholder="Optional"><small class="hint">Charged when a job's amount is lower. Contracts can set their own.</small>`)}
      ${fld('VAT', `<select name="vat">${opt(SVC_VAT, s.vat || '0.15')}</select>`)}
    </div>`, 'Customer contract rates override the standard rate')}
    <div class="form-foot">${btns}</div></form>`;
}
document.addEventListener('change', e => { if (e.target.closest && e.target.closest('#svcForm') && e.target.name === 'cat' && /\/new$/.test(location.hash)) { const c = $('#svcForm [name=code]'); if (c) c.value = svcNextCode(e.target.value); } });

/* ---- 2. Standard rate card, 3. customer rates ---- */
function rateCard() {
  const f = FILT.rc || {}, rows = M.services.filter(s => s.status === 'Active' && (!f.cat || s.cat === f.cat));
  return head2('Billing Engine', 'Standard rate card', '<button type="button" class="btn" data-do="rcCsv">Download CSV</button>') + filterBar('rc', [{ id: 'cat', label: 'Category', options: optA(BE_CATS) }])
    + BE_CATS.filter(c => rows.some(s => s.cat === c)).map(c => card(esc(c), tbl([['Code', s => `<a class="mono" href="#svc/view/${encodeURIComponent(s.code)}">${esc(s.code)}</a>`], ['Service', s => esc(s.name)], ['Unit', s => esc(s.unit)], ['Standard rate, SAR', s => +s.rate ? `<b>${sar(s.rate)}</b>` : '<span class="pill p-warn">Not set</span>', 1], ['Min. fee', s => s.minFee ? sar(s.minFee) : '—', 1], ['Effective from', s => fmtDate(s.eff)],
      ['Last change', s => { const h = (s.hist || []).slice(-1)[0]; return h ? `${sar(h.from)} → ${sar(h.to)} <span class="note">${esc(h.by)}</span>` : '<span class="note">—</span>'; }], ['', s => `<div class="rowicons"><button type="button" class="btn sm ${+s.rate ? '' : 'pri'}" data-do="svcRate" data-id="${esc(s.code)}">${+s.rate ? 'Change rate' : 'Set rate'}</button></div>`]], rows.filter(s => s.cat === c), null, ''))).join('')
    + `<p class="note">Standard rates apply only where a customer has no contract rate and the work is approved at the standard rate. Changing a standard rate keeps its history and does not change contract rates or charges already raised.</p>`;
}
function custRates() {
  const f = FILT.cr || {}, cls = DB.customers.filter(c => c.status !== 'Inactive' && (!f.client || c.id === f.client));
  const body = cls.map(c => { const k = ctrActive(c.id);
    if (!k) return card(esc(c.name), `<div class="card-b"><p class="note" style="margin:0 0 8px">No active contract. Work for this customer is charged at the standard rates in Service items until a contract is approved.</p><a class="btn pri sm" href="#contracts/new">+ New contract</a></div>`, '<span class="pill p-warn">No contract</span>');
    const lines = k.lines.filter(l => !f.cat || svcBy(l.code).cat === f.cat).slice().sort((a, b) => BE_CATS.indexOf(svcBy(a.code).cat) - BE_CATS.indexOf(svcBy(b.code).cat) || a.code.localeCompare(b.code)), d = ctrDaysLeft(k);
    return card(esc(c.name), tbl([['Code', l => `<span class="mono">${esc(l.code)}</span>`], ['Service', l => esc(l.name) + (svcBy(l.code).status === 'Inactive' ? ' <span class="pill p-mute">Retired</span>' : '')], ['Category', l => esc(svcBy(l.code).cat || l.cat || '')], ['Unit', l => esc(l.unit)], ['Contract rate, SAR', l => `<b>${sar(l.rate)}</b>`, 1], ['Standard, SAR', l => +svcBy(l.code).rate ? sar(svcBy(l.code).rate) : '—', 1],
      ['Difference', l => { const st = +svcBy(l.code).rate; if (!st) return '—'; const x = Math.round((l.rate / st - 1) * 100); return x ? `<span class="pill p-${x < -20 ? 'warn' : 'mute'}">${x > 0 ? '+' : ''}${x}%</span>` : '0%'; }, 1], ['Min. fee, SAR', l => l.minFee ? sar(l.minFee) : '—', 1]], lines, null, 'No services in this category on the contract.'),
      `<span class="note"><a class="mono" href="#contracts/edit/${encodeURIComponent(k.id)}">${esc(k.id)}</a>${k.ref ? ' · ' + esc(k.ref) : ''} · valid to ${fmtDate(k.end)}${d != null && d <= 60 ? ` <span class="pill p-warn">${d} days left</span>` : ''} · ${lines.length} services</span>`); }).join('');
  return head2('Billing Engine', 'Customer rates') + filterBar('cr', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'cat', label: 'Category', options: optA(BE_CATS) }]) + (body || '<div class="card empty">No customers.</div>')
    + `<p class="note">One card per customer with the services and rates on their active contract. Rates change only through a contract amendment (Customers &amp; Commercial → Contracts), which needs approval.</p>`;
}

/* ---- 4. Charges ---- */
function chargesPage() {
  const rows = applyFilt('chg', DB.charges.slice().reverse(), { cat: (c, v) => beCat(c) === v, billed: (c, v) => chgState(c) === v, q: (c, v) => (c.id + ' ' + c.ref + ' ' + c.type).toLowerCase().includes(v.toLowerCase()) });
  const unb = DB.charges.filter(bdFree), mon = iso(today).slice(0, 7);
  return head2('Billing Engine', 'Charges', `<button type="button" class="btn" data-do="chgCsv">Download CSV</button><a class="btn pri" href="#charges/new">+ Manual charge</a>`)
    + kpis4([['Charges this month', DB.charges.filter(c => String(c.at).slice(0, 7) === mon).length], ['Raised this month, SAR', sar(sum(DB.charges.filter(c => String(c.at).slice(0, 7) === mon), c => c.amount))], ['Unbilled, SAR', sar(sum(unb, c => c.amount))], ['In draft invoices, SAR', sar(sum(DB.charges.filter(c => chgDraft(c)), c => c.amount))]])
    + filterBar('chg', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'cat', label: 'Category', options: optA(BE_CATS) }, { id: 'billed', label: 'Billing', options: optA(['Unbilled', 'In draft invoice']) }, { id: 'q', type: 'text', label: 'Search charge, source, type' }])
    + card(`${rows.length} charges · SAR ${sar(sum(rows, c => c.amount))}`, tbl([['Date', c => fmtDate(c.at)], ['Charge', c => `<span class="mono">${esc(c.id)}</span>`], ['Customer', c => esc(clName(c.client))], ['Category', c => esc(beCat(c))], ['Service', c => esc(c.type) + (c.manual ? ' <span class="pill p-mute">Manual</span>' : '') + (c.memo ? `<br><span class="note">${esc(c.memo)}</span>` : '')], ['Source', c => `<span class="mono">${esc(c.ref || '')}</span>`],
      ['Qty', c => n0(c.qty) + ' <span class="note">' + esc(c.note || '') + '</span>', 1], ['Rate', c => beRate(c.rate), 1], ['Amount, SAR', c => `<b>${sar(c.amount)}</b>`, 1], ['Billing', c => chgDraft(c) ? `<a class="pill p-info" href="#bdrafts/view/${encodeURIComponent(c.bdraft)}">${esc(c.bdraft)}</a>` : pill(chgState(c))],
      ['', c => c.manual && bdFree(c) ? `<div class="rowicons"><button type="button" class="icon-btn danger" data-do="chgDel" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.id)}" title="Delete">${ICO.del}</button></div>` : '']], rows, null, 'No charges match.'))
    + `<p class="note">Charges are raised by returns, VAS verification, storage and manual entries. They stay unbilled until a billing run puts them on a draft invoice. A manual charge can be deleted until it is billed.</p>`;
}
let chgD = null;
window.addEventListener('hashchange', () => { chgD = null; });
function chgForm() {
  CUR = { mod: 'billing', sub: 'charges' };
  const d = chgD || (chgD = { client: (DB.customers[0] || {}).id || '', at: iso(today), svc: '', qty: 1, rate: '', ref: '', note: '', vat: '0.15' });
  const svcs = M.services.filter(s => s.status === 'Active'), s = svcBy(d.svc), r = d.svc ? ctrRate(d.client, d.svc) : null, amt = (+d.qty || 0) * (+d.rate || 0);
  const btns = `<a class="btn" href="#charges">Cancel</a><button type="button" class="btn" data-do="chgSave" data-id="new">Save &amp; new</button><button type="button" class="btn pri" data-do="chgSave" data-id="close">Save charge</button>`;
  return head2('<a href="#charges" style="color:inherit">Billing Engine · Charges</a>', 'New manual charge', btns) + `<form id="chgForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:16px"><div class="err" id="chgErr" role="alert"></div>
    ${ibSec2('Charge', `<div class="card-b fgrid f3">${fld('Customer', `<select name="client">${opt(DB.customers.filter(c => c.status !== 'Inactive').map(c => [c.id, c.name]), d.client)}</select>`, 1)}${fld('Charge date', `<input name="at" type="date" value="${esc(d.at)}">`, 1)}${fld('Reference', `<input name="ref" value="${esc(d.ref)}" placeholder="e.g. ASN, order or job no." autocomplete="off">`)}</div>`, 'For work not raised automatically, e.g. overtime, extra handling or a one-off delivery')}
    ${ibSec2('Service', `<div class="card-b fgrid f3">
      ${fld('Service item', `<select name="svc"><option value="">Choose a service item…</option>${BE_CATS.filter(c => svcs.some(x => x.cat === c)).map(c => `<optgroup label="${esc(c)}">${svcs.filter(x => x.cat === c).map(x => `<option value="${esc(x.code)}" ${x.code === d.svc ? 'selected' : ''}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>`, 1, 'span2')}
      ${ibRO2('Category', s.cat || '')}
      ${fld('Quantity', `<input name="qty" type="number" min="0.01" step="any" value="${esc(d.qty)}"><small class="hint">In ${esc(s.unit || 'the charge unit')}</small>`, 1)}
      ${fld('Rate, SAR', `<input name="rate" type="number" min="0" step="0.01" value="${esc(d.rate)}"><small class="hint">${d.svc ? (r ? 'Contract rate: SAR ' + sar(r.rate) + ' per ' + esc(s.unit) : 'No contract rate · standard SAR ' + sar(s.rate)) : 'Choose a service first'}</small>`, 1)}
      ${fld('VAT', `<select name="vat">${opt(SVC_VAT, d.vat || '0.15')}</select>`)}
      <div style="grid-column:1/-1" class="be-amt">Amount <b>SAR ${sar(amt)}</b> <span class="note">excluding VAT · ${esc(d.qty || 0)} × ${sar(+d.rate || 0)}</span></div></div>`, "Rate comes from the customer's contract, otherwise the standard rate")}
    ${ibSec2('Notes', `<div class="card-b">${fld('Note', `<textarea name="note" rows="3" placeholder="Why this charge is raised; shown on the charges list">${esc(d.note)}</textarea>`)}</div>`)}
    <div class="form-foot">${btns}</div></form>`;
}
const chgRead = () => { const f = $('#chgForm'), g = n => (f.querySelector(`[name="${n}"]`) || {}).value?.trim() ?? ''; return { client: g('client'), at: g('at'), ref: g('ref'), svc: g('svc'), qty: g('qty'), rate: g('rate'), vat: g('vat'), note: g('note') }; };
document.addEventListener('change', e => { const f = e.target.closest && e.target.closest('#chgForm'); if (!f) return; const v = chgRead();
  if (['svc', 'client'].includes(e.target.name)) { const s = svcBy(v.svc), r = v.svc ? ctrRate(v.client, v.svc) : null; if (v.svc) { v.rate = r && +r.rate ? r.rate : s.rate; v.vat = s.vat || '0.15'; } chgD = v; route(); return; }
  chgD = v; });
document.addEventListener('input', e => { if (!(e.target.closest && e.target.closest('#chgForm')) || !['qty', 'rate'].includes(e.target.name)) return; const v = chgRead(); chgD = v; const a = $('#chgForm .be-amt'); if (a) a.innerHTML = `Amount <b>SAR ${sar((+v.qty || 0) * (+v.rate || 0))}</b> <span class="note">excluding VAT · ${esc(v.qty || 0)} × ${sar(+v.rate || 0)}</span>`; });

/* ---- 5. Storage capture ---- */
function storageNow() { return DB.customers.map(c => { const st = DB.stock.filter(s => s.client === c.id && s.status !== 'In transit'), G = {};
  st.forEach(s => { const t = item(s.sku).temp || 'Ambient', k = /froz/i.test(t) ? 'Frozen' : /chill/i.test(t) ? 'Chilled' : 'Ambient'; G[k] = (G[k] || 0) + 1; });
  return Object.entries(G).map(([temp, n]) => { const sv = beTempSvc(temp), cr = sv && ctrRate(c.id, sv.code), base = cr ? +cr.rate : sv ? +sv.rate : 0, rate = /month/i.test((sv && sv.unit) || '') ? base / 30 : base; return { client: c.id, temp, n, svc: sv ? sv.code : '', rate, amount: +(n * rate).toFixed(2), src: cr ? 'Contract' : 'Standard' }; }); }).flat(); }
function storagePage() {
  const snap = beC('stMethod') === 'snapshot', rows = storageNow(), done = (DB.stSnaps || []).some(x => x.at === iso(today));
  const past = (DB.stSnaps || []).slice().reverse().slice(0, 30);
  return head2('Billing Engine', 'Storage capture', `<button type="button" class="btn" data-do="beSettings">Billing settings</button><button type="button" class="btn pri" data-do="stCapture" ${done ? 'disabled' : ''}>${done ? 'Captured for today' : "Capture today's storage"}</button>`)
    + `<div class="${snap ? 'warnbox' : 'card card-b'}">${snap ? '<b>Storage method: daily snapshot charges.</b> Each capture raises one storage charge per customer and temperature for the pallets held that day. Billing runs bill these charges.' : '<b>Storage method: billing run.</b> The billing run calculates pallet-days for each customer from the stock ledger × contract rate, so these daily snapshots are for reference and are not billed. Change the method in Billing settings.'}</div>`
    + kpis4([['Pallets in storage', sum(rows, r => r.n)], ['Customers holding stock', new Set(rows.map(r => r.client)).size], ["Today's storage value, SAR", sar(sum(rows, r => r.amount))], ['Snapshots captured', (DB.stSnaps || []).length]])
    + card("Today's pallet snapshot", tbl([['Customer', r => esc(clName(r.client))], ['Temperature', r => esc(r.temp)], ['Service', r => `<span class="mono">${esc(r.svc || '—')}</span>`], ['Pallets now', r => n0(r.n), 1], ['Rate / pallet / day, SAR', r => beRate(r.rate) + ` <span class="note">${r.src}</span>`, 1], ['Charge, SAR', r => sar(r.amount), 1]], rows, null, 'No stock in the warehouse.'))
    + card('Past snapshots', tbl([['Date', x => fmtDate(x.at)], ['Captured by', x => esc(x.by)], ['Pallets', x => n0(sum(x.rows, r => r.n)), 1], ['Pallet-day value, SAR', x => sar(sum(x.rows, r => r.amount)), 1], ['Charges raised', x => x.charges && x.charges.length ? x.charges.length : '<span class="note">Reference only</span>', 1]], past, null, 'No snapshots yet.'))
    + `<p class="note">Run the capture once a day (in production it runs automatically at midnight).</p>`;
}

/* ---- 6. Billing run ---- */
function runList() {
  const R = (DB.bruns || []).slice().reverse();
  return head2('Billing Engine', 'Billing run', `<button type="button" class="btn" data-do="beSettings">Billing settings</button><a class="btn pri" href="#billrun/new">+ New billing run</a>`) + `<section class="card card-b">${brStepper(null)}<p class="note" style="margin:12px 0 0">Click <b>+ New billing run</b> to see every customer with unbilled storage, handling, VAS and transport services. Select the customers, run, review and approve, then send to create one draft invoice per customer.</p></section>`
    + card(`${R.length} billing runs`, tbl([['Run no.', r => `<b class="mono">${esc(r.id)}</b>`], ['Period', r => fmtDate(r.from) + ' – ' + fmtDate(r.to)], ['Customers', r => r.res.filter(x => x.incl).length, 1], ...BE_CATS.map(k => [k, r => sar(brTot(r, k)), 1]), ['Total incl. VAT', r => `<b>${sar(brTot(r, 'total'))}</b>`, 1], ['Status', r => pill(r.status)]], R, r => '#billrun/view/' + encodeURIComponent(r.id), 'No billing runs yet. Click + New billing run.'));
}
let brNew = null;
window.addEventListener('hashchange', () => { if (!/^#billrun\/new/.test(location.hash)) brNew = null; });
const brNewInit = () => brNew || (brNew = { from: iso(today).slice(0, 8) + '01', to: iso(today), inc: { Storage: beC('inclStorage') === 'Yes', Handling: beC('inclHandling') === 'Yes', VAS: beC('inclVas') === 'Yes', Transport: beC('inclTransport') === 'Yes' }, sel: null, open: null });
function brPreview(o) { if (!(o.from && o.to && o.from <= o.to)) return []; const busy = brBusy(o); return beCompute({ ...o, clients: [] }).filter(x => !busy[x.client]); }
function beDetail(x) {
  const ch = DB.charges.filter(c => x.charges.includes(c.id));
  return `<div class="be-dw">${x.storage.length ? `<b>Storage · pallet-days</b><table><thead><tr><th>Service</th><th>Temperature</th><th class="num">Pallets</th><th class="num">Pallet-days</th><th class="num">Rate</th><th class="num">Day rate</th><th class="num">Amount</th><th>Rate source</th></tr></thead><tbody>${x.storage.map(s => `<tr><td class="mono">${esc(s.svc || '—')}</td><td>${esc(s.temp)}</td><td class="num">${n0(s.pallets)}</td><td class="num">${n0(s.pd)}</td><td class="num">${sar(s.base)} <span class="note">${esc(s.unit)}</span></td><td class="num">${s.rate.toFixed(4)}</td><td class="num">${sar(s.amount)}</td><td><span class="note">${esc(s.src)}</span></td></tr>`).join('')}</tbody></table>` : ''}
    ${ch.length ? `<b>Charges</b><table><thead><tr><th>Date</th><th>Category</th><th>Charge</th><th>Source</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${ch.map(c => `<tr><td>${fmtDate(c.at)}</td><td>${beCat(c)}</td><td>${esc(c.type)}</td><td class="mono">${esc(c.ref || '')}</td><td class="num">${n0(c.qty)}</td><td class="num">${beRate(c.rate)}</td><td class="num">${sar(c.amount)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}
function runNew() {
  CUR = { mod: 'billing', sub: 'billrun' };
  const o = brNewInit(), P = brPreview(o), key = o.from + o.to + JSON.stringify(o.inc); if (o.sel == null || o.selKey !== key) { o.sel = P.map(x => x.client); o.selKey = key; }
  const sel = P.filter(x => o.sel.includes(x.client)), T = k => sum(sel, x => x[k]), cnt = x => x.charges.length + x.storage.length, busy = brBusy(o), bk = Object.keys(busy);
  const custs = P.length ? `<div class="tbl-wrap"><table class="rm-t"><thead><tr><th><input type="checkbox" id="brAll2" ${sel.length === P.length ? 'checked' : ''} aria-label="Select all customers"></th><th>Customer</th><th class="num">Unbilled items</th>${BE_CATS.map(k => `<th class="num">${k}</th>`).join('')}<th class="num">Subtotal</th><th class="num">VAT</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${P.map((x, i) => `<tr class="${o.sel.includes(x.client) ? 'on' : 'be-off'}"><td><input type="checkbox" data-brsel="${esc(x.client)}" ${o.sel.includes(x.client) ? 'checked' : ''} aria-label="Select ${esc(clName(x.client))}"></td><td><b>${esc(clName(x.client))}</b><br><button type="button" class="linkbtn" data-do="brPrev" data-id="${i}">${o.open === i ? 'Hide unbilled services' : 'Show unbilled services'}</button></td><td class="num">${n0(cnt(x))}</td>${BE_CATS.map(k => `<td class="num">${sar(x[k])}</td>`).join('')}<td class="num"><b>${sar(x.subtotal)}</b></td><td class="num">${sar(x.vat)}</td><td class="num"><b>${sar(x.total)}</b></td><td><button type="button" class="btn sm" data-do="brRunOne" data-id="${esc(x.client)}">Run for this customer</button></td></tr>
    ${o.open === i ? `<tr class="be-det"><td colspan="11">${beDetail(x)}</td></tr>` : ''}`).join('')}</tbody>
    <tfoot><tr><td></td><td>Selected · ${sel.length} of ${P.length}</td><td class="num">${n0(sum(sel, cnt))}</td>${BE_CATS.map(k => `<td class="num">${sar(T(k))}</td>`).join('')}<td class="num">${sar(T('subtotal'))}</td><td class="num">${sar(T('vat'))}</td><td class="num">${sar(T('total'))}</td><td></td></tr></tfoot></table></div>` : '<div class="empty">No customer has unbilled services for this period and these charge types.</div>';
  return head2('<a href="#billrun" style="color:inherit">Billing Engine · Billing run</a>', 'New billing run', '<a class="btn" href="#billrun">← Billing runs</a>') + `<section class="card card-b">${brStepper(null)}</section><form id="brForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:16px">
    ${ibSec2('1 · Billing period', `<div class="card-b fgrid f3">${fld('Period from', `<input type="date" name="from" value="${esc(o.from)}">`, 1)}${fld('Period to', `<input type="date" name="to" value="${esc(o.to)}">`, 1)}<div></div>
      <div class="row" style="grid-column:1/-1"><span class="note">Quick period:</span>${[['This month', 'tm'], ['Last month', 'lm'], ['First half', 'h1'], ['Second half', 'h2']].map(([l, k]) => `<button type="button" class="btn sm" data-do="brQuick" data-id="${k}">${l}</button>`).join('')}</div></div>`)}
    ${ibSec2('2 · Charges to include', `<div class="card-b be-inc">${[['Storage', beC('stMethod') === 'snapshot' ? 'Daily storage snapshot charges' : 'Pallet-days by temperature × contract rate'], ['Handling', 'Inbound, outbound, order and returns handling'], ['VAS', 'Value-added services and materials'], ['Transport', 'Delivery and trucking charges']].map(([k, d]) => `<label class="be-ci"><input type="checkbox" name="inc_${k}" ${o.inc[k] ? 'checked' : ''}><span><b>${k}</b><em>${d}</em></span></label>`).join('')}</div>`)}
    ${ibSec2('3 · Customers with unbilled services', `<div class="card-b" style="padding-bottom:0"><p class="note" style="margin:0">Fetched for the period and charge types above. Tick the customers to bill, open a customer to see every unbilled service, then run the billing engine. Customers already in an open run for this period are not shown.</p>${bk.length ? `<div class="warnbox" style="margin-top:10px">In an open billing run (not yet sent): ${bk.map(c => `${esc(clName(c))} · <a class="mono" href="#billrun/view/${encodeURIComponent(busy[c])}">${esc(busy[c])}</a>`).join(', ')}. Send or cancel that run first.</div>` : ''}</div>${custs}`)}
    <div class="err" id="brErr" role="alert"></div>
    <div class="form-foot"><span class="note" style="margin-right:auto">${sel.length} customer${sel.length === 1 ? '' : 's'} selected · <b>SAR ${sar(T('total'))}</b> incl. VAT</span><a class="btn" href="#billrun">Cancel</a><button type="button" class="btn pri" data-do="brRun" ${sel.length ? '' : 'disabled'}>Run billing engine</button></div></form>`;
}
function brReadForm() { const f = $('#brForm'); if (!f) return; const o = brNewInit(), v = n => (f.querySelector(`[name="${n}"]`) || {}).value || ''; o.from = v('from'); o.to = v('to'); BE_CATS.forEach(k => o.inc[k] = f.querySelector(`[name=inc_${k}]`).checked); }
document.addEventListener('change', e => { const f = e.target.closest && e.target.closest('#brForm'); if (!f) return; const o = brNewInit();
  if (e.target.dataset.brsel) { const c = e.target.dataset.brsel; o.sel = e.target.checked ? [...new Set([...o.sel, c])] : o.sel.filter(x => x !== c); route(); return; }
  if (e.target.id === 'brAll2') { o.sel = e.target.checked ? brPreview(o).map(x => x.client) : []; route(); return; }
  if (['from', 'to'].includes(e.target.name) || /^inc_/.test(e.target.name || '')) { brReadForm(); o.open = null; route(); } });
function runView(id) {
  const r = brR(id); if (!r) return head2('Billing Engine', 'Billing run not found', '<a class="btn" href="#billrun">← Billing runs</a>') + '<div class="card empty">This billing run no longer exists.</div>';
  const ed = r.status === 'Calculated', A = [], B = (l, a, k) => A.push(`<button type="button" class="btn ${k || ''}" data-do="${a}" data-id="${esc(r.id)}">${l}</button>`);
  B('Print run summary', 'brPrint');
  if (r.status === 'Calculated') { B('Cancel run', 'brCancel', 'danger'); B('Recalculate', 'brRecalc'); B(beC('approve') === 'Yes' ? 'Approve' : 'Approve &amp; continue', 'brApprove', 'pri'); }
  if (r.status === 'Approved') { B('Cancel run', 'brCancel', 'danger'); B('Back to review', 'brReopen'); B('Send · create draft invoices', 'brSend', 'pri'); }
  if (r.status === 'Sent') A.push('<a class="btn pri" href="#bdrafts">View draft invoices</a>');
  return head2('<a href="#billrun" style="color:inherit">Billing Engine · Billing run</a>', 'Billing run ' + esc(r.id), '<a class="btn" href="#billrun">← Billing runs</a>')
    + `<section class="card card-b"><div class="vas-hd"><div class="row" style="gap:6px">${pill(r.status)}<span class="pill p-mute">Period ${fmtDate(r.from)} – ${fmtDate(r.to)}</span><span class="pill p-mute">${BE_CATS.filter(x => r.inc[x]).join(' · ')}</span><span class="pill p-mute">Storage: ${r.method === 'snapshot' ? 'daily snapshots' : 'pallet-days'}</span></div><div class="rm-cust"><span>Created</span><b>${esc(r.createdBy)}</b><span>${esc(String(r.created).replace('T', ' ').slice(0, 16))}</span></div></div>
      ${r.status === 'Cancelled' ? '<div class="warnbox" style="margin-top:12px">This run was cancelled. Nothing was billed.</div>' : brStepper(r)}</section>`
    + kpis4([['Customers', r.res.filter(x => x.incl).length], ...BE_CATS.map(k => [k + ', SAR', sar(brTot(r, k))]), ['Total incl. VAT, SAR', sar(brTot(r, 'total'))]])
    + ibSec2(ed ? 'Review &amp; approve: untick a customer to leave them out of this run' : 'Customers in this run', `<div class="tbl-wrap"><table class="rm-t"><thead><tr>${ed ? '<th></th>' : ''}<th>Customer</th>${BE_CATS.map(k => `<th class="num">${k}</th>`).join('')}<th class="num">Subtotal</th><th class="num">VAT</th><th class="num">Total</th><th>${r.status === 'Sent' ? 'Draft invoice' : ''}</th></tr></thead><tbody>
      ${r.res.map((x, i) => `<tr class="${x.incl ? '' : 'be-off'}">${ed ? `<td><input type="checkbox" data-brinc="${i}" ${x.incl ? 'checked' : ''} aria-label="Include ${esc(clName(x.client))}"></td>` : ''}<td><b>${esc(clName(x.client))}</b><br><button type="button" class="linkbtn" data-do="brDet" data-id="${i}">${r.open === i ? 'Hide detail' : 'Show detail'}</button></td>${BE_CATS.map(k => `<td class="num">${sar(x[k])}</td>`).join('')}<td class="num"><b>${sar(x.subtotal)}</b></td><td class="num">${sar(x.vat)}</td><td class="num"><b>${sar(x.total)}</b></td><td>${x.draft ? `<a class="mono" href="#bdrafts/view/${encodeURIComponent(x.draft)}">${esc(x.draft)}</a>` : x.incl ? '' : '<span class="note">Left out</span>'}</td></tr>
      ${r.open === i ? `<tr class="be-det"><td colspan="${ed ? 10 : 9}">${beDetail(x)}</td></tr>` : ''}`).join('')}</tbody>
      <tfoot><tr>${ed ? '<td></td>' : ''}<td>Total</td>${BE_CATS.map(k => `<td class="num">${sar(brTot(r, k))}</td>`).join('')}<td class="num">${sar(brTot(r, 'subtotal'))}</td><td class="num">${sar(brTot(r, 'vat'))}</td><td class="num">${sar(brTot(r, 'total'))}</td><td></td></tr></tfoot></table></div>${r.res.length ? '' : '<div class="empty">No billable charges for this period.</div>'}`)
    + `<div class="form-foot">${A.join('')}</div>`
    + ibSec2('Activity', `<ul class="rm-tl">${(r.audit || []).slice().reverse().map(h => `<li><b>${esc(h.action)}</b><span>${fmtDate(String(h.at).slice(0, 10))} ${String(h.at).slice(11, 16)} · ${esc(h.by)}</span></li>`).join('')}</ul>`);
}
document.addEventListener('change', e => { const i = e.target.dataset && e.target.dataset.brinc; if (i == null) return; const r = brR(location.hash.split('/').slice(2).join('/')); if (!r || r.status !== 'Calculated') return; r.res[+i].incl = e.target.checked; beHist(r, (e.target.checked ? 'Included ' : 'Left out ') + clName(r.res[+i].client)); persist(); route(); });

/* ---- 7. Billing drafts ---- */
function draftsPage() {
  const D = (DB.bdrafts || []).slice().reverse(), rows = applyFilt('bd', D, { q: (d, v) => (d.id + ' ' + (d.run || '') + ' ' + clName(d.client)).toLowerCase().includes(v.toLowerCase()) }), act = D.filter(d => d.status !== 'Cancelled');
  return head2('Billing Engine', 'Billing drafts', `<button type="button" class="btn" data-do="bdCsvAll">Export all (CSV)</button>`)
    + kpis4([['Draft invoices', act.length], ['Subtotal, SAR', sar(sum(act, d => d.subtotal))], ['VAT, SAR', sar(sum(act, d => d.vat))], ['Total incl. VAT, SAR', sar(sum(act, d => d.total))]])
    + filterBar('bd', [{ id: 'client', label: 'Customer', options: custOpts2() }, { id: 'status', label: 'Status', options: optA(['Draft Invoice', 'Cancelled']) }, { id: 'q', type: 'text', label: 'Search draft invoice, run, customer' }])
    + card(`${rows.length} draft invoices`, tbl([['Draft invoice no.', d => `<b class="mono">${esc(d.id)}</b>`], ['Customer', d => esc(clName(d.client))], ['Period', d => fmtDate(d.from) + ' – ' + fmtDate(d.to)], ['Billing run', d => `<span class="mono note">${esc(d.run || '—')}</span>`], ['Lines', d => d.lines.length, 1], ['Subtotal', d => sar(d.subtotal), 1], ['VAT', d => sar(d.vat), 1], ['Total, SAR', d => `<b>${sar(d.total)}</b>`, 1], ['Status', d => pill(d.status)]], rows, d => '#bdrafts/view/' + encodeURIComponent(d.id), 'No draft invoices yet. Run the billing engine.'))
    + `<p class="note">Draft invoices are for review and export to the accounting system. They are not tax invoices. Cancelling a draft releases its charges so they can be billed again.</p>`;
}
function draftView(id) {
  const d = bdR(id); if (!d) return head2('Billing Engine', 'Draft invoice not found', '<a class="btn" href="#bdrafts">← Billing drafts</a>') + '<div class="card empty">This draft invoice no longer exists.</div>';
  const c = client(d.client), ch = DB.charges.filter(x => d.charges.includes(x.id)), R = (k, v) => `<div class="rm-row"><span>${k}</span><b>${v == null || v === '' ? '—' : v}</b></div>`;
  const grp = BE_CATS.map(k => ({ k, ch: ch.filter(x => beCat(x) === k) })).filter(g => g.ch.length);
  return head2('<a href="#bdrafts" style="color:inherit">Billing Engine · Billing drafts</a>', 'Draft invoice ' + esc(d.id), `<a class="btn" href="#bdrafts">← Billing drafts</a>${d.status !== 'Cancelled' ? `<button type="button" class="btn danger" data-do="bdCancel" data-id="${esc(d.id)}">Cancel draft invoice</button>` : ''}<button type="button" class="btn" data-do="bdCsv" data-id="${esc(d.id)}">Export detail (CSV)</button><button type="button" class="btn pri" data-do="printPage">Print</button>`)
    + `<section class="card card-b"><div class="vas-hd"><div class="row" style="gap:6px">${pill(d.status)}<span class="pill p-mute">Period ${fmtDate(d.from)} – ${fmtDate(d.to)}</span>${d.run ? `<a class="pill p-mute" href="#billrun/view/${encodeURIComponent(d.run)}">Run ${esc(d.run)}</a>` : ''}<span class="pill p-warn">Draft · not a tax invoice</span></div><div class="rm-cust"><span>Bill to</span><b>${esc(c.name)}</b><span>${d.contract ? 'Contract ' + esc(d.contract) + (d.agr ? ' · ' + esc(d.agr) : '') : 'No active contract'}</span></div></div>
      ${d.status === 'Cancelled' ? '<div class="warnbox" style="margin-top:12px">Cancelled. The charges were released and can be billed in another run.</div>' : ''}</section>
    <div class="rm-doc"><div class="rm-main">
      ${ibSec2('A · Invoice lines', `<div class="tbl-wrap"><table><thead><tr><th>Service code</th><th>Description</th><th>Category</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th><th class="num">VAT %</th><th class="num">VAT</th><th class="num">Total</th></tr></thead><tbody>
        ${d.lines.map(l => `<tr><td class="mono">${esc(l.svc || '—')}</td><td>${esc(l.desc)}${l.src ? `<br><span class="note">${esc(l.src)}</span>` : ''}</td><td>${esc(l.cat || '')}</td><td class="num">${n0(l.qty)}</td><td>${esc(l.unit)}</td><td class="num">${beRate(l.rate)}</td><td class="num"><b>${sar(l.amount)}</b></td><td class="num">${Math.round(l.vatRate * 100)}%</td><td class="num">${sar(l.vat)}</td><td class="num">${sar(l.amount + l.vat)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">Total</td><td class="num">${sar(d.subtotal)}</td><td></td><td class="num">${sar(d.vat)}</td><td class="num">${sar(d.total)}</td></tr></tfoot></table></div>`)}
      ${ibSec2(`B · Supporting detail · ${ch.length} charges`, grp.map(g => `<div class="card-b row" style="justify-content:space-between;padding-bottom:6px"><b>${g.k}</b><span class="note">${g.ch.length} charges · SAR ${sar(sum(g.ch, x => x.amount))}</span></div>${tbl([['Date', x => fmtDate(x.at)], ['Charge', x => `<span class="mono">${esc(x.id)}</span>`], ['Description', x => esc(x.type) + (x.manual ? ' <span class="pill p-mute">Manual</span>' : '')], ['Source document', x => `<span class="mono">${esc(x.ref || '')}</span>`], ['Qty', x => n0(x.qty) + ` <span class="note">${esc(x.note || '')}</span>`, 1], ['Rate', x => beRate(x.rate), 1], ['Amount', x => sar(x.amount), 1]], g.ch, null, '')}`).join('') || '<div class="empty">No charges.</div>')}
    </div><aside class="rm-side">
      <section class="card"><div class="card-h"><h2>Bill to</h2></div><div class="card-b">${R('Customer', esc(c.name))}${R('Arabic name', c.name2 ? `<span dir="rtl" lang="ar">${esc(c.name2)}</span>` : '')}${R('VAT no.', esc(c.vat || ''))}${R('CR no.', esc(c.cr || ''))}${R('Payment terms', esc(d.terms))}</div></section>
      <section class="card"><div class="card-h"><h2>Totals</h2></div><div class="card-b">${BE_CATS.map(k => R(k, sar(sum(d.lines.filter(l => l.cat === k), l => l.amount)))).join('')}<div class="rm-tot">${R('Subtotal', 'SAR ' + sar(d.subtotal))}${R('VAT', 'SAR ' + sar(d.vat))}${R('<b>Total</b>', '<b>SAR ' + sar(d.total) + '</b>')}</div></div></section>
      <section class="card"><div class="card-h"><h2>Activity</h2></div><ul class="rm-tl">${(d.audit || []).slice().reverse().map(h => `<li><b>${esc(h.action)}</b><span>${fmtDate(String(h.at).slice(0, 10))} ${String(h.at).slice(11, 16)} · ${esc(h.by)}</span></li>`).join('')}</ul></section></aside></div>`;
}

/* ---- 8. Exceptions ---- */
function billExceptions() {
  const X = [], add = (kind, ref, cl, detail, act) => X.push({ id: kind + ref, kind, ref, client: cl, detail, act });
  (DB.vas || []).filter(v => v.status === 'Rate pending').forEach(v => add('Rate pending', v.id, v.client, `${svcBy(v.svc).name || v.type} has no contract rate. Work cannot start.`, ['Open', '#vasw/' + v.id]));
  (DB.vas || []).filter(v => v.status === 'Completed' && !v.charge && (v.compQty || 0) > 0).forEach(v => add('Completed, not charged', v.id, v.client, 'Verified work with no charge.', ['Open', '#vasw/' + v.id]));
  (DB.vas || []).filter(v => v.status === 'Awaiting verification').forEach(v => add('Awaiting verification', v.id, v.client, 'Completed VAS work is not charged until a supervisor verifies it.', ['Verify', '#vasw/' + v.id]));
  DB.customers.filter(c => c.status !== 'Inactive' && !ctrActive(c.id)).forEach(c => { const u = DB.charges.filter(x => x.client === c.id && bdFree(x)); add('No active contract', c.id, c.id, u.length ? `${u.length} unbilled charges (SAR ${sar(sum(u, x => x.amount))}) raised without a contract.` : 'Billable work will use standard rates.', ['New contract', '#contracts/new']); });
  DB.contracts.filter(k => ctrState(k) === 'Active' && ctrDaysLeft(k) != null && ctrDaysLeft(k) <= 30).forEach(k => add('Contract expiring', k.id, k.client, `Ends ${fmtDate(k.end)} (${ctrDaysLeft(k)} days).`, ['Open', '#contracts/edit/' + k.id]));
  DB.contracts.filter(k => k.status === 'Pending approval').forEach(k => add('Contract waiting for approval', k.id, k.client, 'Rates are not in force until approved.', ['Open', '#contracts/edit/' + k.id]));
  M.services.filter(s => s.status === 'Active' && !(+s.rate)).forEach(s => add('Service without a rate', s.code, '', `${s.name} has no standard rate.`, ['Set rate', 'do:svcRate:' + s.code]));
  DB.customers.forEach(c => { const st = DB.stock.filter(s => s.client === c.id); [...new Set(st.map(s => { const t = item(s.sku).temp || 'Ambient'; return /froz/i.test(t) ? 'Frozen' : /chill/i.test(t) ? 'Chilled' : 'Ambient'; }))].forEach(t => { const sv = beTempSvc(t); if (!sv || !(ctrRate(c.id, sv.code) || +sv.rate)) add('Storage without a rate', c.id + t, c.id, `${t} pallets held but no storage rate to bill them.`, ['Rate card', '#ratecard']); }); });
  (DB.bruns || []).filter(r => ['Calculated', 'Approved'].includes(r.status) && daysBetween(String(r.created).slice(0, 10), iso(today)) > 3).forEach(r => add('Billing run not sent', r.id, '', `${r.status} since ${fmtDate(String(r.created).slice(0, 10))}.`, ['Open', '#billrun/view/' + r.id]));
  DB.charges.filter(x => bdFree(x) && x.at && daysBetween(x.at, iso(today)) > 45).forEach(x => add('Old unbilled charge', x.id, x.client, `${x.type} from ${fmtDate(x.at)} still not billed.`, ['Billing run', '#billrun/new']));
  return X;
}
function excPage() {
  const X = billExceptions(), f = FILT.bx || {}, rows = X.filter(x => (!f.kind || x.kind === f.kind) && (!f.client || x.client === f.client)), bad = k => /Rate pending|not charged|without a rate/.test(k);
  return head2('Billing Engine', 'Billing exceptions') + filterBar('bx', [{ id: 'kind', label: 'Type', options: optA([...new Set(X.map(x => x.kind))]) }, { id: 'client', label: 'Customer', options: custOpts2() }])
    + card(`${rows.length} exceptions`, tbl([['Type', x => `<span class="pill p-${bad(x.kind) ? 'bad' : 'warn'}">${esc(x.kind)}</span>`], ['Reference', x => `<span class="mono">${esc(x.ref)}</span>`], ['Customer', x => x.client ? esc(clName(x.client)) : '—'], ['Detail', x => esc(x.detail)],
      ['', x => `<div class="rowicons">${/^do:/.test(x.act[1]) ? `<button type="button" class="btn sm pri" data-do="${x.act[1].split(':')[1]}" data-id="${esc(x.act[1].split(':').slice(2).join(':'))}">${x.act[0]}</button>` : `<a class="btn sm pri" href="${esc(x.act[1])}">${x.act[0]}</a>`}</div>`]], rows, null, 'No billing exceptions.'))
    + `<p class="note">Things that stop correct billing: work with no agreed rate, customers without a contract, contracts about to expire, open billing runs and charges not yet billed.</p>`;
}

function billShow(page, mode, id) {
  CUR = { mod: 'billing', sub: page };
  if (page === 'billing') { setTimeout(() => go('#billrun'), 0); return ''; }
  if (page === 'svc') { if (mode === 'new') return svcForm(''); if (mode === 'edit') return svcForm(id); if (mode === 'view') return svcView(id); return svcList(); }
  if (page === 'charges') return mode === 'new' ? chgForm() : chargesPage();
  if (page === 'billrun') return mode === 'new' ? runNew() : mode === 'view' ? runView(id) : runList();
  if (page === 'bdrafts') return mode === 'view' ? draftView(id) : draftsPage();
  return { ratecard: rateCard, custrates: custRates, storage: storagePage, billexc: excPage }[page]();
}
const BILL_PAGES = ['billing', 'svc', 'ratecard', 'custrates', 'charges', 'storage', 'billrun', 'bdrafts', 'billexc'];

/* ---- actions ---- */
Object.assign(DO, {
  beSettings() { formModal('Billing settings', [{ type: 'html', html: '<h3 class="rm-cfgh">Storage</h3>' }, { id: 'stMethod', label: 'Storage charging method', type: 'select', options: [['run', 'Billing run: pallet-days by temperature × contract rate'], ['snapshot', 'Daily storage snapshot charges']], value: beC('stMethod'), full: 1 },
    { id: 'stBasis', label: 'A monthly storage rate is divided by', type: 'select', options: [['30', '30 days'], ['actual', 'Actual days in the month']], value: beC('stBasis') }, { id: 'stMinDays', label: 'Minimum days charged per pallet in a run (0 = none)', type: 'number', min: 0, value: beC('stMinDays') },
    { type: 'html', html: '<h3 class="rm-cfgh">Billing run</h3>' }, ...[['inclStorage', 'Include storage by default'], ['inclHandling', 'Include handling by default'], ['inclVas', 'Include VAS by default'], ['inclTransport', 'Include transport by default'], ['approve', 'Billing run needs approval before draft invoices']].map(([k, l]) => ({ id: k, label: l, type: 'select', options: [['Yes', 'Yes'], ['No', 'No']], value: beC(k) })),
    { id: 'terms', label: 'Default payment terms on draft invoices', type: 'select', options: optA(['Due on receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60']), value: beC('terms') }],
    v => { if (!(+v.stMinDays >= 0) || !Number.isInteger(+v.stMinDays)) throw new Error('Enter the minimum days as a whole number, 0 or more.'); DB.beCfg = { ...v, stMinDays: +v.stMinDays }; invDone('Billing settings saved.'); }); },
  svcTabGo(k) { svcTab = k; route(); },
  svcToggle(code) { const s = svcBy(code); s.status = s.status === 'Inactive' ? 'Active' : 'Inactive'; svcLog(s, 'Marked ' + s.status.toLowerCase()); persist(); route(); toast(code + ' is now ' + s.status.toLowerCase() + '.'); },
  svcRate(code) { const s = svcBy(code);
    formModal('Change standard rate · ' + code, [{ type: 'html', html: `<p class="note" style="margin:0">${esc(s.name)} · now SAR ${sar(s.rate)} per ${esc(s.unit)}. Contract rates and charges already raised do not change.</p>` }, { id: 'rate', label: 'New standard rate, SAR', type: 'number', min: 0, step: '0.01', value: s.rate, req: 1 }, { id: 'eff', label: 'Effective from', type: 'date', value: iso(today), req: 1 }, { id: 'why', label: 'Reason for the change', type: 'textarea', req: 1, full: 1 }],
      v => { if (v.rate === '' || !(+v.rate >= 0)) throw new Error('Enter the new rate.'); if (+v.rate === +s.rate) throw new Error('The new rate is the same as the current rate.'); if (!v.eff) throw new Error('Enter the effective date.'); if (!v.why) throw new Error('Enter the reason for the change.');
        (s.hist = s.hist || []).push({ at: nowStamp(), by: DATA.user.name, from: +s.rate, to: +v.rate, eff: v.eff, why: v.why }); s.rate = +v.rate; s.eff = v.eff; invDone(code + ' standard rate changed to SAR ' + sar(s.rate) + '.'); }, 'Save new rate'); },
  svcSave(mode) { const f = $('#svcForm'), g = n => (f.querySelector(`[name="${n}"]`) || {}).value?.trim() ?? '', code = (location.hash.match(/^#svc\/edit\/(.+)$/) || [])[1]; try {
    const name = g('name'); if (!name) throw new Error('Enter the service name.'); const ed = code && svcBy(decodeURIComponent(code));
    if (M.services.some(x => x.name.toLowerCase() === name.toLowerCase() && (!ed || x.code !== ed.code))) throw new Error('A service item named "' + name + '" already exists.');
    if (!g('unit')) throw new Error('Enter the charge unit.'); if (g('minFee') !== '' && !(+g('minFee') >= 0)) throw new Error('Enter a minimum fee of 0 or more.');
    if (ed) { const ch = []; [['name', 'Name'], ['name2', 'Arabic name'], ['desc', 'Description'], ['unit', 'Charge unit'], ['vat', 'VAT'], ['status', 'Status']].forEach(([k, l]) => { if (String(ed[k] || '') !== g(k)) ch.push(l + ': ' + (ed[k] || '—') + ' → ' + (g(k) || '—')); });
      if (+ed.minFee !== (+g('minFee') || 0)) ch.push('Minimum fee: ' + sar(ed.minFee || 0) + ' → ' + sar(+g('minFee') || 0));
      const catEl = f.querySelector('[name=cat]'); if (!catEl.disabled && catEl.value !== ed.cat) ch.push('Category: ' + ed.cat + ' → ' + catEl.value);
      Object.assign(ed, { name, name2: g('name2'), desc: g('desc'), unit: g('unit'), vat: g('vat'), status: g('status'), minFee: +g('minFee') || 0 }); if (!catEl.disabled) ed.cat = catEl.value;
      if (ch.length) svcLog(ed, 'Edited: ' + ch.join(' · ')); persist(); toast(ed.code + ' saved.'); return go('#svc/view/' + encodeURIComponent(ed.code)); }
    const rate = g('rate'); if (rate === '' || !(+rate >= 0)) throw new Error('Enter the standard rate.');
    const s = svcNorm({ code: svcNextCode(g('cat')), name, name2: g('name2'), cat: g('cat'), unit: g('unit'), rate: +rate, eff: g('eff') || iso(today), minFee: +g('minFee') || 0, vat: g('vat'), desc: g('desc'), status: g('status'), created: iso(today), by: DATA.user.name });
    svcLog(s, 'Created at SAR ' + sar(+rate) + ' per ' + s.unit); M.services.push(s); persist(); toast(s.code + ' · ' + s.name + ' created.'); if (mode === 'new') route(); else go('#svc/view/' + encodeURIComponent(s.code));
  } catch (e) { const el = $('#svcErr'); el.textContent = e.message; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } },
  rcCsv() { csvDownload('standard-rate-card-' + iso(today) + '.csv', [['Code', 'Service', 'Category', 'Unit', 'Standard rate SAR', 'Minimum fee SAR', 'VAT', 'Effective from', 'Status'], ...M.services.map(s => [s.code, s.name, s.cat, s.unit, s.rate, s.minFee || 0, s.vat, s.eff, s.status])]); },
  chgCsv() { csvDownload('charges-' + iso(today) + '.csv', [['Charge', 'Date', 'Customer', 'Category', 'Service code', 'Description', 'Source', 'Qty', 'Rate', 'Amount SAR', 'Billing', 'Draft invoice'], ...applyFilt('chg', DB.charges, { cat: (c, v) => beCat(c) === v, billed: (c, v) => chgState(c) === v }).map(c => [c.id, c.at, clName(c.client), beCat(c), c.svc || '', c.type, c.ref || '', c.qty, c.rate, c.amount, chgState(c), chgDraft(c)])]); },
  chgSave(mode) { const v = chgRead(); try {
    if (!v.client) throw new Error('Choose the customer.'); if (!v.at) throw new Error('Enter the charge date.'); if (v.at > iso(today)) throw new Error('The charge date cannot be in the future.');
    const s = svcBy(v.svc); if (!s.code) throw new Error('Choose the service item.'); if (!(+v.qty > 0)) throw new Error('Enter a quantity above 0.'); if (v.rate === '' || !(+v.rate >= 0)) throw new Error('Enter the rate.');
    const cr = ctrRate(v.client, s.code), base = +v.qty * +v.rate, amt = Math.max(base, +((cr && cr.minFee) || s.minFee || 0));
    const c = { id: seqNo('CHG', 'CHG-', 5), at: v.at, client: v.client, type: s.name, svc: s.code, ref: v.ref || 'Manual', qty: +v.qty, rate: +v.rate, amount: +amt.toFixed(2), note: 'per ' + s.unit + (amt > base ? ' · minimum fee applied' : ''), memo: v.note, invoice: '', vat: v.vat, rateSrc: cr && +cr.rate === +v.rate ? 'Contract ' + ctrActive(v.client).id : +s.rate === +v.rate ? 'Standard rate' : 'Manual rate', manual: 1, by: DATA.user.name };
    DB.charges.push(c); persist(); chgD = null; toast(c.id + ' raised: SAR ' + sar(c.amount) + ' for ' + clName(c.client) + '.'); if (mode === 'new') { chgD = { ...v, svc: '', qty: 1, rate: '', ref: '', note: '' }; route(); } else go('#charges');
  } catch (e) { const el = $('#chgErr'); el.textContent = e.message; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } },
  chgDel(id) { const c = DB.charges.find(x => x.id === id); if (!c || !c.manual || !bdFree(c)) return toast('Only unbilled manual charges can be deleted.'); if (!confirm('Delete charge ' + id + ' (SAR ' + sar(c.amount) + ')?')) return; DB.charges = DB.charges.filter(x => x !== c); persist(); route(); toast(id + ' deleted.'); },
  stCapture() { const at = iso(today); DB.stSnaps = DB.stSnaps || []; if (DB.stSnaps.some(x => x.at === at)) return toast("Today's storage is already captured.");
    const rows = storageNow(), snap = { at, by: DATA.user.name, rows, charges: [] };
    if (beC('stMethod') === 'snapshot') rows.forEach(r => { if (!r.amount) return; const sv = svcBy(r.svc), c = { id: seqNo('CHG', 'CHG-', 5), at, client: r.client, type: 'Storage — ' + r.temp, svc: r.svc, ref: 'SNAP-' + at, qty: r.n, rate: +r.rate.toFixed(4), amount: r.amount, note: 'pallets · ' + r.temp, invoice: '', vat: sv.vat || '0.15', rateSrc: r.src + ' rate' }; DB.charges.push(c); snap.charges.push(c.id); });
    DB.stSnaps.push(snap); persist(); route(); toast(snap.charges.length ? snap.charges.length + ' storage charges raised for today.' : "Today's storage captured for reference."); },
  brQuick(k) { const t = iso(today), y = +t.slice(0, 4), m = +t.slice(5, 7), pad = n => String(n).padStart(2, '0'), last = (yy, mm) => new Date(yy, mm, 0).getDate(), o = brNewInit(); brReadForm();
    if (k === 'tm') { o.from = t.slice(0, 8) + '01'; o.to = t; } else if (k === 'lm') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; o.from = `${yy}-${pad(mm)}-01`; o.to = `${yy}-${pad(mm)}-${last(yy, mm)}`; } else if (k === 'h1') { o.from = t.slice(0, 8) + '01'; o.to = t.slice(0, 8) + '15'; } else { o.from = t.slice(0, 8) + '16'; o.to = t.slice(0, 8) + last(y, m); }
    o.open = null; route(); },
  brPrev(i) { brReadForm(); const o = brNewInit(); o.open = o.open === +i ? null : +i; route(); },
  brDet(i) { const r = brR(location.hash.split('/').slice(2).join('/')); if (!r) return; r.open = r.open === +i ? null : +i; route(); },
  brRunOne(cl) { brReadForm(); brNewInit().sel = [cl]; DO.brRun(); },
  brRun() { const box = $('#brErr'); try { brReadForm(); const o = brNewInit();
    if (!o.from || !o.to) throw new Error('Enter the billing period.'); if (o.from > o.to) throw new Error('Period from must be before period to.'); if (o.from > iso(today)) throw new Error('The period cannot start in the future.');
    if (!Object.values(o.inc).some(Boolean)) throw new Error('Choose at least one type of charge.'); if (!o.sel || !o.sel.length) throw new Error('Select at least one customer.');
    const busy = brBusy(o), clash = o.sel.find(c => busy[c]); if (clash) throw new Error(clName(clash) + ' is in open billing run ' + busy[clash] + ' for an overlapping period. Send or cancel it first.');
    const run = { from: o.from, to: o.to, inc: { ...o.inc }, clients: o.sel.slice() }, res = beCompute(run); if (!res.length) throw new Error('Nothing to bill for the selected customers.');
    const r = { id: beNo('BR'), ...run, method: beC('stMethod'), res, status: 'Calculated', created: new Date().toISOString(), createdBy: DATA.user.name, audit: [] };
    beHist(r, `Billing engine run · ${res.length} customer${res.length === 1 ? '' : 's'} · SAR ${sar(sum(res, x => x.total))} incl. VAT`); DB.bruns.push(r); brNew = null; persist(); toast(r.id + ' calculated. Review and approve it.'); go('#billrun/view/' + encodeURIComponent(r.id));
  } catch (e) { if (box) { box.textContent = e.message; box.scrollIntoView({ block: 'center' }); } toast(e.message); } },
  brRecalc(id) { const r = brR(id); if (r.status !== 'Calculated') return toast('Only runs under review can be recalculated.'); const keep = {}; r.res.forEach(x => keep[x.client] = x.incl); r.res = beCompute(r); r.res.forEach(x => { if (x.client in keep) x.incl = keep[x.client]; }); beHist(r, 'Recalculated · SAR ' + sar(brTot(r, 'total'))); persist(); route(); toast(id + ' recalculated.'); },
  brCancel(id) { const r = brR(id); if (!['Calculated', 'Approved'].includes(r.status)) return toast('This run can no longer be cancelled.'); formModal('Cancel ' + id, [{ id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.'); r.status = 'Cancelled'; beHist(r, 'Cancelled: ' + v.why); invDone(id + ' cancelled.'); }, 'Cancel run'); },
  brApprove(id) { const r = brR(id); if (r.status !== 'Calculated') return toast('Not waiting for approval.'); if (!r.res.some(x => x.incl)) return toast('No customers are included in this run.'); r.status = 'Approved'; r.approvedBy = DATA.user.name; beHist(r, 'Reviewed and approved · SAR ' + sar(brTot(r, 'total')));
    if (beC('approve') !== 'Yes') return DO.brSend(id); persist(); route(); toast(id + ' approved. Send it to create the draft invoices.'); },
  brReopen(id) { const r = brR(id); if (r.status !== 'Approved') return; r.status = 'Calculated'; beHist(r, 'Returned to review'); persist(); route(); },
  brSend(id) { const r = brR(id); if (r.status !== 'Approved') return toast('Approve the run first.'); const at = r.to > iso(today) ? iso(today) : r.to, made = [];
    r.res.filter(x => x.incl).forEach(x => { const d = beDraftFromRun(r, x, at); x.draft = d.id; made.push(d.id); });
    r.status = 'Sent'; r.sentAt = iso(today); beHist(r, `Sent · ${made.length} draft invoice${made.length === 1 ? '' : 's'} created: ${made.join(', ')}`); persist(); route(); toast(made.length + ' draft invoice' + (made.length === 1 ? '' : 's') + ' created in Billing drafts.'); },
  brPrint(id) { const r = brR(id); modal('Billing run summary ' + esc(r.id), `<div class="rm-print"><div class="rm-ph"><div><h3>Billing Run Summary</h3><div class="note">${esc(DATA.company)}</div></div><div style="text-align:right"><b class="mono">${esc(r.id)}</b><div class="note">${esc(r.status)} · ${fmtDate(r.from)} – ${fmtDate(r.to)}</div></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Customer</th>${BE_CATS.map(k => `<th class="num">${k}</th>`).join('')}<th class="num">Subtotal</th><th class="num">VAT</th><th class="num">Total</th></tr></thead><tbody>${r.res.filter(x => x.incl).map(x => `<tr><td>${esc(clName(x.client))}</td>${BE_CATS.map(k => `<td class="num">${sar(x[k])}</td>`).join('')}<td class="num">${sar(x.subtotal)}</td><td class="num">${sar(x.vat)}</td><td class="num"><b>${sar(x.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td>${BE_CATS.map(k => `<td class="num">${sar(brTot(r, k))}</td>`).join('')}<td class="num">${sar(brTot(r, 'subtotal'))}</td><td class="num">${sar(brTot(r, 'vat'))}</td><td class="num">${sar(brTot(r, 'total'))}</td></tr></tfoot></table></div>
      <div class="rm-sig"><div>Prepared by</div><div>Reviewed by</div><div>Approved by</div></div></div>`, `<button type="button" class="btn" data-do="mClose">Close</button><button type="button" class="btn pri" data-do="rmaPrint">Print</button>`, 'lpn-modal'); },
  bdCancel(id) { const d = bdR(id); if (d.status === 'Cancelled') return toast('Already cancelled.');
    formModal('Cancel ' + id, [{ type: 'html', html: '<p class="note" style="margin:0">Handling, VAS and transport charges go back to unbilled. Storage charges created by the billing run are removed, so the period can be billed again.</p>' }, { id: 'why', label: 'Reason', type: 'textarea', req: 1 }], v => { if (!v.why) throw new Error('Enter the reason.');
      DB.charges = DB.charges.filter(c => !(c.bdraft === d.id && c.engine)); DB.charges.forEach(c => { if (c.bdraft === d.id) delete c.bdraft; }); d.status = 'Cancelled'; beHist(d, 'Cancelled: ' + v.why); const r = brR(d.run); if (r) beHist(r, 'Draft invoice ' + d.id + ' cancelled'); invDone(id + ' cancelled. Charges released.'); }, 'Cancel draft invoice'); },
  bdCsv(id) { const d = bdR(id), ch = DB.charges.filter(x => d.charges.includes(x.id)); beHist(d, 'Detail exported'); persist(); csvDownload(d.id + '-detail.csv', [['Draft invoice', 'Charge', 'Date', 'Category', 'Service code', 'Description', 'Source', 'Qty', 'Rate', 'Amount SAR'], ...ch.map(x => [d.id, x.id, x.at, beCat(x), x.svc || '', x.type, x.ref || '', x.qty, x.rate, x.amount])]); },
  bdCsvAll() { const D = (DB.bdrafts || []).filter(d => d.status !== 'Cancelled'); if (!D.length) return toast('No draft invoices to export.');
    csvDownload('draft-invoices-' + iso(today) + '.csv', [['Draft invoice no.', 'Customer', 'VAT no.', 'Period from', 'Period to', 'Billing run', 'Service code', 'Description', 'Category', 'Qty', 'Unit', 'Rate', 'Amount', 'VAT %', 'VAT', 'Total', 'Payment terms'], ...D.flatMap(d => { const c = client(d.client); return d.lines.map(l => [d.id, c.name, c.vat || '', d.from, d.to, d.run || '', l.svc, l.desc, l.cat || '', l.qty, l.unit, l.rate, l.amount, Math.round(l.vatRate * 100), l.vat, +(l.amount + l.vat).toFixed(2), d.terms]); })]); }
});

/* ---- first-run data: sample handling and transport charges; last month already billed ---- */
function seedBilling() {
  ['bruns', 'bdrafts', 'stSnaps'].forEach(k => { if (!DB[k]) DB[k] = []; }); if (!DB.charges) DB.charges = [];
  if (DB.charges.some(c => c.sample)) return;
  const plan = [['TRN-001', 'OB', 2, 4], ['VAS-006', '', 40, 3], ['VAS-004', '', 2, 6]];
  DB.customers.filter(c => c.status !== 'Inactive').forEach((c, ci) => plan.forEach(([code, src, q, dd], pi) => { if ((ci + pi) % 4 === 3) return; const s = svcBy(code); if (!s.code) return;
    const cr = ctrRate(c.id, code), rate = cr && +cr.rate ? +cr.rate : +s.rate; if (!rate) return;
    const ref = src === 'ASN' ? ((DB.asns.filter(a => a.client === c.id).slice(-1)[0]) || {}).id : src === 'OB' ? ((DB.orders.filter(o => o.client === c.id).slice(-1)[0]) || {}).id : '';
    DB.charges.push({ id: seqNo('CHG', 'CHG-', 5), at: iso(addDays(today, -(dd + ci))), client: c.id, type: s.name, svc: code, ref: ref || 'MAN-SAMPLE', qty: q, rate, amount: +(q * rate).toFixed(2), note: 'per ' + s.unit, invoice: '', vat: s.vat || '0.15', rateSrc: cr ? 'Contract ' + ctrActive(c.id).id : 'Standard rate', manual: 1, by: 'Sample data', sample: 1 }); }));
  // last month: storage already billed and sent, so this month's run starts clean
  const t = iso(today), y = +t.slice(0, 4), m = +t.slice(5, 7), yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1, pad = n => String(n).padStart(2, '0');
  const run = { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${new Date(yy, mm, 0).getDate()}`, inc: { Storage: true, Handling: true, VAS: true, Transport: true }, clients: [] }, res = beCompute(run);
  if (!res.length) return;
  const r = { id: beNo('BR'), ...run, method: 'run', res, status: 'Calculated', created: iso(addDays(noon(run.to), 1)) + 'T09:00:00', createdBy: 'Hamza Kadenja', audit: [] };
  r.audit.push({ at: r.created, action: `Billing engine run · ${res.length} customers · SAR ${sar(sum(res, x => x.total))} incl. VAT`, by: 'Hamza Kadenja' }, { at: r.created.slice(0, 10) + 'T11:30:00', action: 'Reviewed and approved · SAR ' + sar(sum(res, x => x.total)), by: 'Hamza Kadenja' });
  DB.bruns.push(r); r.status = 'Approved'; const at = run.to;
  res.forEach(x => { const d = beDraftFromRun(r, x, at); d.created = r.created.slice(0, 10); d.audit.forEach(h => { h.at = r.created.slice(0, 10) + 'T12:00:00'; h.by = 'Hamza Kadenja'; }); x.draft = d.id; });
  r.status = 'Sent'; r.sentAt = r.created.slice(0, 10); r.audit.push({ at: r.created.slice(0, 10) + 'T12:00:00', action: `Sent · ${res.length} draft invoices created`, by: 'Hamza Kadenja' });
}
