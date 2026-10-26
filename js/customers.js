'use strict';
/* =====================================================================
   CUSTOMERS  (ERP: Customers & Commercial › Customers)
   ===================================================================== */
const COUNTRIES = ['Saudi Arabia','United Arab Emirates','Bahrain','Kuwait','Oman','Qatar','Afghanistan','Albania','Algeria','Andorra','Angola','Argentina','Armenia','Australia','Austria','Azerbaijan','Bangladesh','Belarus','Belgium','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon','Canada','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominican Republic','Ecuador','Egypt','El Salvador','Eritrea','Estonia','Ethiopia','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Guatemala','Guinea','Haiti','Honduras','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kyrgyzstan','Laos','Latvia','Lebanon','Libya','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Macedonia','Norway','Pakistan','Palestine','Panama','Paraguay','Peru','Philippines','Poland','Portugal','Romania','Russia','Rwanda','Senegal','Serbia','Sierra Leone','Singapore','Slovakia','Slovenia','Somalia','South Africa','South Korea','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Togo','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'];
const GCC = ['Saudi Arabia', 'United Arab Emirates', 'Bahrain', 'Kuwait', 'Oman', 'Qatar'];
const CURRENCIES = [['SAR', 'SAR · Saudi riyal'], ['USD', 'USD · US dollar'], ['EUR', 'EUR · Euro'], ['GBP', 'GBP · Pound sterling'], ['AED', 'AED · UAE dirham'], ['BHD', 'BHD · Bahraini dinar'], ['KWD', 'KWD · Kuwaiti dinar'], ['OMR', 'OMR · Omani rial'], ['QAR', 'QAR · Qatari riyal'], ['EGP', 'EGP · Egyptian pound'], ['INR', 'INR · Indian rupee'], ['PKR', 'PKR · Pakistani rupee'], ['CNY', 'CNY · Chinese yuan']];
const TAXES = [['VAT registered', 'VAT registered (KSA)'], ['Non-VAT registered', 'Not VAT registered (KSA)'], ['GCC VAT registered', 'GCC VAT registered'], ['GCC non-VAT registered', 'GCC not VAT registered'], ['Non-GCC', 'Non-GCC']];
const TERMS = [[0, 'Due on receipt'], [15, 'Net 15'], [30, 'Net 30'], [45, 'Net 45'], [60, 'Net 60'], [90, 'Net 90']];
const DOC_KINDS = ['Commercial registration (CR)', 'VAT certificate', 'National address', 'Signed contract', 'Other'];
const INDUSTRIES = ['Food & beverage', 'Electronics', 'Pharmaceutical', 'E-commerce fashion', 'FMCG', 'Automotive parts', 'Building materials'];
const ADDR = [['short', 'Short address (SPL)', 0, 'e.g. JEDA1234'], ['bldg', 'Building no.', 0, '4 digits'], ['district', 'District', 1], ['addl', 'Additional no.', 0, '4 digits'], ['zip', 'Zip code', 0, '5 digits'], ['street', 'Street', 1], ['city', 'City', 1], ['province', 'Province / region', 1], ['country', 'Country', 1]];
const arDigits = s => String(s ?? '').replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const primaryContact = c => (c.contacts || []).find(x => x.primary) || (c.contacts || [])[0] || {};
const termsLabel = c => (TERMS.find(t => t[0] === +c.terms) || [0, c.terms + ' days'])[1];
const fmtAddr = a => a ? [a.bldg && a.street ? a.bldg + ' ' + a.street : a.street, a.district, a.addl ? 'Add. no. ' + a.addl : '', a.city, a.zip, a.province, a.country].filter(Boolean).map(esc).join(', ') + (a.short ? ` · <span class="mono">${esc(a.short)}</span>` : '') : '';
const salesNames = () => [...new Set([...M.users.filter(u => u.sales).map(u => u.name), ...DB.customers.map(c => c.sales).filter(Boolean)])];
const nextCustCode = () => { let n = DB.customers.length + 1, id; do { id = 'CL-' + String(n).padStart(3, '0'); n++; } while (DB.customers.some(c => c.id === id)); return id; };
let custSort = { k: 'name', dir: 1 }, custDocs = [];

const CUST_COLS = [
  { k: 'name', h: 'Name', s: c => c.name.toLowerCase(), v: c => `<b>${esc(c.name)}</b>${c.name2 ? `<br><span class="note" dir="rtl" lang="ar">${esc(c.name2)}</span>` : ''}` },
  { k: 'company', h: 'Company name', s: c => (c.company || '').toLowerCase(), v: c => esc(c.company) || '—' },
  { k: 'terms', h: 'Payment terms', s: c => +c.terms, v: termsLabel },
  { k: 'sales', h: 'Sales person', s: c => c.sales || '', v: c => esc(c.sales) || '<span class="note">Not assigned</span>' },
  { k: 'status', h: 'Status', s: c => c.status, v: c => pill(c.status || 'Active') },
  { k: 'recv', h: 'Receivables, SAR', n: 1, s: c => +c.recv || 0, v: c => { const over = c.credit && c.recv > c.credit; return `<b style="color:${over ? 'var(--bad)' : 'inherit'}">${sar(c.recv)}</b>${over ? '<br><span class="pill p-bad">Over limit</span>' : ''}`; } },
  { k: 'unused', h: 'Unused credits, SAR', n: 1, s: c => +c.unused || 0, v: c => c.unused ? `<b style="color:var(--good)">${sar(c.unused)}</b>` : sar(0) }
];

function customersPage() {
  const rows = applyFilt('cust', DB.customers, { q: (c, v) => [c.id, c.name, c.name2, c.company, c.vat, c.sales].join(' ').toLowerCase().includes(v.toLowerCase()) });
  const sc = CUST_COLS.find(x => x.k === custSort.k) || CUST_COLS[0];
  rows.sort((a, b) => { const x = sc.s(a), y = sc.s(b); return (x < y ? -1 : x > y ? 1 : 0) * custSort.dir; });
  const arrow = k => custSort.k === k ? (custSort.dir > 0 ? ' ▲' : ' ▼') : '';
  const body = rows.length ? `<div class="tbl-wrap"><table><thead><tr>${CUST_COLS.map(c => `<th class="${c.n ? 'num' : ''}" aria-sort="${custSort.k === c.k ? (custSort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sorth" data-do="csort" data-id="${c.k}">${c.h}${arrow(c.k)}</button></th>`).join('')}<th aria-label="Actions"></th></tr></thead>
    <tbody>${rows.map(c => `<tr class="click" data-href="#customers/edit/${encodeURIComponent(c.id)}">${CUST_COLS.map(col => `<td class="${col.n ? 'num' : ''}">${col.v(c)}</td>`).join('')}
      <td class="num" style="width:1%"><div class="rowicons"><a class="icon-btn" href="#customers/edit/${encodeURIComponent(c.id)}" aria-label="Edit ${esc(c.name)}" title="Edit">${ICO.edit}</a><button type="button" class="icon-btn danger" data-do="delCust" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}" title="Delete">${ICO.del}</button></div></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="num">${sar(sum(rows, c => +c.recv || 0))}</td><td class="num">${sar(sum(rows, c => +c.unused || 0))}</td><td></td></tr></tfoot></table></div>`
    : '<div class="empty">No customers match.</div>';
  return head2('Customers &amp; Commercial', 'Customers', `<a class="btn pri" href="#customers/new">+ New customer</a>`)
    + filterBar('cust', [{ id: 'type', label: 'Type', options: optA(['Business', 'Individual']) }, { id: 'sales', label: 'Sales person', options: optA(salesNames()) },
      { id: 'tax', label: 'Tax treatment', options: TAXES }, { id: 'status', label: 'Status', options: optA(['Active', 'Inactive']) }, { id: 'q', type: 'text', label: 'Search name, code, VAT no.' }])
    + card(`${rows.length} customer${rows.length === 1 ? '' : 's'}`, body);
}

const lab = (t, req) => `<span>${t}${req ? '<span class="req"> *</span>' : ''}</span>`;
const cuIn = (id, label, val, extra = '', req) => `<label class="field" for="cu_${id}">${lab(label, req)}<input id="cu_${id}" name="${id}" value="${esc(val ?? '')}" autocomplete="off" ${extra}></label>`;
const cuSel = (id, label, opts, val, req) => `<label class="field" for="cu_${id}">${lab(label, req)}<select id="cu_${id}" name="${id}">${opt(opts.map(([k, l]) => [String(k), l]), String(val ?? ''))}</select></label>`;
const seg = (name, label, opts, val) => `<div class="field"><span id="cu_${name}_l">${label}</span><div class="seg" role="radiogroup" aria-labelledby="cu_${name}_l">${opts.map(o => `<label><input type="radio" name="${name}" value="${o}" ${val === o ? 'checked' : ''}>${o}</label>`).join('')}</div></div>`;
const addrGrid = (p, a) => `<div class="ad2"><span></span><span class="ad2-h">In Primary Language</span><span class="ad2-h">In Secondary Language <b>(Arabic)</b></span>
  ${ADDR.map(([k, l, ar, ph]) => `<label class="ad2-l" for="${p}_${k}">${l}</label>${ar
    ? (k === 'country' ? `<select id="${p}_${k}" name="${p}_${k}" class="ad2-sel">${opt(optA(COUNTRIES), a[k] || 'Saudi Arabia')}</select>` : `<input id="${p}_${k}" name="${p}_${k}" value="${esc(a[k] || '')}" autocomplete="off">`)
      + `<input id="${p}_${k}_ar" name="${p}_${k}_ar" dir="rtl" lang="ar" value="${esc(a[k + 'Ar'] || (k === 'country' && (a.country || 'Saudi Arabia') === 'Saudi Arabia' ? 'المملكة العربية السعودية' : ''))}" aria-label="${l} in Arabic" autocomplete="off">`
    : `<input id="${p}_${k}" name="${p}_${k}" class="mono" value="${esc(a[k] || '')}" placeholder="${ph || ''}" autocomplete="off"><input class="ad2-auto" data-arof="${p}_${k}" dir="rtl" lang="ar" value="${esc(arDigits(a[k] || ''))}" readonly tabindex="-1" aria-label="${l} in Arabic digits (automatic)" title="Filled automatically">`}`).join('')}</div>`;
const contactRow = c => `<tr><td><input type="radio" name="primary" ${c.primary ? 'checked' : ''} aria-label="Primary contact"></td>
  <td><select data-c="sal" aria-label="Salutation">${opt(optA(['', 'Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Eng.']), c.sal || '')}</select></td>
  ${[['name', 'Name'], ['desig', 'Designation'], ['email', 'Email'], ['phone', 'Phone'], ['mobile', 'Mobile'], ['dept', 'Department']].map(([k, l]) => `<td><input data-c="${k}" value="${esc(c[k] || '')}" aria-label="${l}" ${k === 'email' ? 'type="email"' : ''} autocomplete="off"></td>`).join('')}
  <td><button type="button" class="icon-btn" data-do="delContact" aria-label="Remove contact">×</button></td></tr>`;
const docList = () => custDocs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Document</th><th class="num">Size</th><th>Added</th><th></th></tr></thead><tbody>${custDocs.map((d, i) => `<tr><td><b>${esc(d.name)}</b><br><span class="note">${esc(d.kind)}</span></td><td class="num">${d.size > 1e6 ? (d.size / 1e6).toFixed(1) + ' MB' : Math.ceil(d.size / 1024) + ' KB'}</td><td>${fmtDate(d.at)}</td><td class="num"><button type="button" class="btn sm danger" data-do="delDoc" data-id="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="note" style="margin:0">No documents yet.</p>';

function customerForm(id) {
  const ed = !!client(id).id;
  const c = ed ? JSON.parse(JSON.stringify(client(id))) : cust(nextCustCode(), '', '', '', { billing: { country: 'Saudi Arabia' }, contacts: [{ primary: true }], terms: +modCfg('clients', 'terms'), credit: +modCfg('clients', 'credit') || 0, currency: modCfg('clients', 'currency'), rule: modCfg('clients', 'rule'), sla: +modCfg('clients', 'sla') });
  custDocs = (c.docs || []).slice();
  const buttons = `<a class="btn" href="#customers">Cancel</a>${ed ? `<button class="btn danger" type="button" data-do="delCust" data-id="${esc(c.id)}">Delete</button>` : '<button class="btn" type="button" data-do="saveCust" data-id="new">Save &amp; new</button>'}<button class="btn pri" type="button" data-do="saveCust" data-id="${ed ? esc(c.id) : ''}">${ed ? 'Save changes' : 'Save customer'}</button>`;
  const tabs = [['details', 'Details'], ['address', 'Address'], ['contacts', 'Contact persons'], ['remarks', 'Remarks']];
  const html = `${head2('Customers &amp; Commercial / Customers / ' + (ed ? 'Edit' : 'New'), ed ? esc(c.name) : 'New customer', buttons)}
  <form id="custForm" novalidate onsubmit="return false" style="display:flex;flex-direction:column;gap:14px" data-edit="${ed ? esc(c.id) : ''}">
  <div class="err" id="cuErr" role="alert"></div>
  <section class="card"><div class="card-b fgrid f2">
    ${seg('type', 'Customer type', ['Business', 'Individual'], c.type)}
    ${cuIn('id', 'Customer code', c.id, `class="mono" ${ed ? 'disabled' : ''}`, 1)}
    <label class="field" for="cu_company" id="cu_companyF">${lab('Company name', 1)}<input id="cu_company" name="company" value="${esc(c.company || '')}" autocomplete="off" placeholder="Legal name as on the CR"></label>
    <span id="cu_gap" aria-hidden="true"></span>
    <label class="field" for="cu_name"><span id="cu_name_l">Display name (English)<span class="req"> *</span></span><input id="cu_name" name="name" value="${esc(c.name)}" autocomplete="off" placeholder="Name shown on screens and documents" data-auto="${ed ? '0' : '1'}"></label>
    ${cuIn('name2', 'Display name (Arabic)', c.name2, 'dir="rtl" lang="ar" placeholder="الاسم المعروض"')}
    ${cuIn('email', 'Email address', c.email, 'type="email"')}${cuIn('phone', 'Phone', c.phone, 'type="tel" placeholder="+966 12 345 6789"')}
    ${cuSel('lang', 'Customer language', optA(['English', 'Arabic']), c.lang)}
    ${seg('status', 'Status', ['Active', 'Inactive'], c.status || 'Active')}
  </div></section>
  <nav class="tabs" aria-label="Customer sections">${tabs.map(([k, l], i) => `<button type="button" class="tab ${i ? '' : 'on'}" data-do="ctab" data-id="${k}">${l}</button>`).join('')}</nav>

  <div data-pane="details" style="display:flex;flex-direction:column;gap:14px">
  <section class="card"><div class="card-h"><h2>Tax, payment and sales</h2><span class="note" id="cu_indNote" hidden>Individual customer: no VAT, tax or CR details needed.</span></div><div class="card-b fgrid f2">
    <span id="cu_taxBox" style="display:contents">${cuSel('tax', 'Tax treatment', TAXES, c.tax, 1)}
    <span id="cu_vatF" style="display:contents">${cuIn('vat', 'VAT registration number', c.vat, 'class="mono" placeholder="15 digits, e.g. 310123456700003"', 1)}</span>
    ${cuSel('place', 'Place of supply', optA(COUNTRIES), c.place, 1)}
    ${cuIn('cr', 'CR no.', c.cr, 'class="mono" placeholder="10 digits"')}</span>
    ${cuSel('currency', 'Currency', CURRENCIES, c.currency)}
    ${cuIn('credit', 'Credit limit, SAR', c.credit || '', 'type="number" min="0" step="1000" placeholder="0 = no limit"')}
    ${cuSel('terms', 'Payment terms', TERMS, c.terms)}
    ${cuSel('sales', 'Sales person', [['', 'Not assigned'], ...optA(salesNames())], c.sales || '')}
  </div></section>
  <section class="card"><div class="card-h"><h2>Warehouse service</h2></div><div class="card-b fgrid f2">
    ${cuIn('industry', 'Industry', c.industry, 'list="dl_ind"')}
    ${cuSel('rule', 'Picking rule', [['FEFO', 'FEFO (first expiry, first out)'], ['FIFO', 'FIFO (first in, first out)']], c.rule)}
    ${cuIn('sla', 'Dispatch SLA, hours', c.sla, 'type="number" min="1"')}
  </div></section>
  <section class="card"><div class="card-h"><h2>Documents</h2><span class="note">CR, VAT certificate, contract</span></div><div class="card-b" style="display:flex;flex-direction:column;gap:10px">
    <div class="row" style="align-items:flex-end"><label class="field" for="cu_dockind" style="min-width:220px"><span>Document type</span><select id="cu_dockind">${opt(optA(DOC_KINDS), DOC_KINDS[0])}</select></label>
      <label class="btn" for="cu_file">Attach files<input id="cu_file" type="file" multiple style="position:absolute;opacity:0;width:1px;height:1px"></label></div>
    <div id="docList">${docList()}</div>
    <span class="note">This web app keeps the file name, type and size. Production stores the files on the server.</span>
  </div></section></div>

  <div data-pane="address" hidden style="display:flex;flex-direction:column;gap:14px">
  <section class="card"><div class="card-h"><h2>Billing address</h2><span class="note">Saudi national address. Printed on ZATCA tax invoices.</span></div><div class="card-b">${addrGrid('b', c.billing || {})}</div></section>
  <section class="card"><div class="card-h"><h2>Shipping address</h2><label class="chk"><input type="checkbox" name="sameShip" ${c.sameShip !== false ? 'checked' : ''}>Same as billing address</label></div>
    <div class="card-b" id="shipBox" ${c.sameShip !== false ? 'hidden' : ''}>${addrGrid('s', c.shipping || {})}</div></section></div>

  <div data-pane="contacts" hidden style="display:flex;flex-direction:column;gap:14px">
  <section class="card"><div class="card-h"><h2>Contact persons</h2><button type="button" class="btn sm" data-do="addContact">+ Add contact</button></div>
    <div class="tbl-wrap"><table class="ctab"><thead><tr><th title="Primary">Main</th><th>Title</th><th>Name</th><th>Designation</th><th>Email</th><th>Phone</th><th>Mobile</th><th>Department</th><th></th></tr></thead>
    <tbody id="contactRows">${(c.contacts && c.contacts.length ? c.contacts : [{ primary: true }]).map(contactRow).join('')}</tbody></table></div></section>
  <section class="card"><div class="card-h"><h2>Communication preference</h2></div><div class="card-b row" style="gap:6px 22px">
    ${[['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp']].map(([k, l]) => `<label class="chk"><input type="checkbox" name="comm_${k}" ${(c.comm || {})[k] ? 'checked' : ''}>${l}</label>`).join('')}
  </div></section></div>

  <div data-pane="remarks" hidden>
  <section class="card"><div class="card-h"><h2>Remarks</h2><span class="note">Internal only. Not printed on documents.</span></div><div class="card-b"><label class="field" for="cu_remarks"><span>Remarks</span><textarea id="cu_remarks" name="remarks" rows="6">${esc(c.remarks || '')}</textarea></label></div></section></div>
  <div class="form-foot">${buttons}</div>
  </form><datalist id="dl_ind">${[...new Set([...INDUSTRIES, ...DB.customers.map(x => x.industry).filter(Boolean)])].map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  setTimeout(() => updateCustForm(), 0);
  return html;
}

function updateCustForm(t) {
  const fm = $('#custForm'); if (!fm) return; const q = n => fm.querySelector(`[name="${n}"]`);
  const biz = fm.querySelector('[name="type"]:checked').value === 'Business';
  $('#cu_companyF').hidden = !biz; $('#cu_gap').hidden = !biz;
  $('#cu_taxBox').style.display = biz ? 'contents' : 'none'; $('#cu_indNote').hidden = biz;
  $('#cu_name_l').firstChild.textContent = biz ? 'Display name (English)' : 'Full name (English)';
  const tax = q('tax').value, needVat = biz && /VAT registered$/.test(tax) && !/non-VAT/i.test(tax);
  $('#cu_vatF').style.display = needVat ? 'contents' : 'none';
  $('#shipBox').hidden = q('sameShip').checked;
  if (t && /^[bs]_(short|bldg|addl|zip)$/.test(t.name || '')) { const o = fm.querySelector(`[data-arof="${t.name}"]`); if (o) o.value = arDigits(t.value.toUpperCase()); }
  if (t && t.name === 'company') { const dn = q('name'); if (dn.dataset.auto === '1') dn.value = t.value; }
  if (t && t.name === 'name') t.dataset.auto = t.value ? '0' : '1';
  if (t && t.name === 'tax') { const pl = q('place'); if (['VAT registered', 'Non-VAT registered'].includes(tax)) pl.value = 'Saudi Arabia'; else if (/^GCC/.test(tax) && !GCC.slice(1).includes(pl.value)) pl.value = 'United Arab Emirates'; else if (tax === 'Non-GCC' && GCC.includes(pl.value)) pl.value = 'Egypt'; }
}

function readCustForm() {
  const fm = $('#custForm'), g = n => { const el = fm.querySelector(`[name="${n}"]`); return !el ? '' : el.type === 'checkbox' ? el.checked : el.value.trim(); };
  const ad = p => Object.fromEntries(ADDR.flatMap(([k, , ar]) => ar ? [[k, g(p + '_' + k)], [k + 'Ar', g(p + '_' + k + '_ar')]] : [[k, g(p + '_' + k).toUpperCase()]]));
  const old = client(fm.dataset.edit);
  const d = { ...old, id: g('id').toUpperCase(), type: fm.querySelector('[name="type"]:checked').value, company: g('company'), name: g('name'), name2: g('name2'), email: g('email'), phone: g('phone'), lang: g('lang'),
    status: fm.querySelector('[name="status"]:checked').value, tax: g('tax'), vat: g('vat'), place: g('place'), cr: g('cr'), currency: g('currency'), credit: +g('credit') || 0, terms: +g('terms'),
    sales: g('sales'), industry: g('industry'), rule: g('rule'), sla: +g('sla') || 24, billing: ad('b'), sameShip: g('sameShip'), shipping: ad('s'),
    contacts: [...fm.querySelectorAll('#contactRows tr')].map(r => { const o = { primary: r.querySelector('[name="primary"]').checked }; r.querySelectorAll('[data-c]').forEach(x => o[x.dataset.c] = x.value.trim()); return o; }).filter(x => x.name || x.email || x.phone || x.mobile),
    comm: { email: g('comm_email'), phone: g('comm_phone'), whatsapp: g('comm_whatsapp') }, remarks: g('remarks'), docs: custDocs.slice(), recv: old.recv || 0, unused: old.unused || 0 };
  if (d.contacts.length && !d.contacts.some(x => x.primary)) d.contacts[0].primary = true;
  if (d.type === 'Individual') Object.assign(d, { company: '', tax: 'Non-VAT registered', vat: '', cr: '', place: 'Saudi Arabia' });
  return d;
}
const custErr = (msg, tab) => { const e = new Error(msg); e.tab = tab; return e; };
function validateCustomer(d, editId) {
  const em = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, ph = /^\+?[\d\s()-]{7,20}$/;
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(d.id)) throw custErr('The customer code uses letters, digits and dashes.');
  if (!editId && DB.customers.some(c => c.id === d.id)) throw custErr('Customer code ' + d.id + ' is already used.');
  if (d.type === 'Business' && !d.company) throw custErr('Enter the company name.');
  if (!d.name) throw custErr('Enter the display name in English.');
  if (d.email && !em.test(d.email)) throw custErr('The email address is not valid.');
  if (d.phone && !ph.test(d.phone)) throw custErr('The phone number can use digits, spaces, dashes and a leading +.');
  const ksa = ['VAT registered', 'Non-VAT registered'].includes(d.tax), gcc = /^GCC/.test(d.tax);
  if (ksa && d.place !== 'Saudi Arabia') throw custErr('For a Saudi customer the place of supply is Saudi Arabia.', 'details');
  if (gcc && !GCC.slice(1).includes(d.place)) throw custErr('For a GCC customer, choose a GCC country other than Saudi Arabia as place of supply.', 'details');
  if (d.tax === 'Non-GCC' && GCC.includes(d.place)) throw custErr('A non-GCC customer needs a place of supply outside the GCC.', 'details');
  if (DB.customers.some(c => c.id !== editId && c.name.trim().toLowerCase() === d.name.trim().toLowerCase())) throw custErr('Another customer is already called ' + d.name + '. Use a different display name.');
  if (d.tax === 'VAT registered' && !/^3\d{13}3$/.test(d.vat)) throw custErr('A Saudi VAT number has 15 digits and starts and ends with 3.', 'details');
  if (d.tax === 'GCC VAT registered' && !/^[A-Z0-9]{9,15}$/i.test(d.vat)) throw custErr('Enter the customer\'s GCC VAT number (9 to 15 letters or digits).', 'details');
  if (!/VAT registered$/.test(d.tax) || /non-VAT/i.test(d.tax)) d.vat = '';
  if (d.cr && d.place === 'Saudi Arabia' && !/^\d{10}$/.test(d.cr)) throw custErr('A Saudi CR number has 10 digits.', 'details');
  if (d.credit < 0) throw custErr('The credit limit cannot be negative.', 'details');
  const chk = (a, label) => { if (a.country !== 'Saudi Arabia') return;
    if (a.short && !/^[A-Z]{4}\d{4}$/.test(a.short)) throw custErr(label + ': the short address is 4 letters and 4 digits, e.g. JEDA1234.', 'address');
    if (a.bldg && !/^\d{4}$/.test(a.bldg)) throw custErr(label + ': the building number has 4 digits.', 'address');
    if (a.addl && !/^\d{4}$/.test(a.addl)) throw custErr(label + ': the additional number has 4 digits.', 'address');
    if (a.zip && !/^\d{5}$/.test(a.zip)) throw custErr(label + ': the zip code has 5 digits.', 'address'); };
  chk(d.billing, 'Billing address'); if (!d.sameShip) chk(d.shipping, 'Shipping address');
  d.contacts.forEach((x, i) => { if (x.email && !em.test(x.email)) throw custErr('Contact ' + (i + 1) + ': the email address is not valid.', 'contacts'); });
}
const showTab = k => { document.querySelectorAll('#custForm .tab').forEach(b => b.classList.toggle('on', b.dataset.id === k)); document.querySelectorAll('#custForm [data-pane]').forEach(p => p.hidden = p.dataset.pane !== k); };
const formErr = (box, e) => { const el = $(box); el.textContent = e.message; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

/* =====================================================================
   SERVICE QUOTATIONS  (ERP: Customers & Commercial › Service quotations)
   ===================================================================== */
const SD_VAT = [['0.15', 'VAT 15%'], ['0', 'Zero rated 0%'], ['ex', 'Exempt']];
const vrate = v => v === 'ex' || v == null ? 0 : +v;
const QT_STS = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];
const QT_TERMS = '1. Rates are in SAR and exclude VAT (15%) unless shown.\n2. Storage is charged per pallet per month (or per area per month) as listed, from the day of receipt; part months are charged pro rata.\n3. Handling in and out is charged per pallet or carton as listed.\n4. Value-added services are charged on the completed quantity approved by the customer.\n5. Goods are stored at the customer\'s risk unless insured by agreement; Gray Lane liability is limited as stated in the service contract.\n6. Invoices are monthly, payable within the agreed payment terms.\n7. This quotation is valid until the expiry date and becomes binding when a service contract is signed.';
const SVC_CATS = () => [...new Set(M.services.map(s => s.cat))];
const qtBlankLine = () => ({ svc: '', item: '', desc: '', qty: '', unit: '', rate: '', disc: 0, vat: '0.15' });
const quoteBlank = (cl, c) => { const pc = primaryContact(c || {}), u = ME();
  return { id: '', client: cl, loc: 'JED', ref: '', date: iso(today), expiry: iso(addDays(today, 30)), subject: '', fromName: u.name || DATA.user.name, fromMob: u.mobile || '', fromEmail: u.email || '',
    toName: pc.name || '', toMob: pc.mobile || pc.phone || '', toEmail: pc.email || '', lines: [qtBlankLine()], notes: '', terms: QT_TERMS, adjustment: 0, qtCat: '', status: 'Draft', created: iso(today) }; };
function sdCalc(d) { let sub = 0, vat = 0;
  (d.lines || []).forEach(l => { const net = +((+l.qty || 0) * (+l.rate || 0) * (1 - (+l.disc || 0) / 100)).toFixed(2); l.amount = net; sub += net; vat += net * vrate(l.vat); });
  d.subtotal = +sub.toFixed(2); d.vat = +vat.toFixed(2); d.total = +(sub + vat + (+d.adjustment || 0)).toFixed(2); return d; }
const qtState = d => d.status === 'Sent' && d.expiry && d.expiry < iso(today) ? 'Expired' : d.status;
const qtNo = loc => 'QT-' + loc + '-' + String(DB.seq.QT[loc] || 1).padStart(5, '0');
const locName = id => (M.locations.find(l => l.id === id) || {}).name || id;
let qDoc = null;

function quotesPage() {
  const rows = applyFilt('qt', DB.quotes.slice().reverse(), { status: (d, v) => qtState(d) === v, q: (d, v) => [d.id, d.ref, d.subject, clName(d.client)].join(' ').toLowerCase().includes(v.toLowerCase()) });
  const body = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Service quotation #</th><th>Reference</th><th>Customer</th><th>Expiry</th><th>Location</th><th>Status</th><th class="num">Amount, SAR</th></tr></thead><tbody>
    ${rows.map(d => `<tr class="click" data-href="#quotes/edit/${encodeURIComponent(d.id)}"><td>${fmtDate(d.date)}</td><td><b class="mono">${esc(d.id)}</b></td><td>${esc(d.ref || d.subject) || '—'}</td><td><b>${esc(clName(d.client))}</b></td><td>${fmtDate(d.expiry)}</td><td>${esc(locName(d.loc))}</td><td>${pill(qtState(d))}</td><td class="num">${sar(sdCalc(JSON.parse(JSON.stringify(d))).total)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${DB.quotes.length ? 'No service quotations match the filters.' : 'No service quotations yet.'}</div>`;
  return head2('Customers &amp; Commercial', 'Service quotations', `<a class="btn pri" href="#quotes/new">+ New service quotation</a>`)
    + filterBar('qt', [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'status', label: 'Status', options: optA(QT_STS) }, { id: 'q', type: 'text', label: 'Search number, reference, customer' }])
    + card(`${rows.length} service quotation${rows.length === 1 ? '' : 's'}`, body);
}

const qF = (lbl, html, req, cls = '') => `<label class="field ${cls}"><span class="flbl">${lbl}${req ? '<span class="req"> *</span>' : ''}</span>${html}</label>`;
const qtLineRow = (l, i) => { const s = M.services.find(x => x.code === l.svc || x.name === l.item) || {};
  return `<tr class="sd-ln" data-i="${i}"><td class="num pad note">${i + 1}</td>
  <td style="width:130px"><input data-l="svc" list="dl_qtcode" value="${esc(l.svc || s.code || '')}" placeholder="Search code" aria-label="Service code" class="mono" autocomplete="off"></td>
  <td style="min-width:260px"><input data-l="item" list="dl_qtsvc" value="${esc(l.item)}" placeholder="Type or search service name" aria-label="Service name" autocomplete="off"><input data-l="desc" class="sd-desc" value="${esc(l.desc)}" placeholder="Description (optional)" aria-label="Description"></td>
  <td class="note pad" data-cat style="width:90px">${esc(s.cat || '')}</td>
  <td style="width:100px"><input data-l="qty" type="number" step="any" min="0" value="${esc(l.qty)}" aria-label="Estimated quantity" class="num"></td>
  <td class="pad" style="width:110px"><span class="note" data-unitlbl>${esc(l.unit || s.unit || 'Auto')}</span><input data-l="unit" type="hidden" value="${esc(l.unit || s.unit || '')}"></td>
  <td style="width:110px"><input data-l="rate" type="number" step="any" min="0" value="${esc(l.rate)}" aria-label="Rate" class="num"></td>
  <td style="width:80px"><input data-l="disc" type="number" step="any" min="0" max="100" value="${esc(l.disc ?? 0)}" aria-label="Discount %" class="num"></td>
  <td style="min-width:140px"><select data-l="vat" aria-label="VAT">${opt(SD_VAT, String(l.vat ?? '0.15'))}</select></td>
  <td class="sd-amt" style="width:110px">${sar((+l.qty || 0) * (+l.rate || 0) * (1 - (+l.disc || 0) / 100))}</td>
  <td style="width:44px"><button type="button" class="icon-btn del" data-do="qtDelLine" data-id="${i}" aria-label="Remove line ${i + 1}" title="Remove">${TRASH}</button></td></tr>`; };

function quoteForm(d) {
  const ed = !!d.id, cl = client(d.client), no = ed ? d.id : qtNo(d.loc), ct = cl.contacts || [], st = qtState(d);
  const b = cl.billing || {}, sh = cl.sameShip !== false ? b : (cl.shipping || {});
  const extra = st === 'Sent' ? `<button class="btn" type="button" data-do="qtMark" data-id="Declined">Mark declined</button><button class="btn" type="button" data-do="qtMark" data-id="Accepted">Mark accepted</button>`
    : st === 'Accepted' ? `<a class="btn" href="#contracts/new/${encodeURIComponent(d.id)}">Create contract →</a>` : '';
  const btns = `<a class="btn" href="#quotes">Cancel</a>${ed && st === 'Draft' ? '<button class="btn danger" type="button" data-do="qtDelete">Delete draft</button>' : ''}${extra}<button class="btn" type="button" data-do="qtSave" data-id="draft">Save</button><button class="btn pri" type="button" data-do="qtSave" data-id="final">${st === 'Draft' ? 'Save and send' : 'Save and resend'}</button>`;
  const svcs = M.services.filter(s => !d.qtCat || s.cat === d.qtCat);
  return `${head2(`<a href="#quotes" style="color:inherit">Service quotations</a> / ${ed ? esc(d.id) : 'New'}`, ed ? 'Edit service quotation ' + esc(d.id) + ' ' + pill(st) : 'New service quotation', btns)}
  <form id="sdForm" novalidate onsubmit="return false" style="display:flex;flex-direction:column;gap:14px"><div class="err" id="sdErr" role="alert"></div>
  <section class="card"><div class="card-h"><h2>Service quotation details</h2><span class="note" dir="rtl" lang="ar">عرض سعر خدمات</span></div>
  <div class="card-b qt-rows">
    <div class="qt-row"><span class="qt-lbl req">Customer name *</span><div class="qt-val"><select name="client" aria-label="Customer name">${opt(custOpts(), d.client)}</select></div></div>
    <div class="qt-row"><span class="qt-lbl">Customer address</span><div class="qt-addr"><div><span class="qt-cap">Billing address</span><div>${fmtAddr(b) || '<span class="note">Not set</span>'}</div></div><div><span class="qt-cap">Shipping address</span><div>${fmtAddr(sh) || '<span class="note">Not set</span>'}</div></div><div><span class="qt-cap">VAT number</span><div class="mono">${esc(cl.vat || '—')}</div><span class="qt-cap" style="margin-top:8px">Tax treatment</span><div>${esc(cl.tax || '—')}</div></div></div></div>
    <div class="qt-grid">
      ${qF('Location / Branch', `<select name="loc">${opt(M.locations.map(l => [l.id, l.id + ' · ' + l.name]), d.loc)}</select>`, 1)}
      ${qF('Service quotation no. #', `<input value="${esc(no)}" readonly class="mono ro-in" tabindex="-1">`)}
      ${qF('Customer ref. #', `<input name="ref" value="${esc(d.ref)}" placeholder="Customer's RFQ / enquiry no.">`)}
      ${qF('Quote date', `<input type="date" name="date" value="${esc(d.date)}">`, 1)}
      ${qF('Expiry date', `<input type="date" name="expiry" value="${esc(d.expiry)}">`)}
      ${qF('Subject', `<input name="subject" value="${esc(d.subject)}" placeholder="e.g. Ambient storage and handling — 300 pallets">`)}
    </div></div></section>
  <section class="card"><div class="card-h"><div><h2>Contacts</h2><p class="note">Who is sending the quotation and who receives it</p></div></div>
  <div class="card-b qt-contacts">
    <div class="qt-cbox"><h3>From · ${esc(DATA.company)}</h3>
      ${qF('From contact', `<input name="fromName" list="dl_qtfrom" value="${esc(d.fromName)}" autocomplete="off">`, 1)}
      ${qF('From mobile no.', `<input name="fromMob" type="tel" value="${esc(d.fromMob)}" placeholder="+966 5X XXX XXXX">`)}
      ${qF('From email', `<input name="fromEmail" type="email" value="${esc(d.fromEmail)}">`)}</div>
    <div class="qt-cbox"><h3>To · ${esc(cl.name || 'Customer')}</h3>
      ${qF('To contact name', `<input name="toName" list="dl_qtto" value="${esc(d.toName)}" autocomplete="off" placeholder="Choose or type">`, 1)}
      ${qF('To contact mobile', `<input name="toMob" type="tel" value="${esc(d.toMob)}">`)}
      ${qF('To contact email', `<input name="toEmail" type="email" value="${esc(d.toEmail)}">`)}</div>
  </div></section>
  <section class="card"><div class="card-h"><h2>Services &amp; rates</h2><div class="row" style="gap:10px"><span class="note">Unit and rate fill in from Service Items or the customer's contract</span><select name="qtCat" class="catsel" aria-label="Category">${opt([['', 'Category: All'], ...SVC_CATS().map(c => [c, 'Category: ' + c])], d.qtCat || '')}</select></div></div><div class="card-b">
    <div class="tbl-wrap"><table class="sd-lines" style="min-width:1100px"><thead><tr><th class="num">S.No</th><th>Service code</th><th>Service name</th><th>Category</th><th class="num">Est. qty / month</th><th>UOM</th><th class="num">Rate, SAR</th><th class="num">Disc. %</th><th>VAT</th><th class="num">Amount</th><th></th></tr></thead><tbody id="sdLines">${d.lines.map(qtLineRow).join('')}</tbody></table></div>
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-top:10px;gap:20px"><div class="row"><button type="button" class="btn sm" data-do="qtAddLine">+ Add service</button><button type="button" class="btn sm" data-do="qtAddCat">+ Add all ${d.qtCat ? esc(d.qtCat.toLowerCase()) + ' ' : ''}services</button></div>
      <div class="sd-tot"><div><span>Sub total</span><b id="sdSub"></b></div><div><span>VAT</span><b id="sdVat"></b></div><div><span>Adjustment</span><input name="adjustment" type="number" step="any" value="${esc(d.adjustment || 0)}" aria-label="Adjustment"></div><div class="sd-grand"><span>Total, SAR</span><b id="sdTotal"></b></div></div></div></div></section>
  <section class="card"><div class="card-h"><h2>Notes &amp; terms</h2></div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">
    ${qF('Customer notes', `<textarea name="notes" rows="4" placeholder="Shown on the quotation">${esc(d.notes)}</textarea>`)}
    ${qF('Service terms &amp; conditions', `<textarea name="terms" rows="8">${esc(d.terms)}</textarea>`)}</div></section>
  <div class="form-foot">${btns}</div></form>
  <datalist id="dl_qtsvc">${svcs.map(s => `<option value="${esc(s.name)}">${esc(s.code)}</option>`).join('')}</datalist>
  <datalist id="dl_qtcode">${svcs.map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('')}</datalist>
  <datalist id="dl_qtfrom">${M.users.map(u => `<option value="${esc(u.name)}">`).join('')}</datalist>
  <datalist id="dl_qtto">${ct.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>`;
}
function renderQuote(focus) { $('#view').innerHTML = quoteForm(qDoc); qtRecalc(); if (focus) { const el = $(focus); if (el) el.focus(); } }
function readQuote() {
  const fm = $('#sdForm'); if (!fm) return qDoc;
  fm.querySelectorAll('[name]').forEach(el => { qDoc[el.name] = el.value.trim(); });
  qDoc.adjustment = +qDoc.adjustment || 0;
  qDoc.lines = [...fm.querySelectorAll('#sdLines .sd-ln')].map(r => { const o = {}; r.querySelectorAll('[data-l]').forEach(x => o[x.dataset.l] = x.value.trim()); return { ...o, disc: o.disc === '' ? 0 : +o.disc }; });
  return qDoc;
}
function qtRecalc() {
  if (!$('#sdForm')) return; const d = sdCalc({ lines: readQuote().lines, adjustment: qDoc.adjustment });
  document.querySelectorAll('#sdLines .sd-ln').forEach((r, i) => { const a = r.querySelector('.sd-amt'); if (a) a.textContent = sar(d.lines[i].amount); });
  $('#sdSub').textContent = sar(d.subtotal); $('#sdVat').textContent = sar(d.vat); $('#sdTotal').textContent = sar(d.total);
}
function qtFill(r, s) { if (!s || !s.code) return;
  r.querySelector('[data-l=svc]').value = s.code; r.querySelector('[data-l=item]').value = s.name; r.querySelector('[data-l=unit]').value = s.unit;
  r.querySelector('[data-unitlbl]').textContent = s.unit; r.querySelector('[data-cat]').textContent = s.cat;
  const rate = r.querySelector('[data-l=rate]'), cr = ctrRate(qDoc.client, s.code); if (!rate.value || rate.value === '0') rate.value = cr ? cr.rate : s.rate; }
function qtValidate(d, final) {
  if (!d.client) throw new Error('Choose the customer.');
  if (!d.date) throw new Error('Enter the quote date.');
  if (d.expiry && d.expiry < d.date) throw new Error('The expiry date is before the quote date.');
  d.lines = d.lines.filter(l => l.svc || l.item || l.desc || l.qty !== '' || l.rate !== '');
  if (!final) return;
  if (!d.lines.length) throw new Error('Add at least one service.');
  d.lines.forEach((l, i) => { const n = 'Line ' + (i + 1) + ': ';
    if (!l.item) throw new Error(n + 'choose the service or remove the empty line.');
    if (!(+l.qty > 0)) throw new Error(n + 'enter the estimated quantity.');
    if (l.rate === '' || +l.rate < 0) throw new Error(n + 'enter the rate.');
    if (+l.disc < 0 || +l.disc > 100) throw new Error(n + 'the discount is between 0 and 100%.'); });
  if (d.toEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.toEmail)) throw new Error('The To contact email is not valid.');
}

/* =====================================================================
   CONTRACTS  (ERP: Customers & Commercial › Contracts)
   ===================================================================== */
const CTR_CYCLES = ['Monthly', 'Bi-weekly', 'Weekly'];
const CTR_STORE = ['Pallet / day', 'Pallet / month', 'm² / month', 'm³ / month', 'Fixed space / month'];
const CTR_INS = ['Customer', 'Gray Lane', 'Shared'];
const CTR_ST = ['Draft', 'Pending approval', 'Active', 'Superseded', 'Expired', 'Terminated'];
const CTR_LIAB_BASIS = ['Per pallet', 'Per kg (gross weight)', 'Declared value per unit', 'Per event only'];
const SD_UNITS = ['Pallet / day', 'Pallet / month', 'Pallet', 'Carton', 'Unit', 'Order', 'Trip', 'Hour', 'Kg', 'CBM', 'Lump sum'];
const CTR_EXCL = 'Force majeure (fire, flood, war, government action)\nInherent vice, natural deterioration or shrinkage of the goods\nInsufficient or improper packing or labelling by the customer\nConcealed damage or shortage inside sealed cartons received intact\nPests or contamination present when the goods arrived\nLoss of market, profit or other indirect loss';
const CTR_LIAB_DEF = { liabBasis: 'Per pallet', liabPallet: 500, liabEvent: 100000, liabYear: 250000, claimNotify: 3, claimSubmit: 30, exclusions: CTR_EXCL, insurance: 'Customer', insurer: '', policyNo: '', sumInsured: 0, policyExpiry: '', coInsured: 'No', lien: 'Yes' };
const ctrBlank = (cl, c = {}, o = {}) => ({ ...CTR_LIAB_DEF, id: '', client: cl || '', ref: '', quote: '', start: iso(today), end: iso(addDays(today, 364)), autoRenew: 'Yes', notice: 60, cycle: 'Monthly',
  terms: +c.terms || 30, credit: +c.credit || 0, vat: '0.15', storeBasis: 'Pallet / day', freeDays: 0, cutoff: '14:00', turnaround: 24, accuracy: 99.5, rcvTurn: 24, notes: '', lines: [], status: 'Draft', version: 1, created: iso(today), ...o });
const ctrState = k => k.status === 'Active' && k.end && k.end < iso(today) ? 'Expired' : k.status;
const ctrDaysLeft = k => k.end ? daysBetween(iso(today), k.end) : null;
const ctrActive = cl => DB.contracts.find(k => k.client === cl && ctrState(k) === 'Active');
const ctrRate = (cl, code) => ((ctrActive(cl) || {}).lines || []).find(l => l.code === code);
function ctrAgrNo(cl, skip) { const nm = (clName(cl) || 'CUS').toUpperCase().replace(/[^A-Z]/g, ''), P = (nm + 'XXX').slice(0, 3) + '-AGR-';
  const used = new Set(DB.contracts.filter(k => k.id !== skip).map(k => k.ref)); let n = 1; while (used.has(P + String(n).padStart(3, '0'))) n++; return P + String(n).padStart(3, '0'); }
const ctrLiabText = k => k.liabBasis === 'Per event only' ? `SAR ${sar(k.liabEvent)} per event` : `SAR ${sar(k.liabPallet)} ${({ 'Per pallet': 'per pallet', 'Per kg (gross weight)': 'per kg', 'Declared value per unit': 'max. of declared value per unit' })[k.liabBasis] || ''}, max. SAR ${sar(k.liabEvent)} per event${k.liabYear ? ', SAR ' + sar(k.liabYear) + ' per year' : ''}`;
let kDoc = null, kRO = false;

function contractsPage() {
  const rows = applyFilt('ctr', DB.contracts.slice().reverse(), { status: (k, v) => ctrState(k) === v });
  const act = DB.contracts.filter(k => ctrState(k) === 'Active'), soon = act.filter(k => ctrDaysLeft(k) != null && ctrDaysLeft(k) <= 60), noCtr = DB.customers.filter(c => c.status !== 'Inactive' && !ctrActive(c.id));
  const body = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Contract</th><th>Customer</th><th>Period</th><th>Billing</th><th class="num">Services</th><th>Status</th></tr></thead><tbody>
    ${rows.map(k => { const st = ctrState(k), d = ctrDaysLeft(k); return `<tr class="click" data-href="#contracts/edit/${encodeURIComponent(k.id)}"><td><b class="mono">${esc(k.id)}</b>${k.version > 1 ? ` <span class="note">v${k.version}</span>` : ''}${k.ref ? `<br><span class="note">${esc(k.ref)}</span>` : ''}</td><td><b>${esc(clName(k.client))}</b></td><td>${fmtDate(k.start)} – ${fmtDate(k.end)}</td><td>${esc(k.cycle)} · ${esc((TERMS.find(t => t[0] === +k.terms) || [0, 'Net ' + k.terms])[1])}</td><td class="num">${k.lines.length}</td>
      <td>${pill(st)}${st === 'Active' && d != null && d <= 60 ? ` <span class="pill p-warn">${d} days left</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">${DB.contracts.length ? 'No contracts match the filters.' : 'No contracts yet.'}</div>`;
  return head2('Customers &amp; Commercial', 'Contracts', `<a class="btn pri" href="#contracts/new">+ New contract</a>`)
    + filterBar('ctr', [{ id: 'client', label: 'Customer', options: DB.customers.map(c => [c.id, c.name]) }, { id: 'status', label: 'Status', options: optA(CTR_ST) }])
    + `<div class="grid g-kpi">${[['Active contracts', act.length], ['Waiting for approval', DB.contracts.filter(k => k.status === 'Pending approval').length], ['Expiring in 60 days', soon.length], ['Customers without a contract', noCtr.length]].map(k => `<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>`
    + (noCtr.length ? `<div class="warnbox"><b>No active contract:</b> ${noCtr.map(c => esc(c.name)).join(', ')}. Billable work for these customers uses standard rates until a contract is approved.</div>` : '')
    + card(`${rows.length} contract${rows.length === 1 ? '' : 's'}`, body)
    + `<p class="note">A contract holds the customer's agreed services and rates, billing terms, storage basis, service levels and liability. It is active only after approval. Approving a contract updates the rates the billing engine uses for that customer; charges already raised keep the rate they were raised with.</p>`;
}

const ctrLineRow = (l, i) => { const sv = svcBy(l.code);
  return `<tr class="ctr-ln" data-i="${i}"><td class="num pad note">${i + 1}</td><td style="min-width:260px"><select data-l="code" aria-label="Service">${!l.code ? '<option value="">Choose service…</option>' : ''}${M.services.map(s => `<option value="${esc(s.code)}" ${s.code === l.code ? 'selected' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}</select></td>
  <td class="note pad" data-cat>${esc(l.cat || sv.cat || '')}</td>
  <td style="width:150px"><input data-l="unit" list="dl_sdunit" value="${esc(l.unit || '')}" aria-label="Unit"></td>
  <td style="width:130px"><input data-l="rate" type="number" step="0.01" min="0" value="${esc(l.rate ?? '')}" aria-label="Contract rate" class="num"></td>
  <td class="note num pad" data-std>${l.code ? sar(sv.rate) : ''}</td>
  <td style="width:120px"><input data-l="minFee" type="number" step="0.01" min="0" value="${esc(l.minFee || '')}" placeholder="0" aria-label="Minimum fee" class="num"></td>
  <td style="width:44px"><button type="button" class="icon-btn del" data-do="ctrDelLine" data-id="${i}" aria-label="Remove line" title="Remove">${TRASH}</button></td></tr>`; };

function contractForm(k) {
  const F = (lbl, html, req, wide) => `<label class="field"${wide ? ' style="grid-column:1/-1"' : ''}><span class="flbl">${lbl}${req ? '<span class="req"> *</span>' : ''}</span>${html}</label>`;
  const inp2 = (n, v, t = 'text', x = '') => `<input name="${n}" type="${t}" value="${esc(v ?? '')}" ${x}>`;
  const sel2 = (n, o, v) => `<select name="${n}">${o.map(x => Array.isArray(x) ? x : [x, x]).map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(v) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  const S2 = (title, body, sub) => `<section class="card"><div class="card-h"><div><h2>${title}</h2>${sub ? `<p class="note">${sub}</p>` : ''}</div></div>${body}</section>`;
  const title = kRO ? 'Contract ' + esc(k.id) + ' ' + pill(ctrState(k)) : k.replaces ? 'Revise contract ' + esc(k.replaces) + ` <span class="note">v${k.version}</span>` : k.id ? 'Edit contract ' + esc(k.id) + ' ' + pill(k.status) : 'New contract';
  const btns = kRO ? `<a class="btn" href="#contracts">← All contracts</a>`
    : `<a class="btn" href="#contracts">Cancel</a>${k.id && k.status === 'Draft' ? '<button class="btn danger" type="button" data-do="ctrDelete">Delete draft</button>' : ''}<button class="btn" type="button" data-do="ctrSave" data-id="draft">Save as draft</button>${k.status === 'Pending approval' ? '<button class="btn pri" type="button" data-do="ctrSave" data-id="approve">Approve</button>' : '<button class="btn pri" type="button" data-do="ctrSave" data-id="submit">Submit for approval</button>'}`;
  const ref = k.ref || (k.client ? ctrAgrNo(k.client, k.id) : '');
  return `${head2(`<a href="#contracts" style="color:inherit">Contracts</a> / ${k.id ? esc(k.id) : k.replaces ? esc(k.replaces) + ' / Revision' : 'New'}`, title, btns)}
  ${kRO ? `<p class="note" style="margin:0">This contract is ${esc(ctrState(k).toLowerCase())} and read-only.</p>` : ''}
  ${k.replaces && !kRO ? `<div class="warnbox">You are revising <b class="mono">${esc(k.replaces)}</b>. It stays active until this version (v${k.version}) is approved.</div>` : ''}
  <div class="err" id="ctrErr" role="alert"></div>
  <form id="ctrForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${S2('Contract', `<div class="fgrid auto card-b">${F('Customer', sel2('client', [['', 'Choose…'], ...custOpts()], k.client), 1)}${F('Agreement no.', `<input name="ref" id="ctrRef" value="${esc(ref)}" readonly class="mono ro-in" tabindex="-1" placeholder="Assigned from the customer name"><small class="hint">Auto: first 3 letters of the customer + running no.</small>`)}${F('Source quotation', `<input name="quote" value="${esc(k.quote)}" readonly class="mono ro-in" tabindex="-1">`)}${F('Start date', inp2('start', k.start, 'date'), 1)}${F('End date', inp2('end', k.end, 'date'), 1)}${F('Auto-renew', sel2('autoRenew', ['Yes', 'No'], k.autoRenew))}${F('Notice period, days', inp2('notice', k.notice, 'number', 'min="0"'))}</div>`, 'Who the agreement is with and how long it runs.')}
  ${S2('Billing terms', `<div class="fgrid auto card-b">${F('Billing cycle', sel2('cycle', CTR_CYCLES, k.cycle))}${F('Payment terms', sel2('terms', TERMS, k.terms))}${F('Credit limit, SAR', inp2('credit', k.credit, 'number', 'min="0" step="0.01"'))}${F('VAT treatment', sel2('vat', SD_VAT, k.vat))}</div>`, 'Applied to every invoice from the billing run.')}
  ${S2('Storage', `<div class="fgrid auto card-b">${F('Storage basis', sel2('storeBasis', CTR_STORE, k.storeBasis))}${F('Free storage days', inp2('freeDays', k.freeDays, 'number', 'min="0"'))}</div>`, 'How storage is measured and charged.')}
  ${S2('Services &amp; rates', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines" style="min-width:900px"><thead><tr><th class="num" style="width:40px">#</th><th>Service</th><th>Category</th><th>Unit</th><th class="num">Contract rate, SAR</th><th class="num">Standard, SAR</th><th class="num">Min. fee, SAR</th><th></th></tr></thead><tbody id="ctrLines">${k.lines.map(ctrLineRow).join('')}</tbody></table></div>${k.lines.length ? '' : '<p class="note" style="margin:8px 0 0">No services yet.</p>'}<div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-do="ctrAddLine">+ Add service</button><button type="button" class="btn sm" data-do="ctrAddAll">Add all active services at standard rates</button></div></div>`, 'Only services on the contract may be performed for this customer. The minimum fee is optional: it is charged when a job amount is lower.')}
  ${S2('Service levels', `<div class="fgrid auto card-b">${F('Same-day dispatch cut-off', inp2('cutoff', k.cutoff, 'time'))}${F('Order turnaround, hours', inp2('turnaround', k.turnaround, 'number', 'min="0"'))}${F('Receiving turnaround, hours', inp2('rcvTurn', k.rcvTurn, 'number', 'min="0"'))}${F('Stock accuracy target, %', inp2('accuracy', k.accuracy, 'number', 'min="0" max="100" step="0.1"'))}</div>`, 'What Gray Lane commits to.')}
  ${S2('Liability &amp; insurance', `<div class="card-b ctr-liab">
    <div class="ctr-sub"><h3>1. Limit of liability</h3><p class="note">Gray Lane's maximum liability for loss or damage to goods in its custody, unless caused by gross negligence or wilful misconduct.</p>
    <div class="fgrid auto">${F('Liability basis', sel2('liabBasis', CTR_LIAB_BASIS, k.liabBasis))}${F('Limit per unit of basis, SAR', inp2('liabPallet', k.liabPallet, 'number', 'min="0" step="0.01"'))}${F('Maximum per event, SAR', inp2('liabEvent', k.liabEvent, 'number', 'min="0" step="0.01"'))}${F('Maximum per contract year, SAR', inp2('liabYear', k.liabYear, 'number', 'min="0" step="0.01"'))}</div></div>
    <div class="ctr-sub"><h3>2. Claims procedure</h3><p class="note">Claims outside these periods are not accepted.</p>
    <div class="fgrid auto">${F('Notify visible damage or shortage within, days', inp2('claimNotify', k.claimNotify, 'number', 'min="0"'))}${F('Submit written claim with evidence within, days', inp2('claimSubmit', k.claimSubmit, 'number', 'min="0"'))}</div></div>
    <div class="ctr-sub"><h3>3. Exclusions</h3><p class="note">Gray Lane is not liable for loss or damage arising from the following. One per line.</p>
    ${F('Excluded risks', `<textarea name="exclusions" rows="6">${esc(k.exclusions)}</textarea>`)}</div>
    <div class="ctr-sub"><h3>4. Insurance</h3><p class="note">Who insures the goods while they are stored and handled.</p>
    <div class="fgrid auto">${F('Goods insured by', sel2('insurance', CTR_INS, k.insurance))}${F('Insurer', inp2('insurer', k.insurer, 'text', 'placeholder="Insurance company"'))}${F('Policy no.', inp2('policyNo', k.policyNo, 'text', 'placeholder="e.g. POL-2026-0042"'))}${F('Sum insured, SAR', inp2('sumInsured', k.sumInsured, 'number', 'min="0" step="0.01"'))}${F('Policy expiry', inp2('policyExpiry', k.policyExpiry, 'date'))}${F('Gray Lane named as co-insured', sel2('coInsured', ['Yes', 'No'], k.coInsured))}</div></div>
    <div class="ctr-sub"><h3>5. Lien and special terms</h3>
    <div class="fgrid auto">${F('Lien on stored goods for unpaid invoices', sel2('lien', ['Yes', 'No'], k.lien))}</div>${F('Notes / special terms', `<textarea name="notes" rows="3" placeholder="Any agreed exception to the standard terms">${esc(k.notes)}</textarea>`)}</div>
  </div>`, 'Agreed limits, claims rules and insurance. Used by the Damage &amp; loss register.')}
  </form>${kRO ? '' : `<div class="form-foot">${btns}</div>`}<datalist id="dl_sdunit">${SD_UNITS.map(u => `<option value="${esc(u)}">`).join('')}</datalist>`;
}
function renderContract() {
  $('#view').innerHTML = contractForm(kDoc);
  if (kRO) document.querySelectorAll('#ctrForm :is(input,select,textarea,button)').forEach(el => el.disabled = true);
}
function readContract() {
  const fm = $('#ctrForm'); if (!fm || kRO) return kDoc;
  const k = kDoc; fm.querySelectorAll('[name]').forEach(x => k[x.name] = x.value.trim());
  ['notice', 'terms', 'credit', 'freeDays', 'turnaround', 'rcvTurn', 'accuracy', 'liabPallet', 'liabEvent', 'liabYear', 'claimNotify', 'claimSubmit', 'sumInsured'].forEach(n => k[n] = +k[n] || 0);
  k.liability = ctrLiabText(k);
  k.lines = [...fm.querySelectorAll('#ctrLines .ctr-ln')].map(r => { const o = {}; r.querySelectorAll('[data-l]').forEach(x => o[x.dataset.l] = x.value.trim()); const s = svcBy(o.code);
    return { code: o.code, name: s.name || '', cat: s.cat || '', unit: o.unit || s.unit || '', rate: o.rate === '' ? '' : +o.rate, minFee: +o.minFee || 0 }; });
  return k;
}
function ctrValidate(k) {
  if (!k.client) throw new Error('Choose the customer.');
  if (!k.start || !k.end) throw new Error('Enter the start and end dates.');
  if (k.end < k.start) throw new Error('The end date is before the start date.');
  const ls = k.lines.filter(l => l.code); if (!ls.length) throw new Error('Add at least one service with its rate.');
  const seen = new Set(); ls.forEach(l => { if (seen.has(l.code)) throw new Error(l.code + ' is on the contract twice.'); seen.add(l.code); if (l.rate === '' || !(l.rate >= 0)) throw new Error('Enter the contract rate for ' + l.code + '.'); });
  const clash = DB.contracts.find(x => x.id !== k.id && x.client === k.client && x.id !== k.replaces && ['Active', 'Pending approval'].includes(ctrState(x)) && !(x.end < k.start || x.start > k.end));
  if (clash && clash.status === 'Pending approval') throw new Error(clash.id + ' for this customer is already waiting for approval.');
  if (clash && !k.replaces) throw new Error(clash.id + ' is already active for ' + clName(k.client) + ' in this period. Open it and revise it instead.');
  if (k.accuracy > 100) throw new Error('The stock accuracy target cannot be above 100%.');
  k.lines = ls;
}

/* =====================================================================
   COMMERCIAL ACTIONS
   ===================================================================== */
const DO = {
  clearFilt(key) { FILT[key] = {}; route(); },
  csort(k) { custSort = { k, dir: custSort.k === k ? -custSort.dir : 1 }; route(); },
  delCust(id) {
    const c = client(id), used = [[DB.quotes, 'quotation'], [DB.contracts, 'contract'], [DB.asns, 'ASN'], [DB.orders, 'outbound order']].map(([l, n]) => [l.filter(x => x.client === id).length, n]).filter(x => x[0]);
    if (DB.items.some(i => i.client === id)) used.push([DB.items.filter(i => i.client === id).length, 'item']);
    if (used.length) return toast(`${c.name} has ${used.map(([n, w]) => n + ' ' + w + (n === 1 ? '' : 's')).join(', ')}. Set the customer to Inactive instead of deleting.`);
    if (!confirm('Delete ' + c.name + '? This cannot be undone.')) return;
    DB.customers = DB.customers.filter(x => x.id !== id); persist(); toast(c.name + ' deleted.'); go('#customers');
  },
  ctab(k) { showTab(k); },
  addContact() { $('#contactRows').insertAdjacentHTML('beforeend', contactRow({})); $('#contactRows tr:last-child [data-c="name"]').focus(); },
  delContact(_, b) { const tr = b.closest('tr'); if ($('#contactRows').children.length > 1) tr.remove(); else tr.querySelectorAll('input:not([type=radio])').forEach(i => i.value = ''); },
  delDoc(i) { custDocs.splice(+i, 1); $('#docList').innerHTML = docList(); },
  saveCust(mode) {
    const fm = $('#custForm'), editId = fm.dataset.edit, d = readCustForm();
    try { validateCustomer(d, editId); } catch (e) { if (e.tab) showTab(e.tab); return formErr('#cuErr', e); }
    if (editId) DB.customers[DB.customers.findIndex(c => c.id === editId)] = d; else DB.customers.push(d);
    persist(); toast(d.name + (editId ? ' saved.' : ' added as ' + d.id + '.'));
    go(mode === 'new' ? '#customers/new' : '#customers');
  },
  qtAddLine() { readQuote(); qDoc.lines.push(qtBlankLine()); renderQuote(`[data-i="${qDoc.lines.length - 1}"] [data-l="svc"]`); },
  qtAddCat() { readQuote(); const have = new Set(qDoc.lines.map(l => l.svc));
    qDoc.lines = qDoc.lines.filter(l => l.svc || l.item);
    M.services.filter(s => (!qDoc.qtCat || s.cat === qDoc.qtCat) && !have.has(s.code)).forEach(s => { const cr = ctrRate(qDoc.client, s.code); qDoc.lines.push({ ...qtBlankLine(), svc: s.code, item: s.name, unit: s.unit, rate: cr ? cr.rate : s.rate }); });
    if (!qDoc.lines.length) qDoc.lines.push(qtBlankLine()); renderQuote(); },
  qtDelLine(i) { readQuote(); qDoc.lines.splice(+i, 1); if (!qDoc.lines.length) qDoc.lines.push(qtBlankLine()); renderQuote(); },
  qtSave(mode) {
    const d = readQuote();
    try { qtValidate(d, mode === 'final'); } catch (e) { return formErr('#sdErr', e); }
    if (mode === 'final') d.status = 'Sent';
    const isNew = !d.id;
    if (isNew) { d.id = qtNo(d.loc); DB.seq.QT[d.loc] = (DB.seq.QT[d.loc] || 1) + 1; DB.quotes.push(JSON.parse(JSON.stringify(d))); }
    else DB.quotes[DB.quotes.findIndex(x => x.id === d.id)] = JSON.parse(JSON.stringify(d));
    persist(); toast(d.id + (mode === 'final' ? ' saved and marked as sent.' : ' saved.')); go('#quotes');
  },
  qtMark(st) { const d = readQuote(); d.status = st; DB.quotes[DB.quotes.findIndex(x => x.id === d.id)] = JSON.parse(JSON.stringify(d)); persist(); toast(d.id + ' marked as ' + st.toLowerCase() + '.'); renderQuote(); },
  qtDelete() { DB.quotes = DB.quotes.filter(x => x.id !== qDoc.id); persist(); toast(qDoc.id + ' deleted.'); go('#quotes'); },
  ctrAddLine() { readContract(); kDoc.lines.push({ code: '', unit: '', rate: '', minFee: 0 }); renderContract(); const s = $(`[data-i="${kDoc.lines.length - 1}"] [data-l="code"]`); if (s) s.focus(); },
  ctrAddAll() { readContract(); const have = new Set(kDoc.lines.map(l => l.code)); kDoc.lines = kDoc.lines.filter(l => l.code);
    M.services.filter(s => !have.has(s.code)).forEach(s => kDoc.lines.push({ code: s.code, name: s.name, cat: s.cat, unit: s.unit, rate: s.rate, minFee: 0 })); renderContract(); },
  ctrDelLine(i) { readContract(); kDoc.lines.splice(+i, 1); renderContract(); },
  ctrDelete() { DB.contracts = DB.contracts.filter(x => x.id !== kDoc.id); persist(); toast(kDoc.id + ' deleted.'); go('#contracts'); },
  ctrSave(mode) {
    const k = readContract();
    try { if (mode !== 'draft') ctrValidate(k); else if (!k.client) throw new Error('Choose the customer.'); } catch (e) { return formErr('#ctrErr', e); }
    if (mode === 'draft') k.lines = k.lines.filter(l => l.code);
    if (!k.ref || !k.ref.startsWith(ctrAgrNo(k.client, k.id).slice(0, 8)) || DB.contracts.some(x => x.id !== k.id && x.id !== k.replaces && x.ref === k.ref)) k.ref = ctrAgrNo(k.client, k.id);
    const isNew = !k.id;
    if (isNew) { k.id = 'CTR-' + String(DB.seq.CTR).padStart(5, '0'); DB.seq.CTR++; }
    k.history = [...(k.history || []), { at: iso(today), by: DATA.user.name, what: { draft: 'Saved as draft', submit: 'Submitted for approval', approve: 'Approved and activated' }[mode] }];
    if (mode === 'submit') k.status = 'Pending approval';
    if (mode === 'approve') {
      k.status = 'Active'; k.approvedBy = DATA.user.name; k.approvedAt = iso(today);
      DB.contracts.forEach(x => { if (x.id !== k.id && x.client === k.client && ctrState(x) === 'Active' && (x.id === k.replaces || !(x.end < k.start || x.start > k.end))) x.status = 'Superseded'; });
    }
    const rec = JSON.parse(JSON.stringify(k));
    if (isNew) DB.contracts.push(rec); else DB.contracts[DB.contracts.findIndex(x => x.id === k.id)] = rec;
    persist();
    toast(k.id + ({ draft: ' saved as draft.', submit: ' submitted for approval.', approve: ' approved. ' + clName(k.client) + ' is now billed at these rates.' })[mode]);
    go('#contracts');
  }
};

/* commercial page events */
document.addEventListener('click', e => {
  const nm = e.target.closest('[data-navmod]');
  if (nm) { const id = nm.dataset.navmod; openMods.has(id) ? openMods.delete(id) : openMods.add(id); renderNav(); return; }
  const b = e.target.closest('[data-do]');
  if (b && DO[b.dataset.do]) { e.preventDefault(); return DO[b.dataset.do](b.dataset.id, b); }
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href;
});
document.addEventListener('keydown', e => { const tr = e.target.closest && e.target.closest('tr[data-href]'); if (tr && e.key === 'Enter' && e.target === tr) location.hash = tr.dataset.href; });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.filt && t.type === 'search') {
    const [key, id] = t.dataset.filt.split('|'); (FILT[key] = FILT[key] || {})[id] = t.value; route();
    const s = document.querySelector(`[data-filt="${t.dataset.filt}"]`); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    return;
  }
  if (t.closest('#custForm')) updateCustForm(t);
  if (t.closest('#sdForm') && !['svc', 'item'].includes(t.dataset.l)) qtRecalc();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filt && t.tagName === 'SELECT') { const [key, id] = t.dataset.filt.split('|'); (FILT[key] = FILT[key] || {})[id] = t.value; route(); return; }
  if (t.closest('#custForm')) {
    if (t.id === 'cu_file') { const kind = $('#cu_dockind').value; [...t.files].forEach(f => custDocs.push({ name: f.name, kind, size: f.size, at: iso(today) })); t.value = ''; $('#docList').innerHTML = docList(); return; }
    updateCustForm(t); return;
  }
  if (t.closest('#sdForm')) {
    if (t.name === 'client') { readQuote(); const c = client(t.value), pc = primaryContact(c); Object.assign(qDoc, { toName: pc.name || '', toMob: pc.mobile || pc.phone || '', toEmail: pc.email || '' }); return renderQuote('[name="client"]'); }
    if (t.name === 'loc' || t.name === 'qtCat') { readQuote(); return renderQuote(`[name="${t.name}"]`); }
    if (t.dataset.l === 'svc') { const s = M.services.find(x => x.code === t.value.trim().toUpperCase()); if (s) qtFill(t.closest('.sd-ln'), s); else if (t.value) toast(t.value + ' is not in Service Items.'); return qtRecalc(); }
    if (t.dataset.l === 'item') { const s = M.services.find(x => x.name.toLowerCase() === t.value.trim().toLowerCase()); if (s) qtFill(t.closest('.sd-ln'), s); return qtRecalc(); }
    if (t.name === 'toName') { const c = (client(qDoc.client).contacts || []).find(x => x.name === t.value); if (c) { $('#sdForm [name=toMob]').value = c.mobile || c.phone || ''; $('#sdForm [name=toEmail]').value = c.email || ''; } }
    if (t.name === 'fromName') { const u = userBy(t.value); if (u.name) { $('#sdForm [name=fromEmail]').value = u.email || ''; $('#sdForm [name=fromMob]').value = u.mobile || ''; } }
    return qtRecalc();
  }
  if (t.closest('#ctrForm')) {
    if (t.name === 'client') { readContract(); kDoc.ref = t.value ? ctrAgrNo(t.value, kDoc.id) : ''; const c = client(t.value); if (!kDoc.id) { kDoc.terms = +c.terms || 30; kDoc.credit = +c.credit || 0; } return renderContract(); }
    if (t.dataset.l === 'code') { const r = t.closest('.ctr-ln'), s = svcBy(t.value); r.querySelector('[data-cat]').textContent = s.cat || ''; r.querySelector('[data-std]').textContent = s.code ? sar(s.rate) : '';
      const u = r.querySelector('[data-l=unit]'), rate = r.querySelector('[data-l=rate]'); if (s.code) { u.value = s.unit; if (rate.value === '') rate.value = s.rate; } }
  }
});

/* =====================================================================
   MODAL  (used by Item Groups, Categories, Units of Measure, Receive stock)
   ===================================================================== */
let mfCtx = null;
function modal(title, body, foot, cls = '') {
  let root = $('#modalRoot'); if (!root) { root = document.createElement('div'); root.id = 'modalRoot'; document.body.appendChild(root); }
  root.innerHTML = `<div class="mback" data-do="mClose"></div><div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <header><h2 id="mTitle">${title}</h2><button type="button" class="icon-btn" data-do="mClose" aria-label="Close">×</button></header><div class="mb">${body}</div><footer>${foot}</footer></div>`;
  root.hidden = false; document.body.style.overflow = 'hidden';
  const f = root.querySelector('.mb input:not([readonly]),.mb select,.mb textarea'); if (f) f.focus();
}
function closeModal(keepUrl) {
  const root = $('#modalRoot'); if (!root || root.hidden) return;
  root.hidden = true; root.innerHTML = ''; document.body.style.overflow = ''; mfCtx = null;
  if (!keepUrl && /\/new$/.test(location.hash)) history.replaceState(null, '', location.hash.replace(/\/new$/, ''));
}
const MF_IC = { grp: '<path d="M3 7.5A2.5 2.5 0 015.5 5H9l2 2h7.5A2.5 2.5 0 0121 9.5v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 16.5z"/>', cat: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>', uom: '<path d="M3 17l4-4 3 3 7-7M14 9h3v3"/><rect x="3" y="3" width="18" height="18" rx="2"/>', mat: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>' };
const mfSvg = (k, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MF_IC[k]}</svg>`;
const statusSeg = v => ({ id: 'status', label: 'Status', type: 'seg', options: [['Active', 'Active'], ['Inactive', 'Inactive']], value: v || 'Active' });
function mfOpen(o) {
  mfCtx = o;
  const F = f => { const id = 'mf_' + f.id, v = f.value ?? '', req = f.req ? '<span class="req"> *</span>' : ''; let inp;
    if (f.type === 'select') inp = `<select id="${id}" name="${f.id}">${f.blank ? `<option value="">${esc(f.blank)}</option>` : ''}${opt(f.options, v)}</select>`;
    else if (f.type === 'seg') inp = `<div class="seg" role="radiogroup">${f.options.map(([a, b]) => `<label><input type="radio" name="${f.id}" value="${esc(a)}" ${String(v) === String(a) ? 'checked' : ''}>${esc(b)}</label>`).join('')}</div>`;
    else if (f.type === 'textarea') inp = `<textarea id="${id}" name="${f.id}" rows="3" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    else inp = `<input type="${f.itype || 'text'}" id="${id}" name="${f.id}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" ${f.dir ? `dir="${f.dir}"` : ''} ${f.mono ? 'class="mono"' : ''} ${f.id === 'code' && !v ? 'data-auto="1"' : ''} autocomplete="off">`;
    return `<label class="field mf-f ${f.span ? 'mf-s' + f.span : ''}" ${f.type === 'seg' ? '' : `for="${id}"`}><span class="flbl">${esc(f.label)}${req}</span>${inp}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`; };
  modal(o.title, `<div class="mf-hd"><span class="mf-ic">${mfSvg(o.ic, 22)}</span><div><b>${esc(o.head)}</b><span>${esc(o.sub)}</span></div>${o.badge ? `<em class="mf-badge">${o.badge}</em>` : ''}</div>
    <form id="mfForm" class="mf" onsubmit="return false">${o.secs.map(s => `<section class="mf-sec"><h4>${esc(s[0])}</h4><div class="mf-g">${s[1].map(F).join('')}</div></section>`).join('')}
    ${o.preview ? '<div class="mf-prev" id="mfPrev"></div>' : ''}<div id="mfErr" class="err" role="alert"></div></form>`,
    `${o.del ? `<button type="button" class="btn danger" data-do="${o.del[0]}" data-id="${esc(o.del[1])}" style="margin-right:auto" ${o.del[2] ? `disabled title="${esc(o.del[2])}"` : ''}>Delete</button>` : ''}<button type="button" class="btn" data-do="mClose">Cancel</button>${o.edit ? '' : '<button type="button" class="btn" data-do="mfSave" data-id="new">Save &amp; New</button>'}<button type="button" class="btn pri" data-do="mfSave" data-id="close">${o.edit ? 'Save Changes' : 'Save'}</button>`, 'mf-modal');
  mfPrev();
}
function mfRead() { const v = {}; $('#mfForm').querySelectorAll('[name]').forEach(x => { if (x.type === 'radio') { if (x.checked) v[x.name] = x.value; } else v[x.name] = x.value.trim(); }); return v; }
function mfPrev() { const p = $('#mfPrev'); if (p && mfCtx && mfCtx.preview) p.innerHTML = mfCtx.preview(mfRead()); }
const mfAutoCode = pfx => el => { if (el.name !== 'name') return; const c = $('#mf_code'); if (c && (!c.value || c.dataset.auto === '1')) { c.value = el.value ? codeFrom(el.value, pfx) : ''; c.dataset.auto = '1'; } };
const lockBtn = blk => `<button type="button" class="icon-btn" disabled title="${esc(blk)}" aria-label="Cannot delete: ${esc(blk)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg></button>`;
const rowIcons = (editDo, delDo, id, blk) => `<div class="rowicons"><button type="button" class="icon-btn" data-do="${editDo}" data-id="${esc(id)}" title="Edit" aria-label="Edit ${esc(id)}">${ICO.edit}</button>${blk ? lockBtn(blk) : `<button type="button" class="icon-btn danger" data-do="${delDo}" data-id="${esc(id)}" title="Delete" aria-label="Delete ${esc(id)}">${ICO.del}</button>`}</div>`;
const mchip = (ic, html) => `<span class="mf-chip">${ic ? mfSvg(ic, 14) + ' ' : ''}${html}</span>`;
const stPill = v => `<span class="pill ${v === 'Inactive' ? 'p-mute' : 'p-good'}">${esc(v || 'Active')}</span>`;
