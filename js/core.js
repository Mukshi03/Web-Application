'use strict';
/* =====================================================================
   DATA
   Replace this object with data from your API, e.g.
     const DATA = await fetch('/api/dashboard').then(r => r.json());
   The render code below only reads from DATA.
   ===================================================================== */
const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const y0Seed = String(new Date().getFullYear());
const DATA = {
  company: 'Gray Lane Logistics',
  user: { name: 'Hamza Kadenja', role: 'Administrator' },
  customers: 4,
  skus: 15,
  pallets: 47,
  units: 2860,
  shippedToday: 3,
  dueSoon: 6,
  onTime: { ok: 38, total: 41 },
  revenueMonth: 48250.75,   // SAR, ex VAT
  unbilled: 12640.50,       // SAR
  overdue: 8930.00,         // SAR
  chargesMonth: 214,
  invoicesIssued: 9,
  // units received and shipped, last 7 days (oldest first)
  flow: [
    { in: 320, out: 110 }, { in: 0, out: 145 }, { in: 160, out: 98 },
    { in: 240, out: 180 }, { in: 0, out: 120 }, { in: 400, out: 160 }, { in: 80, out: 74 }
  ].map((v, i) => ({ date: iso(addDays(today, i - 6)), ...v })),
  warehouses: [
    { name: 'Jeddah Ambient', capacity: 24, pallets: 22 },
    { name: 'Jeddah Chilled', capacity: 8, pallets: 6 },
    { name: 'Jeddah Frozen', capacity: 6, pallets: 3 },
    { name: 'Riyadh Ambient', capacity: 10, pallets: 5 }
  ],
  queue: [
    { task: 'ASNs expected', module: 'Inbound', open: 0, href: '#receiving' },
    { task: 'Putaway tasks open', module: 'Inbound', open: 0, href: '#putaway' },
    { task: 'Orders to allocate', module: 'Outbound', open: 0, href: '#alloc' },
    { task: 'Pick lists in progress', module: 'Outbound', open: 0, href: '#pick' },
    { task: 'Ready to dispatch', module: 'Outbound', open: 0, href: '#dispatch' },
    { task: 'Counts open', module: 'Inventory', open: 1, href: '#counts' },
    { task: 'Bin moves open', module: 'Inventory', open: 2, href: '#moves' },
    { task: 'Adjustments to approve', module: 'Inventory', open: 1, href: '#adjust' },
    { task: 'Returns to inspect', module: 'Returns', open: 1, href: '#rmarecv' },
    { task: 'VAS work orders open', module: 'VAS', open: 2, href: '#vas' }
  ],
  alerts: [
    { level: 'High', title: 'Temperature out of range · Frozen room F1', detail: '-15.8°C now, allowed -25 to -18°C' },
    { level: 'Medium', title: '4 pallets expire within 30 days', detail: 'Batch & expiry report lists them by customer' },
    { level: 'Medium', title: 'Jeddah Ambient is 92% full', detail: 'Plan overflow space or slow inbound' },
    { level: 'Medium', title: '1 invoice overdue', detail: 'INV-JED-00003 · Hijaz Pharma' },
    { level: 'Info', title: '1 inventory adjustment waiting for approval', detail: 'ADJ-JED-00001' }
  ],
  revenueMix: { Storage: 21400, Handling: 17850, VAS: 3200, Transport: 5800 },
  orders: [
    { id: 'OB-JED-00061', customer: 'Najd Electronics', shipTo: 'eXtra Jeddah', warehouse: 'Jeddah Ambient', lines: 1, units: 30, due: iso(addDays(today, 2)), status: 'New' },
    { id: 'OB-JED-00060', customer: 'Red Sea Foods', shipTo: 'Tamimi Markets Olaya', warehouse: 'Jeddah Frozen', lines: 1, units: 12, due: iso(addDays(today, 1)), status: 'New' },
    { id: 'OB-JED-00059', customer: 'Red Sea Foods', shipTo: 'Panda Hypermarket #112', warehouse: 'Jeddah Ambient', lines: 1, units: 20, due: iso(addDays(today, -1)), status: 'Allocated' },
    { id: 'OB-RUH-00004', customer: 'Najd Electronics', shipTo: 'eXtra Riyadh Olaya', warehouse: 'Riyadh Ambient', lines: 1, units: 10, due: iso(addDays(today, 1)), status: 'Allocated' },
    { id: 'OB-JED-00057', customer: 'Souq Style', shipTo: 'Online customer', warehouse: 'Jeddah Ambient', lines: 2, units: 21, due: iso(addDays(today, 1)), status: 'Picking' },
    { id: 'OB-JED-00056', customer: 'Hijaz Pharma', shipTo: 'Nahdi Pharmacy DC', warehouse: 'Jeddah Ambient', lines: 1, units: 40, due: iso(addDays(today, 1)), status: 'Picked' }
  ],

  // Master data used by the New ASN and Outbound Order forms
  master: {
    // customers, quotations and contracts are editable records: see SEED below
    locations: [{ id: 'JED', name: 'Jeddah' }, { id: 'RUH', name: 'Riyadh' }],
    users: [
      { name: 'Hamza Kadenja', email: 'hamza@graylane.com.sa', mobile: '+966 55 100 2001' },
      { name: 'Noura Al-Otaibi', email: 'noura@graylane.com.sa', mobile: '+966 55 100 2002', sales: true },
      { name: 'Khalid Mansour', email: 'khalid@graylane.com.sa', mobile: '+966 55 100 2003', sales: true }
    ],
    // Billing Engine → Service Items
    services: [
      ['STR-001', 'Storage — ambient', 'Storage', 'Pallet / day', 4], ['STR-002', 'Storage — chilled / frozen', 'Storage', 'Pallet / day', 7],
      ['HDL-001', 'Inbound handling', 'Handling', 'Pallet', 12], ['HDL-002', 'Outbound handling', 'Handling', 'Pallet', 3.5],
      ['HDL-003', 'Order processing', 'Handling', 'Order', 8], ['HDL-004', 'Returns handling', 'Handling', 'Unit', 1.5], ['VAS-001', 'Labelling / relabelling', 'VAS', 'Carton', 1.2],
      ['VAS-002', 'Repacking', 'VAS', 'Carton', 2], ['VAS-003', 'Palletizing', 'VAS', 'Pallet', 15],
      ['VAS-004', 'Shrink wrapping', 'VAS', 'Pallet', 10], ['VAS-005', 'Kitting / bundling', 'VAS', 'Unit', 2.5],
      ['VAS-006', 'Sorting / segregation', 'VAS', 'Carton', 1], ['TRN-001', 'Transport — Jeddah delivery', 'Transport', 'Trip', 90]
    ].map(([code, name, cat, unit, rate]) => ({ code, name, cat, unit, rate })),
    warehouses: [
      { id: 'WH-JED-01', name: 'Jeddah Ambient', loc: 'JED' }, { id: 'WH-JED-02', name: 'Jeddah Chilled', loc: 'JED' },
      { id: 'WH-JED-03', name: 'Jeddah Frozen', loc: 'JED' }, { id: 'WH-RUH-01', name: 'Riyadh Ambient', loc: 'RUH' }
    ],
    // starting customer items (SKUs); the live list is DB.items, editable in Items / SKU Master
    itemSeed: [
      ['RSF-RICE-5K', 'CL-001', 'Basmati rice 5 kg', 'أرز بسمتي ٥ كغ', 'Carton', 'Ambient', 'Food - dry', 'Groceries', '628100000001', 540],
      ['RSF-OIL-1L', 'CL-001', 'Sunflower oil 1 L × 12', 'زيت دوار الشمس', 'Carton', 'Ambient', 'Food - dry', 'Groceries', '628100000002', 365],
      ['RSF-LAB-500', 'CL-001', 'Labneh 500 g × 6', 'لبنة', 'Carton', 'Chilled', 'Food - chilled', 'Dairy', '628100000003', 45],
      ['RSF-SHR-1K', 'CL-001', 'Frozen shrimp 1 kg × 10', 'روبيان مجمد', 'Carton', 'Frozen', 'Food - frozen', 'Seafood', '628100000004', 270],
      ['NJE-TV-55', 'CL-002', '55" LED TV', 'تلفزيون ٥٥ بوصة', 'Unit', 'Ambient', 'Electronics', 'Appliances', '628200000001', 0],
      ['NJE-AC-18', 'CL-002', 'Split AC 18,000 BTU', 'مكيف سبليت', 'Unit', 'Ambient', 'Electronics', 'Appliances', '628200000002', 0],
      ['NJE-PHN-A5', 'CL-002', 'Smartphone A5 (carton of 20)', 'هاتف ذكي A5', 'Carton', 'Ambient', 'Electronics', 'Mobile phones', '628200000003', 0],
      ['HJP-INS-10', 'CL-003', 'Insulin pens × 10', 'أقلام إنسولين', 'Box', 'Chilled', 'Pharmaceutical', 'Medicines', '628300000001', 120],
      ['HJP-PAR-24', 'CL-003', 'Paracetamol 500 mg × 24', 'باراسيتامول', 'Carton', 'Ambient', 'Pharmaceutical', 'Medicines', '628300000002', 730],
      ['SQS-ABY-M', 'CL-004', 'Abaya, black, size M', 'عباءة سوداء', 'Piece', 'Ambient', 'Apparel', 'Clothing', '628400000001', 0],
      ['SQS-THB-L', 'CL-004', 'Thobe, white, size L', 'ثوب أبيض', 'Piece', 'Ambient', 'Apparel', 'Clothing', '628400000002', 0],
      ['SQS-SHL-01', 'CL-004', 'Shemagh, red check', 'شماغ أحمر', 'Piece', 'Ambient', 'Apparel', 'Accessories', '628400000003', 0]
    ].map(([sku, client, name, name2, uom, temp, group, category, barcode, shelf], i) => ({ sku, client, name, name2, uom, temp, group, category, barcode, code: 'GL-' + (101 + i), custCode: sku, kind: 'Goods',
      variant: 'single', track: true, batch: shelf > 0, expiry: shelf > 0, serial: /NJE-(TV|AC)/.test(sku), shelf, minStock: 0, status: 'Active', created: y0Seed + '-01-01' })),
    // units free to allocate, by warehouse and SKU
    stock: {
      'WH-JED-01': { 'RSF-RICE-5K': 240, 'RSF-OIL-1L': 180, 'NJE-TV-55': 36, 'NJE-AC-18': 20, 'NJE-PHN-A5': 40, 'HJP-PAR-24': 150, 'SQS-ABY-M': 60, 'SQS-THB-L': 45, 'SQS-SHL-01': 80 },
      'WH-JED-02': { 'RSF-LAB-500': 90, 'HJP-INS-10': 200 },
      'WH-JED-03': { 'RSF-SHR-1K': 70 },
      'WH-RUH-01': { 'NJE-TV-55': 12, 'NJE-PHN-A5': 30, 'SQS-ABY-M': 25 }
    },
    orderTypes: ['Customer dispatch', 'Transfer order', 'Return to vendor'],
    priorities: ['Normal', 'High', 'Urgent']
  },
  // next document numbers
  numbering: { nextAsn: 104, nextOb: { JED: 62, RUH: 5 } }
};

/* =====================================================================
   HELPERS
   ===================================================================== */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => Number(v || 0).toLocaleString('en-US');
const sar = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
let DATE_FMT = 'DD MMM YYYY', SET_EXP_DAYS = 30, SET_FREEZE = true;
const fmtDate = d => { if (!d) return '—'; const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); if (isNaN(x)) return String(d); const p = n => String(n).padStart(2, '0');
  return DATE_FMT === 'DD/MM/YYYY' ? `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}` : DATE_FMT === 'YYYY-MM-DD' ? `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}` : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const TONE = { High: 'bad', Medium: 'warn', Info: 'info', Draft: 'mute', Submitted: 'info', Available: 'good', 'Enter qty': 'warn', New: 'mute', Allocated: 'info', Picking: 'warn', Picked: 'warn', Dispatched: 'info', Delivered: 'good', Cancelled: 'mute' };
const pill = s => `<span class="pill p-${TONE[s] || (/^Short/.test(s) ? 'bad' : 'mute')}">${esc(s)}</span>`;
const card = (title, body, extra = '') => `<section class="card"><div class="card-h"><h2>${title}</h2><div class="row">${extra}</div></div>${body}</section>`;
const isLate = o => ['New', 'Allocated', 'Picking', 'Picked'].includes(o.status) && o.due < iso(today);

/* =====================================================================
   SECTIONS
   ===================================================================== */
function kpis(d) {
  const cap = sum(d.warehouses, w => w.capacity), used = sum(d.warehouses, w => w.pallets), pct = cap ? Math.round(used / cap * 100) : 0;
  const k = (label, value, sub, extra = '') => `<div class="card kpi"><span>${label}</span><b>${value}</b>${extra}<small>${sub}</small></div>`;
  return `<section class="grid g-kpi" aria-label="Key figures">
    ${k('Active customers', n0(d.customers), `${n0(d.skus)} SKUs under management`)}
    ${k('Pallets in stock', n0(d.pallets), `${n0(d.units)} units`)}
    ${k('Space utilisation', pct + '%', `${used} of ${cap} pallet positions`, `<div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>`)}
    ${k('Shipped today', n0(d.shippedToday), `${n0(d.dueSoon)} orders due today or tomorrow`)}
    ${k('On-time dispatch', d.onTime.total ? Math.round(d.onTime.ok / d.onTime.total * 100) + '%' : '—', `${d.onTime.ok} of ${d.onTime.total} orders by due date`)}
    ${k('Revenue this month', sar(d.revenueMonth), `SAR, ex VAT · ${sar(d.unbilled)} unbilled`)}
  </section>`;
}

function flowChart(d) {
  const ins = d.flow.map(x => x.in), outs = d.flow.map(x => x.out);
  const max = Math.max(10, ...ins, ...outs), step = Math.ceil(max / 4 / 10) * 10 || 10, top = step * 4;
  const X = i => 58 + i * 72, Y = v => 170 - v / top * 150;
  const svg = `<svg class="chart" viewBox="0 0 560 200" role="img" aria-label="Units received and shipped per day, last 7 days">
    ${[0, 1, 2, 3, 4].map(k => `<line x1="44" x2="550" y1="${Y(k * step)}" y2="${Y(k * step)}" stroke="var(--line${k ? '-2' : ''})"/><text x="38" y="${Y(k * step) + 4}" text-anchor="end">${n0(k * step)}</text>`).join('')}
    ${d.flow.map((x, i) => `<rect x="${X(i)}" y="${Y(x.in)}" width="24" height="${170 - Y(x.in)}" rx="2" fill="var(--accent)"><title>Received ${n0(x.in)}</title></rect>
      <rect x="${X(i) + 26}" y="${Y(x.out)}" width="24" height="${170 - Y(x.out)}" rx="2" fill="var(--accent-2)"><title>Shipped ${n0(x.out)}</title></rect>
      <text x="${X(i) + 25}" y="190" text-anchor="middle">${new Date(x.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</text>`).join('')}
  </svg>`;
  return card('Units received vs shipped · last 7 days', `<div class="card-b">${svg}</div>`,
    `<span class="note legend"><i style="background:var(--accent);margin-left:0"></i>Received <i style="background:var(--accent-2)"></i>Shipped</span>`);
}

function workQueue(d) {
  return card("Today's work queue", `<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Module</th><th class="num">Open</th><th></th></tr></thead><tbody>
    ${d.queue.map(q => `<tr><td>${esc(q.task)}</td><td class="note">${esc(q.module)}</td><td class="num"><b>${n0(q.open)}</b></td><td class="num"><a class="btn sm" href="${esc(q.href)}">Open</a></td></tr>`).join('')}
  </tbody></table></div>`);
}

function alerts(d) {
  const body = d.alerts.length
    ? d.alerts.map(a => `<div class="alert">${pill(a.level)}<div><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></div></div>`).join('')
    : '<div class="empty">No alerts. Everything is within limits.</div>';
  return card('Alerts', body, `<span class="pill p-${d.alerts.some(a => a.level === 'High') ? 'bad' : 'mute'}">${d.alerts.length} open</span>`);
}

function occupancy(d) {
  const rows = d.warehouses.map(w => {
    const pc = w.capacity ? Math.round(w.pallets / w.capacity * 100) : 0;
    const col = pc > 90 ? 'var(--bad)' : pc > 80 ? 'var(--accent-2)' : 'var(--accent)';
    return `<div><div class="row" style="justify-content:space-between"><span>${esc(w.name)}</span><b class="num">${pc}%</b></div>
      <div class="bar"><i style="width:${Math.min(100, pc)}%;background:${col}"></i></div><span class="note">${w.pallets} of ${w.capacity} pallets</span></div>`;
  }).join('');
  return card('Warehouse occupancy', `<div class="card-b" style="display:flex;flex-direction:column;gap:12px">${rows}<span class="note">Red above 90%, amber above 80%.</span></div>`,
    `<a class="btn sm" href="#warehouses">Space</a>`);
}

function billing(d) {
  const col = { Storage: 'var(--accent)', Handling: 'var(--info)', VAS: 'var(--vas)', Transport: 'var(--warn)' };
  const ent = Object.entries(d.revenueMix).filter(([, v]) => v), tot = sum(ent, e => e[1]) || 1;
  const mix = `<div><div style="display:flex;height:10px;border-radius:5px;overflow:hidden">${ent.map(([k, v]) => `<i style="width:${v / tot * 100}%;background:${col[k]}" title="${k}"></i>`).join('')}</div>
    <div class="row note" style="margin-top:8px;gap:14px">${ent.map(([k, v]) => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col[k]};margin-right:5px"></i>${k} ${Math.round(v / tot * 100)}%</span>`).join('')}</div></div>`;
  return card('Billing', `<div class="card-b" style="display:flex;flex-direction:column;gap:12px">
    <div class="dl"><div><span>Charges this month</span><b>${n0(d.chargesMonth)}</b></div><div><span>Invoices issued</span><b>${n0(d.invoicesIssued)}</b></div>
      <div><span>Unbilled, SAR</span><b>${sar(d.unbilled)}</b></div><div><span>Overdue, SAR</span><b style="color:${d.overdue ? 'var(--bad)' : 'inherit'}">${sar(d.overdue)}</b></div></div>
    ${mix}<a class="btn sm pri" href="#billrun/new" style="align-self:flex-start">Run billing</a></div>`);
}

function recentOrders(d) {
  const body = d.orders.length ? `<div class="tbl-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Ship to</th><th>Warehouse</th><th class="num">Lines</th><th class="num">Units</th><th>Due</th><th>Status</th></tr></thead><tbody>
    ${d.orders.map(o => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(o.customer)}</td><td>${esc(o.shipTo)}</td><td>${esc(o.warehouse)}</td><td class="num">${n0(o.lines)}</td><td class="num">${n0(o.units)}</td>
      <td>${fmtDate(o.due)}${isLate(o) ? ' <span class="pill p-bad">Late</span>' : ''}</td><td>${pill(o.status)}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">No outbound orders yet.</div>';
  return card('Recent outbound orders', body, `<a class="btn sm" href="#outbound">All orders</a>`);
}

/* =====================================================================
   RENDER
   ===================================================================== */
function dashboard(d) {
  return `
    <div class="head"><div><div class="crumb">Dashboard</div><h1>Operations Dashboard</h1></div>
      <div class="actions"><a class="btn" href="#asn/new">+ New ASN</a><a class="btn pri" href="#oborders/new">+ Outbound order</a></div></div>
    ${kpis(d)}
    <section class="grid g-2">${flowChart(d)}${workQueue(d)}</section>
    <section class="grid g-3">${alerts(d)}${occupancy(d)}${billing(d)}</section>
    ${recentOrders(d)}`;
}

/* =====================================================================
   SAVED RECORDS
   ASNs and orders created in the forms. Kept in this browser only
   (localStorage) until the app has a backend; then POST them instead.
   ===================================================================== */
const M = DATA.master;
const y0 = String(today.getFullYear());
const addr = (short, bldg, street, district, addl, zip, city, province) => ({ short, bldg, street, district, addl, zip, city, province, country: 'Saudi Arabia' });
const contact = (sal, name, desig, email, mobile, dept) => ({ primary: true, sal, name, desig, email, phone: '', mobile, dept });
const cust = (id, name, name2, company, o) => ({ id, name, name2, company, type: 'Business', status: 'Active', lang: 'English', tax: 'VAT registered', place: 'Saudi Arabia',
  currency: 'SAR', credit: 0, terms: 30, sales: '', rule: 'FEFO', sla: 24, sameShip: true, shipping: {}, comm: { email: true, phone: true, whatsapp: false }, remarks: '', docs: [], recv: 0, unused: 0, ...o });

const SEED = () => {
  const customers = [
    cust('CL-001', 'Red Sea Foods', 'أغذية البحر الأحمر', 'Red Sea Foods Trading Co.', { email: 'ops@redseafoods.sa', phone: '+966 12 610 4400', vat: '310123456700003', cr: '4030123456', credit: 50000, terms: 30, sales: 'Noura Al-Otaibi', industry: 'Food & beverage', rule: 'FEFO', sla: 24, recv: 6210.5,
      billing: addr('JEDA1234', '7421', 'King Abdulaziz Rd', 'Al Rawdah', '3312', '23435', 'Jeddah', 'Makkah'), contacts: [contact('Mr.', 'Faisal Al-Harbi', 'Logistics Manager', 'faisal@redseafoods.sa', '+966 55 210 4471', 'Supply chain')] }),
    cust('CL-002', 'Najd Electronics', 'إلكترونيات نجد', 'Najd Electronics Company', { email: 'supply@najdelec.sa', phone: '+966 11 455 2200', vat: '310987654300003', cr: '1010987654', credit: 80000, terms: 45, sales: 'Khalid Mansour', industry: 'Electronics', rule: 'FIFO', sla: 24, recv: 4120,
      billing: addr('RRKA4521', '4521', 'Olaya St', 'Al Olaya', '8810', '12211', 'Riyadh', 'Riyadh'), contacts: [contact('Ms.', 'Sara Al-Qahtani', 'Supply Chain Lead', 'sara@najdelec.sa', '+966 55 330 9182', 'Operations')] }),
    cust('CL-003', 'Hijaz Pharma', 'الحجاز للأدوية', 'Hijaz Pharmaceutical Co.', { email: 'warehouse@hijazpharma.sa', phone: '+966 12 667 1010', vat: '310456789100003', cr: '4030456789', credit: 40000, terms: 30, sales: 'Noura Al-Otaibi', industry: 'Pharmaceutical', rule: 'FEFO', sla: 12, recv: 8930,
      billing: addr('JEDB2210', '2210', 'Prince Sultan Rd', 'Al Zahra', '6021', '23425', 'Jeddah', 'Makkah'), contacts: [contact('Dr.', 'Omar Siddiqui', 'Distribution Manager', 'omar@hijazpharma.sa', '+966 55 714 2290', 'Distribution')] }),
    cust('CL-004', 'Souq Style', 'سوق ستايل', 'Souq Style E-Commerce LLC', { email: 'hello@souqstyle.sa', phone: '+966 12 699 3030', vat: '310222333400003', cr: '4030222333', credit: 25000, terms: 30, sales: 'Khalid Mansour', industry: 'E-commerce fashion', rule: 'FIFO', sla: 24, unused: 1500,
      billing: addr('JEDC7788', '7788', 'Tahlia St', 'Al Andalus', '2451', '23326', 'Jeddah', 'Makkah'), contacts: [contact('Ms.', 'Lina Al-Zahrani', 'E-commerce Operations', 'lina@souqstyle.sa', '+966 55 882 1044', 'Operations')] })
  ];
  // one active contract per customer, from its rate card
  const RATES = { 'CL-001': [4.5, 12, 3.5, 8, 1.2, 85], 'CL-002': [3.8, 10, 3, 6, 1.5, 95], 'CL-003': [6, 15, 4.5, 10, 2, 120], 'CL-004': [3.5, 9, 2.5, 5, 1, 70] };
  const codes = ['STR-001', 'HDL-001', 'HDL-002', 'HDL-003', 'VAS-001', 'TRN-001'];
  const contracts = customers.map((c, i) => ({ ...ctrBlank(c.id, c), id: 'CTR-' + String(i + 1).padStart(5, '0'), ref: c.name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) + '-AGR-001',
    start: y0 + '-01-01', end: y0 + '-12-31', status: 'Active', approvedBy: 'Hamza Kadenja', approvedAt: y0 + '-01-01',
    ...(i === 2 ? { insurance: 'Gray Lane', insurer: 'Sample Insurance Co.', policyNo: 'POL-2026-0042', sumInsured: 2500000, policyExpiry: y0 + '-12-31', coInsured: 'Yes' } : {}),
    lines: codes.map((code, j) => { const s = svcBy(code); return { code, name: s.name, cat: s.cat, unit: s.unit, rate: RATES[c.id][j], minFee: 0 }; }) }));
  const ql = (code, desc, qty, rate, disc) => { const s = svcBy(code); return { svc: code, item: s.name, desc, qty, unit: s.unit, rate, disc, vat: '0.15' }; };
  const quotes = [
    { ...quoteBlank('CL-004', customers[3]), id: 'QT-JED-00001', date: iso(addDays(today, -3)), expiry: iso(addDays(today, 27)), subject: 'Ramadan peak storage and fulfilment', status: 'Sent',
      lines: [ql('STR-001', 'Extra 120 pallet positions for 60 days', 7200, 3.5, 5), ql('HDL-003', 'Estimated e-commerce orders', 3000, 5, 0)] },
    { ...quoteBlank('CL-001', customers[0]), id: 'QT-JED-00002', date: iso(addDays(today, -1)), expiry: iso(addDays(today, 14)), subject: 'Chilled distribution, Jeddah to Makkah', status: 'Draft',
      lines: [ql('TRN-001', 'Reefer truck, weekly route', 8, 85, 0)] }
  ];
  return { customers, quotes, contracts, asns: [], orders: [], ...WH_SEED(), ...IB_SEED(), seq: { CL: 5, ASN: DATA.numbering.nextAsn, OB: { ...DATA.numbering.nextOb }, QT: { JED: 3, RUH: 1 }, CTR: 5, ITEM: 113, MAT: 6, IB: 1 }, ...ITEM_SEED() };
};

const ITEM_SEED = () => ({
  items: JSON.parse(JSON.stringify(M.itemSeed)),
  groups: [['Food - dry', 'Ambient', 'Groceries'], ['Food - chilled', 'Chilled', 'Dairy'], ['Food - frozen', 'Frozen', 'Seafood'], ['Electronics', 'Ambient', 'Appliances'], ['Pharmaceutical', '', 'Medicines'], ['Apparel', 'Ambient', 'Clothing'], ['General merchandise', '', '']]
    .map(([name, temp, cat]) => ({ name, code: codeFrom(name, 'GRP'), temp, cat, desc: '', status: 'Active' })),
  cats: [['Groceries', 'Food - dry'], ['Dairy', 'Food - chilled'], ['Seafood', 'Food - frozen'], ['Appliances', 'Electronics'], ['Mobile phones', 'Electronics'], ['Medicines', 'Pharmaceutical'], ['Clothing', 'Apparel'], ['Accessories', 'Apparel']]
    .map(([name, group]) => ({ name, code: codeFrom(name, 'CAT'), group, desc: '', status: 'Active' })),
  uoms: [['Piece', 'Piece', 'قطعة', 'Count'], ['Unit', 'Unit', 'وحدة', 'Count'], ['Box', 'Box', 'صندوق', 'Count'], ['Carton', 'Carton', 'كرتون', 'Count'], ['Pack', 'Pack', 'عبوة', 'Count'], ['Bag', 'Bag', 'كيس', 'Count'],
    ['Kg', 'Kilogram', 'كيلوغرام', 'Weight', true], ['Litre', 'Litre', 'لتر', 'Volume', true], ['Pallet', 'Pallet', 'منصة', 'Handling unit']].map(([code, name, ar, type, dec]) => ({ code, name, ar, type, dec: !!dec, status: 'Active', desc: '' })),
  materials: [['MAT-001', 'Shrink film roll 500 m', 'Stretch / shrink film', 'Roll', 45, 60, 40, 10], ['MAT-002', 'Thermal label 100×150 mm', 'Labels', 'Label', 0.05, 0.15, 20000, 5000], ['MAT-003', 'Wooden pallet 1200×1000', 'Pallets', 'Pallet', 35, 50, 120, 30],
    ['MAT-004', 'Export carton 40×30×30', 'Cartons & boxes', 'Carton', 3.5, 5, 800, 200], ['MAT-005', 'Bubble wrap roll 50 m', 'Protective packing', 'Roll', 28, 40, 4, 5]]
    .map(([code, name, type, unit, cost, charge, onHand, reorder]) => ({ code, name, name2: '', type, unit, cost, charge, onHand, reorder, reorderQty: 0, lead: 0, supplier: '', supCode: '', location: '', desc: '', vat: '0.15', svc: '', status: 'Active', log: [] })),
  matMoves: [], stockAdds: {}
});
const codeFrom = (n, p) => p + '-' + String(n || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12);

/* Records live in this browser (localStorage) until the app has a backend. */
const STORE_KEY = 'graylane.web.v2';
const readStore = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { /* storage unavailable */ } };
let DB;   // set by initStore() once the helpers below exist
function initStore() {
  DB = readStore(STORE_KEY);
  if (!DB) {
    DB = SEED();
    const v1 = readStore('graylane.web.v1');   // ASNs / orders saved by the first version
    if (v1) { DB.asns = v1.asns || []; DB.orders = v1.orders || []; DB.seq.ASN = v1.nextAsn || DB.seq.ASN; DB.seq.OB = v1.nextOb || DB.seq.OB; }
    persist();
  }
  // service items become editable records (Billing Engine → Service Items)
  if (!DB.services) DB.services = M.services.map(svcNorm);
  M.services = DB.services;
  // stores saved before Items / SKU Master existed: add the missing collections
  const add = { ...ITEM_SEED(), ...WH_SEED() }; let changed = false;
  Object.keys(add).forEach(k => { if (DB[k] == null) { DB[k] = add[k]; changed = true; } });
  if (DB.seq.ITEM == null) { DB.seq.ITEM = 113; DB.seq.MAT = 6; changed = true; }
  if (!DB.seq.IB) { const ib = IB_SEED(); ['stock', 'tasks', 'grns', 'moves'].forEach(k => { if (!DB[k]) DB[k] = ib[k]; });
    ib.asns.forEach(x => { if (!DB.asns.some(a => a.id === x.id)) DB.asns.unshift(x); }); DB.asns.forEach(ibNorm); DB.seq.IB = 1; changed = true; }
  if (!DB.seq.STK) { seedStock(); seedOrders(); DB.orders.forEach(obNorm); DB.seq.STK = 1; changed = true; }
  if (!DB.seq.INV) { seedInventory(); DB.seq.INV = 1; changed = true; }
  if (!DB.seq.RMA) { seedReturns(); DB.seq.RMA = 1; changed = true; }
  if (!DB.seq.VAS) { seedVas(); DB.seq.VAS = 1; changed = true; }
  if (!DB.seq.FLOW) { flowBackfill(); DB.seq.FLOW = 1; changed = true; }
  if (!DB.seq.BILL) { seedBilling(); DB.seq.BILL = 1; changed = true; }
  if (!DB.seq.SET) { setSeed(); DB.seq.SET = 1; changed = true; }
  setSeed();
  if (changed) persist();
}

const client = id => DB.customers.find(c => c.id === id) || {};
const clName = id => client(id).name || '';
const svcBy = code => M.services.find(s => s.code === code) || {};
const userBy = name => M.users.find(u => u.name === name) || {};
const ME = () => userBy(DATA.user.name);
const whRec = id => DB.warehouses.find(w => w.id === id) || {};
const item = sku => DB.items.find(i => i.sku === sku) || {};
const itemsOf = cl => DB.items.filter(i => i.client === cl && i.variant !== 'template' && i.track !== false && i.status !== 'Inactive');
const avail = (w, sku) => obAvail(item(sku).client, w, sku);
const custOpts = () => DB.customers.filter(c => c.status !== 'Inactive').map(c => [c.id, c.name]);
const whOpts = () => DB.warehouses.filter(w => w.status === 'Active').map(w => [w.id, w.name]);
const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('');

// dashboard figures plus anything saved from the forms
function withSaved(d) {
  const mine = DB.orders.filter(o => o.status !== 'Draft').slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || b.id.localeCompare(a.id)).map(o => ({
    id: o.id, customer: clName(o.client), shipTo: o.customer, warehouse: whRec(o.wh).name,
    lines: o.lines.filter(l => l.sku).length, units: sum(o.lines, l => +l.qty || 0), due: o.due, status: o.status }));
  const add = { 'ASNs expected': DB.asns.filter(a => ['Submitted', 'Approved'].includes(a.status)).length, 'Putaway tasks open': DB.tasks.filter(t => t.status === 'Open').length, 'Orders to allocate': DB.orders.filter(o => o.status === 'New').length, 'Pick lists in progress': DB.orders.filter(o => o.status === 'Allocated').length, 'Ready to dispatch': DB.orders.filter(o => o.status === 'Picked').length };
  const live = new Set(Object.keys(add));
  return { ...d, warehouses: DB.warehouses.filter(w => w.status !== 'Inactive').map(w => ({ name: w.name, capacity: w.capacity, pallets: palletsOf(w.id) })), pallets: sum(DB.warehouses, w => palletsOf(w.id)), customers: DB.customers.filter(c => c.status !== 'Inactive').length, orders: mine.slice(0, 6), queue: d.queue.map(q => ({ ...q, open: live.has(q.task) ? add[q.task] : q.open })) };
}

/* =====================================================================
   FORM HELPERS (same building blocks as the ERP's inbound/outbound forms)
   ===================================================================== */
const fld = (label, html, req, cls = '') => `<label class="field ${cls}"><span class="flbl">${label}${req ? '<span class="req"> *</span>' : ''}</span>${html}</label>`;
const inp = (name, v, { type = 'text', ph = '', cls = '' } = {}) => `<input name="${name}" type="${type}" value="${esc(v)}" class="${cls}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`;
const sel = (name, opts, v) => `<select name="${name}">${opt(opts, v)}</select>`;
const ro = (label, v) => fld(label, `<input value="${esc(v)}" readonly tabindex="-1" class="ro-in">`);
const sec = (title, body, sub) => `<section class="card"><div class="card-h"><div><h2>${title}</h2>${sub ? `<p class="note">${sub}</p>` : ''}</div></div>${body}</section>`;
const stepBar = (steps, meta) => `<div class="ib-bar">${steps.map((s, j) => `<span class="${j ? '' : 'cur'}">${s}</span>`).join('<i>›</i>')}<span class="ib-meta">${meta}</span></div>`;
const foot = list => `<div class="form-foot">${list.map(([l, act, cls]) => `<button type="button" class="btn ${cls || ''}" data-act="${act}">${l}</button>`).join('')}</div>`;
const IMG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-7 7"/></svg>';
const TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
const delBtn = i => `<button type="button" class="icon-btn del" data-act="delLine" data-id="${i}" aria-label="Remove line" title="Remove line">${TRASH}</button>`;
const datalists = cl => { const its = itemsOf(cl);
  return `<datalist id="dlCode">${its.map(x => `<option value="${esc(x.code)}">${esc(x.name)} · ${esc(x.custCode)}</option>`).join('')}</datalist>
    <datalist id="dlName">${its.map(x => `<option value="${esc(x.name)}">${esc(x.code)} · ${esc(x.custCode)}</option>`).join('')}</datalist>
    <datalist id="dlCust">${its.map(x => `<option value="${esc(x.custCode)}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</datalist>`; };
const searchCells = () => `<td><input type="hidden" data-l="sku" value=""><input data-l="code" list="dlCode" placeholder="Search code" class="mono" autocomplete="off" aria-label="Item code"></td>
  <td><input data-l="name" list="dlName" placeholder="Type or search item name" autocomplete="off" aria-label="Item name"></td>
  <td><input data-l="cust" list="dlCust" placeholder="Search cust. code" class="mono" autocomplete="off" aria-label="Customer item code"></td>`;
const qtyIn = l => `<input data-l="qty" type="number" min="1" step="1" value="${esc(l.qty)}" class="num" aria-label="Quantity">`;
const pageHead = (crumb, title) => `<div class="head"><div><div class="crumb">${crumb}</div><h1>${title}</h1></div><div class="actions"><a class="btn" href="#dashboard">← Dashboard</a></div></div>`;
const blankLine = () => ({ sku: '', qty: '', desc: '' });

/* =====================================================================
   NEW ASN  (ERP: Inbound › ASN)
   ===================================================================== */
let draft = null;
const newAsn = () => { while (DB.asns.some(x => x.id === 'ASN-' + DB.seq.ASN)) DB.seq.ASN++; return ({ kind: 'asn', saved: false, id: 'ASN-' + DB.seq.ASN, status: 'Draft', created: iso(today),
  client: custOpts()[0][0], ref: '', eta: iso(addDays(today, 1)), slot: '', wh: (whOpts()[0] || [''])[0],
  shipment: '', container: '', carrier: '', vehicle: '', driver: '', driverId: '', mobile: '', remarks: '', lines: [blankLine()] }); };

function asnLine(l, i) {
  if (!l.sku) return `<tr class="ib-ln" data-i="${i}"><td class="num pad note">${i + 1}</td>${searchCells()}<td>${qtyIn(l)}</td><td class="pad"><span class="note">Auto</span></td><td>${delBtn(i)}</td></tr>`;
  const it = item(l.sku);
  return `<tr class="ib-ln" data-i="${i}"><td class="num pad note">${i + 1}</td>
    <td><b class="mono ib-codecell">${esc(it.code)}</b><input type="hidden" data-l="sku" value="${esc(l.sku)}"></td>
    <td><div class="ib-item"><div class="ib-thumb">${IMG}</div><div class="ib-item-main">
      <div class="ib-item-top"><b>${esc(it.name.toUpperCase())}</b><button type="button" class="ib-round" data-act="clearItem" data-id="${i}" aria-label="Change item" title="Change item">×</button></div>
      <textarea data-l="desc" rows="2" placeholder="Add a description to your item">${esc(l.desc)}</textarea>
      <span class="ib-tag">${esc(it.kind.toUpperCase())}</span></div></div></td>
    <td class="mono pad">${esc(it.custCode)}</td><td>${qtyIn(l)}</td><td class="pad">${esc(it.uom)}</td><td>${delBtn(i)}</td></tr>`;
}

function asnPage(a) {
  const locked = a.status !== 'Draft';
  if (locked) setTimeout(() => document.querySelectorAll('#ibForm :is(input,select,textarea,button)').forEach(el => el.disabled = true), 0);
  return `${head2('<a href="#asn" style="color:inherit">Inbound · ASN</a>', 'ASN · ' + esc(a.id), '<a class="btn" href="#asn">← All ASNs</a>')}
  ${ibChain(a, 'asn')}
  ${locked ? `<p class="note" style="margin:0">This ASN is ${esc(a.status.toLowerCase())} and read-only.</p>` : ''}
  <div class="err" id="ibErr" role="alert"></div>
  <form id="ibForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${sec('Inbound booking / ASN', `<div class="card-b fgrid f3">
    ${ro('ASN No.', a.id)}
    ${fld('Customer', sel('client', custOpts(), a.client), 1)}
    ${fld('Customer Ref.', inp('ref', a.ref, { ph: 'Customer’s own reference' }))}
    ${fld('Expected arrival date', inp('eta', a.eta, { type: 'date' }), 1)}
    ${fld('Expected arrival time', inp('slot', a.slot, { type: 'time' }))}
    ${fld('Warehouse', sel('wh', whOpts(), a.wh), 1)}
    ${fld('Shipment No.', inp('shipment', a.shipment, { cls: 'mono' }))}
    ${fld('Container No.', inp('container', a.container, { cls: 'mono', ph: 'e.g. MSKU1234567' }))}
    ${fld('Carrier', inp('carrier', a.carrier))}
    ${fld('Vehicle No.', inp('vehicle', a.vehicle, { cls: 'mono' }), 1)}
    ${fld('Driver name', inp('driver', a.driver), 1)}
    ${fld('Driver ID / Iqama', inp('driverId', a.driverId, { cls: 'mono' }), 1)}
    ${fld('Driver mobile', inp('mobile', a.mobile, { type: 'tel', ph: '+966 5X XXX XXXX' }), 1)}
    ${fld('Remarks', inp('remarks', a.remarks, { ph: 'Optional note' }), 0, 'span2')}</div>`)}
  ${sec('Expected item lines', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines"><thead><tr><th class="num" style="width:50px">S.No</th><th style="width:150px">Item code</th><th style="min-width:320px">Item name</th><th style="width:170px">Cust. item code</th><th class="num" style="width:130px">Expected qty</th><th style="width:90px">UOM</th><th style="width:44px"></th></tr></thead>
    <tbody>${a.lines.map(asnLine).join('')}</tbody></table></div>${datalists(a.client)}
    <button type="button" class="btn sm" data-act="addLine" style="margin-top:10px">+ Add line</button></div>`,
    'Search by item code or name. Customer item code and UOM come from the item master; batch, MFG and expiry are captured at receiving.')}
  </form>
  ${foot(a.status === 'Draft' ? [...(a.saved ? [['Delete draft', 'deleteDraft', 'danger']] : []), ['Save draft', 'saveDraft'], ['Submit ASN', 'submitAsn', 'pri']]
    : [...(['Submitted', 'Approved'].includes(a.status) ? [['Cancel ASN', 'cancelAsn', 'danger']] : []), ...(a.status === 'Submitted' ? [['Approve', 'approveAsn', 'pri']] : []), ...(ibRcvElig(a) ? [['Convert to receiving →', 'toReceiving', 'pri']] : [])])}`;
}

function validateAsn(a) {
  if (!a.client) throw new Error('Choose the customer.');
  if (!a.eta) throw new Error('Enter the expected arrival date.');
  const W = whRec(a.wh); if (!W.id) throw new Error('Choose the warehouse.');
  if (W.status !== 'Active') throw new Error(W.name + ' is not active.');
  if (W.blockPlace === 'Yes') throw new Error(W.name + ' has Block placement set' + (W.reason ? ' (' + W.reason + ')' : '') + '.');
  [['vehicle', 'Vehicle No'], ['driver', 'Driver name'], ['driverId', 'Driver ID / Iqama'], ['mobile', 'Driver mobile']]
    .forEach(([f, l]) => { if (!a[f]) throw new Error('Enter the ' + l + '. It is required.'); });
  if (a.mobile && !/^[+0-9 ()-]{7,}$/.test(a.mobile)) throw new Error('Driver mobile does not look like a phone number.');
  if (!a.lines.length) throw new Error('Add at least one item line.');
  a.lines.forEach((l, i) => { const n = 'Line ' + (i + 1) + ': ';
    if (!l.sku) throw new Error(n + 'choose the item.');
    if (item(l.sku).client !== a.client) throw new Error(n + item(l.sku).code + ' belongs to another customer.');
    if (!(l.qty > 0) || !Number.isInteger(l.qty)) throw new Error(n + 'expected quantity must be a whole number above 0.'); });
}

/* =====================================================================
   NEW OUTBOUND ORDER  (ERP: Outbound › Customer Orders)
   ===================================================================== */
const obNo = w => { const loc = whRec(w).loc || 'JED'; return 'OB-' + loc + '-' + String(DB.seq.OB[loc] || 1).padStart(5, '0'); };
const newOrder = () => { const w = (whOpts()[0] || [''])[0];
  return { kind: 'order', saved: false, id: obNo(w), status: 'Draft', type: M.orderTypes[0], odate: iso(today), client: custOpts()[0][0], ref: '', wh: w,
    priority: 'Normal', due: iso(addDays(today, 1)), customer: '', address: '', contact: '', phone: '', lines: [blankLine()] }; };
const lineCheck = (o, l) => { const av = avail(o.wh, l.sku); return !l.sku ? '' : !(+l.qty > 0) ? 'Enter qty' : +l.qty > av ? 'Short ' + n0(+l.qty - av) : 'Available'; };

function orderLine(o, l, i) {
  if (!l.sku) return `<tr class="ib-ln" data-i="${i}"><td class="num pad note">${i + 1}</td>${searchCells()}<td class="num pad">—</td><td>${qtyIn(l)}</td><td class="pad"><span class="note">Auto</span></td><td></td><td>${delBtn(i)}</td></tr>`;
  const it = item(l.sku), v = lineCheck(o, l);
  return `<tr class="ib-ln" data-i="${i}"><td class="num pad note">${i + 1}</td>
    <td><b class="mono ib-codecell">${esc(it.code)}</b><input type="hidden" data-l="sku" value="${esc(l.sku)}"></td>
    <td><div class="ib-itemcard"><b>${esc(it.name)}</b><button type="button" class="ib-round" data-act="clearItem" data-id="${i}" aria-label="Change item" title="Change item">×</button></div></td>
    <td class="mono pad">${esc(it.custCode)}</td><td class="num pad">${n0(avail(o.wh, l.sku))}</td><td>${qtyIn(l)}</td><td class="pad">${esc(it.uom)}</td>
    <td class="pad vcell">${v ? pill(v) : ''}</td><td>${delBtn(i)}</td></tr>`;
}

function orderPage(o) {
  const locked = o.status !== 'Draft';
  if (locked) setTimeout(() => document.querySelectorAll('#ibForm :is(input,select,textarea,button)').forEach(el => el.disabled = true), 0);
  return `${head2('<a href="#oborders" style="color:inherit">Outbound · Outbound Orders</a>', 'Outbound Order · ' + esc(o.id), '<a class="btn" href="#oborders">← All outbound orders</a>')}
  ${obChain(o, 'oborders')}
  ${locked ? `<p class="note" style="margin:0">This order is ${esc(obStSt.oborders(o).toLowerCase())} and read-only.${o.backorderOf ? ' Backorder of ' + esc(o.backorderOf) + '.' : ''}${o.backorder ? ' Remaining balance: backorder ' + esc(o.backorder) + '.' : ''}</p>` : ''}
  <div class="err" id="ibErr" role="alert"></div>
  <form id="ibForm" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px">
  ${sec('Outbound Order', `<div class="card-b fgrid f3">
    ${ro('Order No.', o.id)}
    ${fld('Order type', sel('type', M.orderTypes.map(x => [x, x]), o.type))}
    ${fld('Order date', inp('odate', o.odate, { type: 'date' }), 1)}
    ${fld('Customer / stock owner', sel('client', custOpts(), o.client), 1)}
    ${fld('Customer Ref.', inp('ref', o.ref, { ph: 'Customer PO / order no.' }))}
    ${fld('Warehouse', sel('wh', whOpts(), o.wh), 1)}
    ${fld('Priority', sel('priority', M.priorities.map(x => [x, x]), o.priority))}
    ${fld('Requested dispatch date', inp('due', o.due, { type: 'date' }), 1)}
    ${fld('Ship to (consignee)', inp('customer', o.customer), 1)}
    ${fld('Delivery address', inp('address', o.address), 1, 'span2')}
    ${fld('Contact person', inp('contact', o.contact))}
    ${fld('Contact phone', inp('phone', o.phone, { type: 'tel' }))}</div>`)}
  ${sec('Order lines', `<div class="card-b"><div class="tbl-wrap"><table class="sd-lines"><thead><tr><th class="num" style="width:50px">S.No</th><th style="width:140px">Item code</th><th style="min-width:240px">Item name</th><th style="width:160px">Cust. item code</th><th class="num" style="width:90px">Available</th><th class="num" style="width:120px">Order qty</th><th style="width:90px">UOM</th><th style="width:130px">Validation</th><th style="width:44px"></th></tr></thead>
    <tbody>${o.lines.map((l, i) => orderLine(o, l, i)).join('')}</tbody></table></div>${datalists(o.client)}
    <button type="button" class="btn sm" data-act="addLine" style="margin-top:10px">+ Add line</button></div>`,
    'Available = this customer’s stock in the warehouse that is free to allocate (available status, not reserved, not blocked).')}
  </form>
  ${foot(o.status === 'Draft' ? [...(o.saved ? [['Delete draft', 'deleteDraft', 'danger']] : []), ['Save draft', 'saveDraft'], ['Approve &amp; release', 'approveOrder', 'pri']]
    : [...(['New', 'Allocated'].includes(o.status) ? [['Cancel order', 'cancelOrder', 'danger']] : []), ...(o.status === 'New' ? [['Convert to stock allocation →', 'toAlloc', 'pri']] : [])])}`;
}

function validateOrder(o) {
  if (!o.client) throw new Error('Choose the customer.');
  const W = whRec(o.wh); if (!W.id) throw new Error('Choose the warehouse.');
  if (W.status !== 'Active') throw new Error(W.name + ' is not active.');
  if (!o.customer) throw new Error('Enter the ship-to (consignee) name.');
  if (!o.address) throw new Error('Enter the delivery address.');
  if (!o.due) throw new Error('Enter the requested dispatch date.');
  if (o.phone && !/^[+0-9 ()-]{7,}$/.test(o.phone)) throw new Error('Contact phone does not look like a phone number.');
  const ls = o.lines.filter(l => l.sku);
  if (!ls.length) throw new Error('Add at least one item line.');
  if (o.lines.some(l => !l.sku)) throw new Error('Choose an item on every line or remove the empty line.');
  ls.forEach((l, i) => {
    if (item(l.sku).client !== o.client) throw new Error('Line ' + (i + 1) + ': ' + item(l.sku).code + ' belongs to another customer.');
    if (!(l.qty > 0) || !Number.isInteger(l.qty)) throw new Error('Line ' + (i + 1) + ': order quantity must be a whole number above 0.'); });
  const dup = ls.map(l => l.sku).find((s, i, a) => a.indexOf(s) !== i);
  if (dup) throw new Error(item(dup).code + ' is on two lines. Combine them into one line.');
}

/* =====================================================================
   FORM BEHAVIOUR
   ===================================================================== */
function readForm() {
  const fm = $('#ibForm'); if (!fm || !draft) return;
  fm.querySelectorAll('[name]').forEach(el => { draft[el.name] = el.value.trim(); });
  draft.lines = [...fm.querySelectorAll('.ib-ln')].map(r => {
    const g = k => { const el = r.querySelector(`[data-l="${k}"]`); return el ? el.value.trim() : ''; };
    const q = g('qty'); return { sku: g('sku'), qty: q === '' ? '' : (+q || 0), desc: g('desc') };
  });
}
function renderForm(focus) {
  $('#view').innerHTML = draft.kind === 'asn' ? asnPage(draft) : orderPage(draft);
  if (focus) { const el = $(focus); if (el) el.focus(); }
}
function showErr(msg) { const e = $('#ibErr'); e.textContent = msg; e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
function toast(msg) { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

function store() {   // insert or update the draft in saved records
  if (draft.kind === 'asn') { ibNorm(draft); if (!draft.saved) ibAudit(draft, 'ASN created'); } else { obNorm(draft); if (!draft.saved) { draft.created = draft.created || iso(today); ibAudit(draft, 'Order created'); } }
  if (!draft.saved) {
    if (draft.kind === 'asn') { while (DB.asns.some(x => x.id === draft.id)) { DB.seq.ASN++; draft.id = 'ASN-' + DB.seq.ASN; } DB.seq.ASN++; }
    else { const loc = whRec(draft.wh).loc; while (DB.orders.some(x => x.id === draft.id)) { DB.seq.OB[loc] = (DB.seq.OB[loc] || 1) + 1; draft.id = obNo(draft.wh); } DB.seq.OB[loc] = (DB.seq.OB[loc] || 1) + 1; }
    draft.saved = true;
  }
  const list = draft.kind === 'asn' ? DB.asns : DB.orders, rec = { ...draft }, i = list.findIndex(x => x.id === rec.id);
  delete rec.kind; delete rec.saved;
  if (i >= 0) list[i] = rec; else list.push(rec);
  persist();
}
function leave(msg, to = '#dashboard') { draft = null; go(to); toast(msg); }

const ACT = {
  addLine() { readForm(); draft.lines.push(blankLine()); renderForm(`[data-i="${draft.lines.length - 1}"] [data-l="code"]`); },
  delLine(i) { readForm(); draft.lines.splice(+i, 1); if (!draft.lines.length) draft.lines.push(blankLine()); renderForm(); },
  clearItem(i) { readForm(); draft.lines[+i].sku = ''; renderForm(`[data-i="${i}"] [data-l="code"]`); },
  saveDraft() { readForm(); store(); renderForm(); toast(draft.id + ': Draft saved.'); },
  deleteDraft() {
    const id = draft.id, was = draft.saved;
    if (was) { const k = draft.kind === 'asn' ? 'asns' : 'orders'; DB[k] = DB[k].filter(x => x.id !== id); persist(); }
    leave(was ? id + ' deleted.' : 'Draft discarded.', draft.kind === 'asn' ? '#asn' : '#oborders');
  },
  submitAsn() {
    readForm();
    try { validateAsn(draft); } catch (e) { return showErr(e.message); }
    draft.status = 'Submitted'; draft.submittedAt = iso(today); ibAudit(draft, 'ASN submitted'); store(); leave(draft.id + ' submitted. It is now waiting for approval.', '#asn');
  },
  approveAsn() {
    try { validateAsn(draft); } catch (e) { return showErr(e.message); }
    draft.status = 'Approved'; draft.acceptedAt = iso(today); draft.acceptedBy = DATA.user.name; ibAudit(draft, 'ASN approved'); store(); leave(draft.id + ' approved. It is now in the Receiving list.', '#asn');
  },
  cancelAsn() {
    if (!['Draft', 'Submitted', 'Approved'].includes(draft.status)) return showErr('Cancellation after arrival needs an exception process.');
    if (!confirm('Cancel ' + draft.id + '? It stays on record as Cancelled.')) return;
    draft.status = 'Cancelled'; ibAudit(draft, 'ASN cancelled'); store(); leave(draft.id + ' cancelled.', '#asn');
  },
  toReceiving() { const id = draft.id; draft = null; go('#receiving/edit/' + encodeURIComponent(id)); },
  approveOrder() {
    readForm();
    try { validateOrder(draft); } catch (e) { return showErr(e.message); }
    const o = draft, sh = o.lines.filter(l => l.qty > avail(o.wh, l.sku)).length;
    o.status = 'New'; o.approvedBy = DATA.user.name; o.approvedAt = iso(today); ibAudit(o, 'Order approved and released'); store();
    leave(o.id + ' approved.' + (sh ? ' ' + sh + (sh === 1 ? ' line exceeds' : ' lines exceed') + ' available stock — allocation will be partial.' : ' It is now in Allocate Stock.'), '#oborders');
  },
  cancelOrder() {
    if (!['New', 'Allocated'].includes(draft.status)) return showErr('Only approved or allocated orders can be cancelled.');
    if (!confirm('Cancel ' + draft.id + '? Any reserved stock is released.')) return;
    const o = obO(draft.id); obRelease(o); o.status = 'Cancelled'; ibAudit(o, 'Order cancelled'); persist(); leave(o.id + ' cancelled.', '#oborders');
  },
  toAlloc() { const id = draft.id; draft = null; go('#alloc/edit/' + encodeURIComponent(id));
  }
};

// pick an item from the code / name / customer-code search boxes
function pickItem(t, strict) {
  const v = t.value.trim(); if (!v) return;
  const k = v.split(' · ')[0].toLowerCase();
  const it = itemsOf(draft.client).find(x => x.code.toLowerCase() === k || x.name.toLowerCase() === v.toLowerCase() || x.sku.toLowerCase() === k || x.custCode.toLowerCase() === k);
  if (!it) { if (strict) { t.value = ''; toast('No item matches "' + v + '" for ' + clName(draft.client) + '.'); } return; }
  const i = +t.closest('.ib-ln').dataset.i;
  readForm(); draft.lines[i].sku = it.sku; renderForm(`[data-i="${i}"] [data-l="qty"]`);
}

$('#view').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && draft && $('#ibForm') && ACT[b.dataset.act]) ACT[b.dataset.act](b.dataset.id);
});
$('#view').addEventListener('input', e => {
  if (draft && e.target.closest('#ibForm') && ['code', 'name', 'cust'].includes(e.target.dataset.l) && (!e.inputType || e.inputType === 'insertReplacementText')) pickItem(e.target, false);
});
$('#view').addEventListener('change', e => {
  const t = e.target; if (!draft || !t.closest('#ibForm')) return;
  if (['code', 'name', 'cust'].includes(t.dataset.l)) return pickItem(t, true);
  if (t.name === 'client') {
    readForm(); const before = draft.lines.filter(l => l.sku).length;
    draft.lines = draft.lines.filter(l => !l.sku || item(l.sku).client === draft.client);
    if (!draft.lines.length) draft.lines.push(blankLine());
    if (before > draft.lines.filter(l => l.sku).length) toast('Items from the previous customer were removed.');
    return renderForm('[name="client"]');
  }
  if (t.name === 'wh') { readForm(); if (draft.kind === 'order' && !draft.saved) draft.id = obNo(draft.wh); return renderForm('[name="wh"]'); }
  if (t.dataset.l === 'qty' && draft.kind === 'order') {
    const r = t.closest('.ib-ln'), c = r.querySelector('.vcell'); readForm();
    if (c) { const v = lineCheck(draft, draft.lines[+r.dataset.i]); c.innerHTML = v ? pill(v) : ''; }
  }
});

/* =====================================================================
   SHARED LIST HELPERS
   ===================================================================== */
Object.assign(TONE, { Active: 'good', Inactive: 'mute', Sent: 'info', Accepted: 'good', Declined: 'bad', Expired: 'bad', 'Pending approval': 'warn', Superseded: 'mute', Terminated: 'bad' });
const optA = list => list.map(x => [x, x]);
const FILT = {};
const go = h => { if (location.hash === h) { route(); window.scrollTo(0, 0); } else location.hash = h; };
function filterBar(key, defs) {
  const f = FILT[key] || {};
  return `<div class="card"><div class="card-b filters">${defs.map(d => d.type === 'text'
    ? `<label class="field grow"><span>${d.label}</span><input type="search" data-filt="${key}|${d.id}" value="${esc(f[d.id] || '')}" placeholder="${esc(d.label)}" autocomplete="off"></label>`
    : `<label class="field"><span>${d.label}</span><select data-filt="${key}|${d.id}"><option value="">All</option>${opt(d.options.map(([k, l]) => [String(k), l]), f[d.id] || '')}</select></label>`).join('')}
    ${Object.values(f).some(Boolean) ? `<button type="button" class="btn sm" data-do="clearFilt" data-id="${key}" style="margin-bottom:3px">Clear filters</button>` : ''}</div></div>`;
}
function applyFilt(key, rows, fns = {}) {
  const f = FILT[key] || {};
  return rows.filter(r => Object.entries(f).every(([k, v]) => !v || (fns[k] ? fns[k](r, v) : String(r[k] ?? '') === v)));
}
const head2 = (crumb, title, actions = '') => `<div class="head"><div><div class="crumb">${crumb}</div><h1>${title}</h1></div><div class="actions">${actions}</div></div>`;
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const ICO = {
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

/* =====================================================================
   SIDEBAR
   ===================================================================== */
const IC = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  building: '<path d="M3 21V8l9-5 9 5v13"/><path d="M8 21v-7h8v7"/>',
  in: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  out: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  ret: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
};
const svgI = k => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
const PLUS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const NAV = [
  { m: [{ id: 'dashboard', t: 'Dashboard', ic: 'home', href: '#dashboard' }] },
  { g: 'COMMERCIAL', m: [
    { id: 'clients', t: 'Customers & Commercial', ic: 'users', subs: [['customers', 'Customers', 'customer'], ['quotes', 'Service Quotations', 'service quotation'], ['contracts', 'Contracts', 'contract']] },
    { id: 'items', t: 'Items / SKU Master', ic: 'tag', subs: [['items', 'Customer Items (SKUs)', 'item'], ['materials', 'VAS Materials', 'VAS material'], ['groups', 'Item Groups', 'item group'], ['categories', 'Categories', 'category'], ['uom', 'Units of Measure', 'unit of measure']] }] },
  { g: 'WAREHOUSE', m: [
    { id: 'warehouse', t: 'Warehouse Setup', ic: 'building', subs: [['warehouses', 'Warehouses', 'warehouse'], ['zones', 'Zones / Rooms', 'zone / room'], ['areas', 'Storage Areas', 'storage area'], ['bins', 'Bins / Slots', 'bin']] }, { id: 'inbound', t: 'Inbound', ic: 'in', subs: [['inbound', 'Dashboard'], ['asn', 'ASN', 'ASN'], ['receiving', 'Receiving', 'receiving'], ['grn', 'GRN', 'GRN'], ['putaway', 'Put-Away'], ['ibinv', 'Inventory']] },
    { id: 'inventory', t: 'Inventory', ic: 'layers', subs: [['stock', 'Stock'], ['bycust', 'Stock by Customer'], ['expiry', 'Batch & Expiry'], ['holds', 'Holds & Quarantine'], ['moves', 'Bin Moves', 'bin move'], ['transfers', 'Warehouse Transfers', 'warehouse transfer'], ['counts', 'Stock Counts', 'stock count'], ['adjust', 'Inventory Adjustments', 'inventory adjustment'], ['damage', 'Damage & Loss Register', 'damage or loss case'], ['ledger', 'Stock Ledger'], ['ageing', 'Stock Ageing'], ['statement', 'Customer Stock Statement']] }, { id: 'outbound', t: 'Outbound', ic: 'out', subs: [['outbound', 'Dashboard', 'outbound order'], ['oborders', 'Outbound Orders', 'outbound order'], ['alloc', 'Allocate Stock'], ['pick', 'Pick & Confirm'], ['loading', 'Load'], ['dispatch', 'Confirm Dispatch'], ['obhistory', 'Exceptions & History']] },
    { id: 'returns', t: 'Returns (RMA)', ic: 'ret', subs: [['returns', 'Dashboard', 'RMA'], ['rmareq', 'RMA Request'], ['rmarecv', 'Receive & Inspect'], ['rmaclose', 'Reconcile & Close']] }, { id: 'vas', t: 'Value-Added Services', ic: 'star', subs: [['vas', 'Dashboard', 'VAS request'], ['vasreq', 'VAS Requests', 'VAS request'], ['vaswo', 'Work Orders'], ['vasdone', 'Completion & Verification']] }] },
  { g: 'BILLING & ADMIN', m: [
    { id: 'billing', t: 'Billing Engine', ic: 'bill', subs: [['svc', 'Service Items', 'service item'], ['ratecard', 'Standard Rate Card'], ['custrates', 'Customer Rates'], ['charges', 'Charges', 'manual charge'], ['storage', 'Storage Capture'], ['billrun', 'Billing Run'], ['bdrafts', 'Billing Drafts'], ['billexc', 'Exceptions']] }, { id: 'reports', t: 'Reports & Analytics', ic: 'chart', subs: [['reports', 'Report Dashboard'], ['rep-biz', 'Business Overview'], ['rep-cust', 'Customer & Contract'], ['rep-inv', 'Inventory'], ['rep-wh', 'Warehouse'], ['rep-bill', 'Billing & Receivables'], ['rep-audit', 'Activity & Audit']] },
    { id: 'settings', t: 'Settings', ic: 'gear', href: '#settings' }] }
];
const openMods = new Set(['clients']);
let CUR = { mod: 'dashboard', sub: '' };
function renderNav() {
  const { mod, sub } = CUR;
  $('#navBox').innerHTML = NAV.map(g => ({ ...g, m: g.m.filter(m => can(m.id)) })).filter(g => g.m.length).map(g => `${g.g ? `<h3>${g.g}</h3>` : ''}${g.m.map(m => {
    if (!m.subs) return `<a class="nav ${mod === m.id ? 'on' : ''}" href="${m.href}"${mod === m.id ? ' aria-current="page"' : ''}>${svgI(m.ic)}<span>${esc(m.t)}</span></a>`;
    const open = openMods.has(m.id);
    return `<button type="button" class="nav ${open ? 'open' : ''} ${mod === m.id ? 'on' : ''}" data-navmod="${m.id}" aria-expanded="${open}">${svgI(m.ic)}<span>${esc(m.t)}</span>${CHEV}</button>
      ${open ? `<div class="subs">${m.subs.map(([k, t, one]) => `<div class="sub-row"><a class="sub ${sub === k ? 'on' : ''}" href="#${k}"${sub === k ? ' aria-current="page"' : ''}>${esc(t)}</a>${one ? `<a class="nav-plus" href="#${k}/new" aria-label="New ${one}" title="New ${one}">${PLUS}</a>` : ''}</div>`).join('')}</div>` : ''}`;
  }).join('')}`).join('');
}
