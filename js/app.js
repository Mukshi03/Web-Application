'use strict';
/* =====================================================================
   ROUTER
   #dashboard · #asn-new · #order-new
   #customers[/new | /edit/ID] · #quotes[/new | /edit/ID] · #contracts[/new[/QUOTE] | /edit/ID]
   ===================================================================== */
function showPage(page, mode, id) {
  if (page === 'asn-new') { history.replaceState(null, '', '#asn/new'); return ibShow('asn', 'new'); }
  if (['inbound', 'asn', 'receiving', 'grn', 'putaway', 'ibinv'].includes(page)) return ibShow(page, mode, id);
  if (page === 'order-new') { history.replaceState(null, '', '#oborders/new'); return obShow('oborders', 'new'); }
  if (['outbound', 'oborders', 'alloc', 'pick', 'loading', 'dispatch', 'obhistory'].includes(page)) return obShow(page, mode, id);
  if (INV_PAGES.includes(page)) return invShow(page, mode, id);
  if (['returns', 'rmareq', 'rmarecv', 'rmaclose', 'rma'].includes(page)) return rmaShow(page, mode, id);
  if (['vas', 'vasreq', 'vaswo', 'vasdone', 'vasw'].includes(page)) return vasShow(page, mode, id);
  if (BILL_PAGES.includes(page)) return billShow(page, mode, id);
  if (REP_PAGES.includes(page)) return repShow(page, mode, id);
  if (page === 'settings') return settingsShow(page, mode, id);
  if (page === 'inventory') { history.replaceState(null, '', '#stock'); return invShow('stock'); }
  if (page === 'customers') { CUR = { mod: 'clients', sub: page };
    if (mode === 'new') return customerForm('');
    if (mode === 'edit') return client(id).id ? customerForm(id) : head2('Customers', 'Customer not found', '<a class="btn" href="#customers">← Customers</a>') + '<div class="card empty">This customer no longer exists.</div>';
    return customersPage(); }
  if (page === 'quotes') { CUR = { mod: 'clients', sub: page };
    if (mode === 'new' || mode === 'edit') {
      const ex = DB.quotes.find(x => x.id === id);
      if (mode === 'edit' && !ex) return head2('Service quotations', 'Quotation not found', '<a class="btn" href="#quotes">← Service quotations</a>') + '<div class="card empty">This quotation no longer exists.</div>';
      const cl = custOpts()[0];
      if (!ex && !cl) return head2('Service quotations', 'New service quotation', '<a class="btn" href="#customers/new">+ New customer</a>') + '<div class="card empty">Add an active customer first.</div>';
      qDoc = ex ? JSON.parse(JSON.stringify(ex)) : quoteBlank(cl[0], client(cl[0]));
      setTimeout(qtRecalc, 0); return quoteForm(qDoc);
    }
    return quotesPage(); }
  if (page === 'contracts') { CUR = { mod: 'clients', sub: page };
    if (mode === 'new' || mode === 'edit') {
      const ex = mode === 'edit' && DB.contracts.find(x => x.id === id);
      if (mode === 'edit' && !ex) return head2('Contracts', 'Contract not found', '<a class="btn" href="#contracts">← Contracts</a>') + '<div class="card empty">This contract no longer exists.</div>';
      kRO = false;
      if (ex) {
        const st = ctrState(ex);
        if (st === 'Active') kDoc = { ...JSON.parse(JSON.stringify(ex)), id: '', version: (ex.version || 1) + 1, replaces: ex.id, status: 'Draft', start: ex.start, history: [] };
        else { kDoc = JSON.parse(JSON.stringify(ex)); kRO = !['Draft', 'Pending approval'].includes(st); }
      } else {
        const q = id && DB.quotes.find(x => x.id === id);
        const qLines = q ? q.lines.filter(l => l.svc).map(l => { const s = svcBy(l.svc); return { code: l.svc, name: s.name, cat: s.cat, unit: l.unit || s.unit, rate: +l.rate || 0, minFee: 0 }; }) : [];
        const live = q && ctrActive(q.client);
        if (live) {   // customer already has an active contract: the quotation revises it
          const keep = live.lines.filter(l => !qLines.some(x => x.code === l.code));
          kDoc = { ...JSON.parse(JSON.stringify(live)), id: '', version: (live.version || 1) + 1, replaces: live.id, status: 'Draft', quote: q.id, history: [], lines: [...keep, ...qLines] };
        } else kDoc = q ? ctrBlank(q.client, client(q.client), { quote: q.id, lines: qLines }) : ctrBlank('');
      }
      setTimeout(() => { if (kRO) document.querySelectorAll('#ctrForm :is(input,select,textarea,button)').forEach(el => el.disabled = true); }, 0);
      return contractForm(kDoc);
    }
    return contractsPage(); }
  if (page === 'items') { CUR = { mod: 'items', sub: page };
    if (mode === 'new') return itemForm('');
    if (mode === 'edit') return item(id).sku ? itemForm(id) : head2('Items', 'Item not found', '<a class="btn" href="#items">← Customer items</a>') + '<div class="card empty">This item no longer exists.</div>';
    return itemsPage(); }
  if (page === 'materials') { CUR = { mod: 'items', sub: page };
    if (mode === 'new') return materialForm('');
    if (mode === 'edit') return matBy(id).code ? materialForm(id) : head2('VAS Materials', 'Material not found', '<a class="btn" href="#materials">← VAS Materials</a>') + '<div class="card empty">This material no longer exists.</div>';
    return materialsPage(); }
  const WHP = { warehouses: ['warehouse', warehousesPage, id => whRec(id).id], zones: ['zone', zonesPage, id => zoneBy(id).id], areas: ['area', areasPage, id => areaById(id).id], bins: ['bin', binsPage, id => binByKey(id)] };
  if (WHP[page]) { const [kind, list, exists] = WHP[page]; CUR = { mod: 'warehouse', sub: page };
    if (page === 'bins' && mode === 'generate') return pfPage('gen', null, { area: id });
    if (mode === 'new') return pfPage(kind, null);
    if (mode === 'edit') return exists(id) ? pfPage(kind, id) : head2('Warehouse Setup', 'Not found', `<a class="btn" href="#${page}">← Back</a>`) + '<div class="card empty">This record no longer exists.</div>';
    return list(); }
  const MF = { groups: [groupsPage, grpForm], categories: [catsPage, catForm], uom: [uomPage, uomForm] };
  if (MF[page]) { CUR = { mod: 'items', sub: page }; if (mode === 'new') setTimeout(() => mfOpen(MF[page][1]('')), 0); return MF[page][0](); }
  CUR = { mod: page && NAV.some(g => g.m.some(m => m.id === page)) ? page : 'dashboard', sub: '' };
  return dashboard(withSaved(DATA));
}
function route() {
  const [page, mode, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  let html = showPage(page || 'dashboard', mode, rest.join('/'));
  if (CUR.mod && !can(CUR.mod)) html = head2('No access', 'This page is not available', '<a class="btn" href="#dashboard">← Dashboard</a>') + `<div class="card empty">Your role (${esc(DATA.user.role)}) cannot open this module. Ask an administrator, or switch user from your name at the top right.</div>`;
  $('#view').innerHTML = html;
  renderNav();
}

initStore();
$('#companyName').textContent = DATA.company;
$('#userBox').innerHTML = `<span class="avatar">${esc(DATA.user.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase())}</span><div><b>${esc(DATA.user.name)}</b><small>${esc(DATA.user.role)}</small></div>`;
$('#menuBtn').addEventListener('click', () => $('#side').classList.toggle('show'));
document.addEventListener('click', e => { if (window.innerWidth <= 900 && !e.target.closest('#side,#menuBtn,[data-navmod]')) $('#side').classList.remove('show'); });
const openFor = () => { const p = location.hash.slice(1).split('/')[0];
  if (['customers', 'quotes', 'contracts'].includes(p)) openMods.add('clients');
  if (['items', 'materials', 'groups', 'categories', 'uom'].includes(p)) openMods.add('items');
  if (['warehouses', 'zones', 'areas', 'bins'].includes(p)) openMods.add('warehouse');
  if (['inbound', 'asn', 'asn-new', 'receiving', 'grn', 'putaway', 'ibinv'].includes(p)) openMods.add('inbound');
  if (['outbound', 'order-new', 'oborders', 'alloc', 'pick', 'loading', 'dispatch', 'obhistory'].includes(p)) openMods.add('outbound');
  if (p === 'inventory' || INV_PAGES.includes(p)) openMods.add('inventory');
  if (['returns', 'rmareq', 'rmarecv', 'rmaclose', 'rma'].includes(p)) openMods.add('returns');
  if (['vas', 'vasreq', 'vaswo', 'vasdone', 'vasw'].includes(p)) openMods.add('vas');
  if (BILL_PAGES.includes(p)) openMods.add('billing');
  if (REP_PAGES.includes(p)) openMods.add('reports'); };
window.addEventListener('hashchange', () => {
  openFor();
  closeModal(true);
  route(); window.scrollTo(0, 0);
  if (window.innerWidth <= 900) $('#side').classList.remove('show');
});

setApply();
{ const h = (meU().prefs || {}).home; if (!location.hash && h && h !== 'dashboard') history.replaceState(null, '', '#' + h); }
openFor();
route();
