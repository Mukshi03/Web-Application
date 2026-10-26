'use strict';
/* =====================================================================
   WAREHOUSE SETUP  (ERP: Warehouse → Zone / room → Storage area → Bin / slot / pick face)
   ===================================================================== */
const REGIMES = ['Multi-temperature', 'Single-temperature', 'Unspecified'];
const TPROFILES = ['Frozen', 'Chilled', 'Ambient', 'Dry', 'Unspecified'];
const OP_MODELS = ['3PL storage & distribution', 'Fulfillment', 'Cross-dock'];
const TIMEZONES = ['Asia/Riyadh (UTC+03:00)', 'Asia/Bahrain (UTC+03:00)', 'Asia/Kuwait (UTC+03:00)', 'Asia/Qatar (UTC+03:00)', 'Asia/Dubai (UTC+04:00)', 'Asia/Muscat (UTC+04:00)'];
const KSA_REGIONS = ['Riyadh Region', 'Makkah Region', 'Madinah Region', 'Eastern Province', 'Qassim Region', 'Asir Region', 'Tabuk Region', 'Hail Region', 'Northern Borders Region', 'Jazan Region', 'Najran Region', 'Al Bahah Region', 'Al Jawf Region'];
const LIFE = ['Draft', 'Active', 'Inactive'];
const YN = [['No', 'No'], ['Yes', 'Yes']];
const ZTYPES = ['Reserve storage', 'Forward picking', 'Receiving', 'Dispatch staging', 'Quarantine', 'Returns'];
const STORE_Z = ['Reserve storage', 'Forward picking'];
const ZONE_ABBR = { 'Reserve storage': 'RSV', 'Forward picking': 'PCK', 'Receiving': 'RCV', 'Dispatch staging': 'STG', 'Quarantine': 'QAR', 'Returns': 'RET' };
const ZPREFIX = ['FRZ', 'CH', 'AMB', 'DRY', 'MIX', 'UNS'];
const ZPREFIX_T = { FRZ: 'Frozen', CH: 'Chilled', AMB: 'Ambient', DRY: 'Dry', MIX: 'Unspecified', UNS: 'Unspecified' };
const PRE_OF = { Frozen: 'FRZ', Chilled: 'CH', Ambient: 'AMB', Dry: 'DRY' };
const ENCLOSURES = ['Enclosed room', 'Open area', 'Secured cage'];
const GROUPINGS = ['Rack area', 'Aisle', 'Floor block', 'Shelf area', 'Staging lane'];
const SIDES = ['Left', 'Right', 'None'];
const BIN_PROFILES = ['PALLET-RACK', 'FLOOR-PALLET', 'SHELF-EACH', 'STAGING', 'QUARANTINE'];
const BP_LBL = { 'PALLET-RACK': 'Pallet rack', 'FLOOR-PALLET': 'Floor pallet', 'SHELF-EACH': 'Shelf (each)', 'STAGING': 'Staging', 'QUARANTINE': 'Quarantine' };
const bpOpts = () => BIN_PROFILES.map(x => [x, BP_LBL[x] || x]), bpl = x => BP_LBL[x] || x || '';
const BIN_ROLES = ['Reserve storage', 'Pick face', 'Quarantine', 'Dispatch staging', 'Receiving dock'];
const PUT_ROLES = ['Reserve storage', 'Pick face'];
const RACKS = 'ABCDEFGH'.split(''), LEVELS = [...Array(8)].map((_, i) => String(i + 1).padStart(2, '0')), POSNS = [...Array(12)].map((_, i) => String(i + 1).padStart(2, '0'));
const SYS_BINS = ['DOCK-IN', 'STAGE-OUT', 'RET-01', 'QA-HOLD'];
const WH_TEMP_RANGE = { Ambient: [20, 25, '+20 to +25 °C'], Dry: [25, 30, '+25 to +30 °C'], Chilled: [0, 5, '0 to +5 °C'], Frozen: [-25, -18, '−18 °C or colder'] };
const W_TEMPS = ['Ambient', 'Dry', 'Chilled', 'Frozen'];

const zoneBy = id => DB.zones.find(z => z.id === id) || {};
const areaById = id => DB.areas.find(a => a.id === id) || {};
const areaOf = b => areaById(b && b.areaId);
const zoneOf = b => zoneBy(b && b.zoneId);
const binKey = b => b.wh + '::' + b.code;
const binByKey = k => DB.bins.find(b => binKey(b) === k);
const binRec = (w, code) => DB.bins.find(b => b.wh === w && b.code === code);
const binCount = b => (+b.pallets || 0) + (DB.stock || []).filter(s => s.wh === b.wh && s.bin === b.code).length;
const palletsOf = w => sum(DB.bins.filter(b => b.wh === w), binCount);
const binState = b => { const n = binCount(b); return !n ? 'Empty' : b.cap < 99 && n >= b.cap ? 'Full' : 'In use'; };
const zoneTemp = z => W_TEMPS.includes(z.tempProfile) ? z.tempProfile : z.prefix === 'DRY' ? 'Dry' : 'Ambient';
const zoneProfile = z => z && z.id ? (z.tempProfile || 'Unspecified') + (z.tmin !== '' && z.tmin != null && z.tmax !== '' && z.tmax != null ? ` · ${z.tmin} to ${z.tmax} °C` : '') : '';
const nidOf = (pfx, list) => { let n = 1 + Math.max(0, ...list.map(x => +String(x.id).split('-')[1] || 0)); return pfx + '-' + String(n).padStart(3, '0'); };
const nextWhCode = () => { let n = 101, c; do { c = 'WH-' + n; n++; } while (DB.warehouses.some(w => w.id === c)); return c; };
const nextPrefixCode = (w, pre, selfId) => { let n = 1, c; do { c = pre + '-' + String(n).padStart(2, '0'); n++; } while (DB.zones.some(z => z.wh === w && z.id !== selfId && z.code === c)); return c; };
const areaCode = (z, aisle, side) => `${(z && z.code) || 'ZONE'}-A${String(aisle || '01').padStart(2, '0')}${side && side !== 'None' ? '-' + side[0] : ''}`;
const areaName = (z, g, aisle, side) => `${(z && z.name) || ''} — Aisle ${String(aisle || '01').padStart(2, '0')}${side && side !== 'None' ? ' ' + side : ''} ${g === 'Rack area' ? 'Rack Section' : g}`.trim();
const binCodeOf = (z, a, r, l, p) => `${String((z && z.code) || 'ZONE').replace(/-/g, '')}-A${a.aisle || '01'}${a.side && a.side !== 'None' ? '-' + a.side[0] : ''}-${r}-${l}-${p}`;
const binNameOf = (z, a, r, l, p) => [(z && z.name) || '', a.side && a.side !== 'None' ? a.side : '', 'Rack ' + r, 'Level ' + l, 'Position ' + p].filter(Boolean).join(' / ');
const roleForZone = t => ({ 'Forward picking': 'Pick face', 'Receiving': 'Receiving dock', 'Dispatch staging': 'Dispatch staging', 'Quarantine': 'Quarantine', 'Returns': 'Quarantine' }[t] || 'Reserve storage');
const whParentOpts = () => DB.warehouses.filter(w => w.status !== 'Inactive').map(w => [w.id, w.id + ' · ' + w.name]);
const zoneOptsP = w => DB.zones.filter(z => z.wh === w && z.status !== 'Inactive').map(z => [z.id, `${z.code} · ${z.name}`]);
const areaOptsP = z => DB.areas.filter(a => a.zoneId === z && a.status !== 'Inactive').map(a => [a.id, `${a.code} · ${a.name}`]);
const isLive = x => !x || !x.status || x.status === 'Active';
const binChain = b => [whRec(b.wh), zoneOf(b), areaOf(b)];
const placeBlocked = b => binChain(b).some(x => x && (x.blockPlace === 'Yes' || !isLive(x))) || b.blockPlace === 'Yes' || (b.life && b.life !== 'Active');
const allocBlocked = b => binChain(b).some(x => x && (x.blockAlloc === 'Yes' || !isLive(x))) || b.blockAlloc === 'Yes' || (b.life && b.life !== 'Active');
const binPutStatus = b => b.life && b.life !== 'Active' ? b.life : b.status === 'Blocked' ? 'Blocked' : placeBlocked(b) ? 'Placement blocked' : !PUT_ROLES.includes(b.role || 'Reserve storage') ? b.role : 'Available';
function binDerive(b) {
  if (!b.life) b.life = 'Active';
  b.status = b.life !== 'Active' || (b.blockPlace === 'Yes' && b.blockAlloc === 'Yes') ? 'Blocked' : 'Active';
  b.putaway = b.life === 'Active' && b.blockPlace !== 'Yes' && PUT_ROLES.includes(b.role || 'Reserve storage');
  b.pick = b.life === 'Active' && b.blockAlloc !== 'Yes' && b.role !== 'Quarantine';
  return b;
}
const ctlPills = x => `${x.status && x.status !== 'Active' ? pill(x.status === 'Draft' ? 'Draft' : 'Inactive') : ''}${x.blockPlace === 'Yes' ? ` <span class="pill p-warn" title="${esc(x.reason || '')}">Placement blocked</span>` : ''}${x.blockAlloc === 'Yes' ? ` <span class="pill p-warn" title="${esc(x.reason || '')}">Allocation blocked</span>` : ''}` || pill('Active');
const utilBar = (p, c) => { const pc = c ? Math.round(p / c * 100) : 0; return `<div style="min-width:110px"><div class="bar"><i style="width:${Math.min(100, pc)}%;background:${pc > 90 ? 'var(--bad)' : pc > 80 ? 'var(--accent-2)' : 'var(--accent)'}"></i></div><span class="note">${pc}% · ${p} of ${c}</span></div>`; };
const numOrBlank = (v, label, { min, max } = {}) => { if (v === '' || v == null) return ''; const n = +v; if (!isFinite(n)) throw new Error(label + ' must be a number.'); if (min != null && n < min) throw new Error(label + ' must be at least ' + min + '.'); if (max != null && n > max) throw new Error(label + ' must be at most ' + max + '.'); return n; };
const ctlCheck = d => { ['blockPlace', 'blockAlloc'].forEach(k => { if (d[k] !== 'Yes') d[k] = 'No'; }); if (!LIFE.includes(d.status)) d.status = 'Active';
  if ((d.blockPlace === 'Yes' || d.blockAlloc === 'Yes') && !(d.reason || '').trim()) throw new Error('Enter the restriction / change reason for the block.'); d.reason = (d.reason || '').trim(); };
const ctlSec = () => ({ title: 'Status & operational controls', fields: [
  { id: 'status', label: 'Lifecycle status', type: 'select', options: optA(LIFE), hint: 'Draft records are set up but not used by transactions yet.' },
  { id: 'blockPlace', label: 'Block placement', type: 'select', options: YN, hint: 'Stops putaway and moves into it and everything below it.' },
  { id: 'blockAlloc', label: 'Block new allocation', type: 'select', options: YN, hint: 'Stops orders from allocating stock from it and everything below it.' },
  { id: 'reason', label: 'Restriction / change reason', ph: 'Required when a block is set' }] });

/* ---- sample warehouse layout (first run) ---- */
function WH_SEED() {
  const W = [['WH-JED-01', 'Jeddah Ambient', 'JED', 'Jeddah', 'Ambient', 24, 22], ['WH-JED-02', 'Jeddah Chilled', 'JED', 'Jeddah', 'Chilled', 8, 6], ['WH-JED-03', 'Jeddah Frozen', 'JED', 'Jeddah', 'Frozen', 6, 3], ['WH-RUH-01', 'Riyadh Ambient', 'RUH', 'Riyadh', 'Ambient', 10, 5]];
  const warehouses = [], zones = [], areas = [], bins = []; let zn = 0, sa = 0;
  const ctl = { status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' };
  W.forEach(([id, name, loc, city, t, capacity, pallets]) => {
    const jed = city === 'Jeddah';
    warehouses.push({ id, name, loc, city, regime: 'Single-temperature', defTemp: t, type: t, opModel: '3PL storage & distribution', tz: TIMEZONES[0], capacity,
      street1: jed ? 'Al Khumrah Industrial Area' : '2nd Industrial City', street2: '', state: jed ? 'Makkah Region' : 'Riyadh Region', zip: jed ? '22616' : '14332', shortAddr: '', country: 'Saudi Arabia',
      phone: jed ? '+966 12 600 1000' : '+966 11 400 1000', email: (jed ? 'jeddah' : 'riyadh') + '.wh@graylane.com.sa', manager: 'Hamza Kadenja', supervisor: '', ...ctl });
    const mkZone = o => { const z = { id: 'ZN-' + String(++zn).padStart(3, '0'), wh: id, enclosure: 'Open area', tempProfile: t, prefix: 'UNS', tmin: '', tmax: '', humReq: 'Not specified', rhMin: '', rhMax: '', ...ctl, ...o }; zones.push(z); return z; };
    const mkArea = (z, o) => { const a = { id: 'SA-' + String(++sa).padStart(3, '0'), wh: id, zoneId: z.id, ...ctl, ...o }; areas.push(a); return a; };
    const mkBin = (z, a, o) => bins.push(binDerive({ wh: id, zoneId: z.id, areaId: a.id, aisle: a.aisle, client: '', maxKg: '', maxVol: '', clearH: '', life: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '', pallets: 0, ...o }));
    [['Receiving', 'RCV-01', 'Receiving', 'DOCK-IN', 'Receiving dock', 'STAGING'], ['Dispatch staging', 'STG-01', 'Dispatch staging', 'STAGE-OUT', 'Dispatch staging', 'STAGING'], ['Returns', 'RET-01', 'Returns', 'RET-01', 'Quarantine', 'QUARANTINE'], ['Quarantine', 'QAR-01', 'Quarantine', 'QA-HOLD', 'Quarantine', 'QUARANTINE']]
      .forEach(([n, code, type, bc, role, bp]) => { const z = mkZone({ name: n, code, type }); const a = mkArea(z, { grouping: bp === 'STAGING' ? 'Staging lane' : 'Floor block', aisle: '00', side: 'None', code: code + '-GEN', name: n + ' — general area', binProfile: bp, dflt: true });
        mkBin(z, a, { code: bc, name: n + ' / ' + bc, barcode: id + ':' + bc, binProfile: bp, cap: 99, role, temp: 'Any', rack: '', level: '', position: '' }); });
    const pre = PRE_OF[t], r = WH_TEMP_RANGE[t];
    const z = mkZone({ name: t + ' Storage 01', code: pre + '-01', prefix: pre, type: 'Reserve storage', enclosure: ['Frozen', 'Chilled'].includes(t) ? 'Enclosed room' : 'Open area', tmin: r[0], tmax: r[1] });
    const a = mkArea(z, { grouping: 'Rack area', aisle: '01', side: 'Left', code: areaCode(z, '01', 'Left'), name: areaName(z, 'Rack area', '01', 'Left'), binProfile: 'PALLET-RACK' });
    let left = pallets;
    for (let i = 0; i < capacity / 2; i++) { const rk = 'A', lv = LEVELS[Math.floor(i / 6)], po = POSNS[i % 6], code = binCodeOf(z, a, rk, lv, po), p = Math.min(2, left); left -= p;
      mkBin(z, a, { code, name: binNameOf(z, a, rk, lv, po), barcode: id + ':' + code, rack: rk, level: lv, position: po, binProfile: 'PALLET-RACK', cap: 2, role: 'Reserve storage', temp: t, pallets: p }); }
  });
  return { warehouses, zones, areas, bins };
}

/* ---- list pages ---- */
const rowBtns = (kind, key) => `<div class="rowicons"><a class="btn sm" href="#${kind}/edit/${encodeURIComponent(key)}">Edit</a><button type="button" class="btn sm danger" data-do="whDel" data-id="${esc(kind + '|' + key)}">Delete</button></div>`;
function warehousesPage() {
  const W = DB.warehouses;
  return head2('Warehouse Setup', 'Warehouses', `<a class="btn pri" href="#warehouses/new">+ New warehouse</a>`)
    + card(`${W.length} warehouse${W.length === 1 ? '' : 's'}`, W.length ? `<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Warehouse name</th><th>Location / Branch</th><th>City</th><th>Temperature</th><th class="num">Zones</th><th class="num">Areas</th><th class="num">Bins</th><th>Utilisation (pallets)</th><th>Status</th><th></th></tr></thead><tbody>
    ${W.map(w => `<tr class="click" data-href="#warehouses/edit/${encodeURIComponent(w.id)}"><td class="mono">${esc(w.id)}</td><td><b>${esc(w.name)}</b><br><span class="note">${esc(w.opModel || '')}</span></td><td><span class="pill p-mute">${esc(w.loc)}</span> ${esc(locName(w.loc))}</td><td>${esc(w.city)}</td>
      <td>${esc(w.regime || '')}${w.regime === 'Single-temperature' ? `<br><span class="note">${esc(w.defTemp)}</span>` : ''}</td><td class="num">${DB.zones.filter(z => z.wh === w.id).length}</td><td class="num">${DB.areas.filter(a => a.wh === w.id).length}</td><td class="num">${DB.bins.filter(b => b.wh === w.id).length}</td>
      <td>${utilBar(palletsOf(w.id), w.capacity)}</td><td>${ctlPills(w)}</td><td class="num">${rowBtns('warehouses', w.id)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No warehouses yet.</div>')
    + `<p class="note">Hierarchy: Warehouse → Zone / room → Storage area → Bin / slot / pick face. Only bins hold stock; each pallet in a bin carries an LPN.</p>`;
}
function zonesPage() {
  const rows = applyFilt('zns', DB.zones, {});
  return head2('Warehouse Setup', 'Zones / rooms', `<a class="btn pri" href="#zones/new">+ New zone / room</a>`)
    + filterBar('zns', [{ id: 'wh', label: 'Warehouse', options: DB.warehouses.map(w => [w.id, w.name]) }, { id: 'type', label: 'Primary function', options: optA(ZTYPES) }, { id: 'status', label: 'Lifecycle', options: optA(LIFE) }])
    + card(`${rows.length} zones / rooms`, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Zone code</th><th>Zone name</th><th>Function</th><th>Temperature</th><th>Warehouse</th><th class="num">Areas</th><th class="num">Bins</th><th>Utilisation</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(z => { const bs = DB.bins.filter(b => b.zoneId === z.id && b.cap < 99); return `<tr class="click" data-href="#zones/edit/${encodeURIComponent(z.id)}"><td><b class="mono">${esc(z.code)}</b></td><td><b>${esc(z.name)}</b><br><span class="note">${esc(z.enclosure || '')}</span></td><td>${esc(z.type)}</td>
      <td>${esc(z.tempProfile)}${z.tmin !== '' && z.tmin != null && z.tmax !== '' && z.tmax != null ? `<br><span class="note">${z.tmin} to ${z.tmax} °C</span>` : ''}</td><td>${esc(whRec(z.wh).name)}<br><span class="mono note">${esc(z.wh)}</span></td>
      <td class="num">${DB.areas.filter(a => a.zoneId === z.id).length}</td><td class="num">${DB.bins.filter(b => b.zoneId === z.id).length}</td>
      <td>${bs.length ? utilBar(sum(bs, binCount), sum(bs, b => b.cap)) : `<span class="note">${sum(DB.bins.filter(b => b.zoneId === z.id), binCount)} pallets</span>`}</td><td>${ctlPills(z)}</td><td class="num">${rowBtns('zones', z.id)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No zones match the filters.</div>')
    + `<p class="note">Putaway only suggests bins in active Reserve storage and Forward picking zones without a placement block. Receiving, dispatch staging, quarantine and returns zones are working areas.</p>`;
}
function areasPage() {
  const f = FILT.sas || {}, rows = applyFilt('sas', DB.areas, { zone: (a, v) => a.zoneId === v });
  const zf = f.wh ? DB.zones.filter(z => z.wh === f.wh) : DB.zones;
  return head2('Warehouse Setup', 'Storage areas', `<a class="btn pri" href="#areas/new">+ New storage area</a>`)
    + filterBar('sas', [{ id: 'wh', label: 'Warehouse', options: DB.warehouses.map(w => [w.id, w.name]) }, { id: 'zone', label: 'Zone / room', options: zf.map(z => [z.id, z.code + ' · ' + z.name]) }, { id: 'status', label: 'Lifecycle', options: optA(LIFE) }])
    + card(`${rows.length} storage areas`, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Area code</th><th>Storage area name</th><th>Aisle · side</th><th>Zone / room</th><th>Warehouse</th><th>Bin profile</th><th class="num">Bins</th><th class="num">Pallets</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(a => { const z = zoneBy(a.zoneId); return `<tr class="click" data-href="#areas/edit/${encodeURIComponent(a.id)}"><td><b class="mono">${esc(a.code)}</b></td><td><b>${esc(a.name)}</b><br><span class="note">${esc(a.grouping)}</span></td><td>${esc(a.aisle)} · ${esc(a.side)}</td>
      <td><span class="mono">${esc(z.code || '')}</span> · ${esc(z.name || '')}</td><td>${esc(whRec(a.wh).name)}</td><td><span class="note">${esc(bpl(a.binProfile))}</span></td><td class="num">${DB.bins.filter(b => b.areaId === a.id).length}</td><td class="num">${sum(DB.bins.filter(b => b.areaId === a.id), binCount)}</td><td>${ctlPills(a)}</td>
      <td class="num"><div class="rowicons">${STORE_Z.includes(z.type) ? `<a class="btn sm" href="#bins/generate/${encodeURIComponent(a.id)}">Generate bins</a>` : ''}${rowBtns('areas', a.id).replace(/^<div class="rowicons">|<\/div>$/g, '')}</div></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No storage areas yet. Add one for each aisle side, floor block or staging lane.</div>')
    + `<p class="note">A storage area groups bins inside a zone / room, such as one side of an aisle. Areas ending in -GEN hold the working bins created with each warehouse.</p>`;
}
function binsPage() {
  const rows = applyFilt('bins', DB.bins, { ztype: (b, v) => zoneOf(b).type === v, role: (b, v) => b.role === v, state: (b, v) => (b.status === 'Blocked' ? 'Blocked' : binState(b)) === v, q: (b, v) => (b.code + ' ' + (b.name || '')).toLowerCase().includes(v.toLowerCase()) });
  return head2('Warehouse Setup', 'Bins / slots', `<a class="btn" href="#bins/generate">Generate bins</a><a class="btn pri" href="#bins/new">+ New bin</a>`)
    + filterBar('bins', [{ id: 'wh', label: 'Warehouse', options: DB.warehouses.map(w => [w.id, w.name]) }, { id: 'ztype', label: 'Zone function', options: optA(ZTYPES) }, { id: 'role', label: 'Operational role', options: optA(BIN_ROLES) }, { id: 'state', label: 'State', options: optA(['Empty', 'In use', 'Full', 'Blocked']) }, { id: 'q', type: 'text', label: 'Search bin code or name' }])
    + card(`${rows.length} bins`, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Bin code</th><th>Warehouse · zone</th><th>Area</th><th>Profile · role</th><th class="num">Pallets</th><th>Putaway / picking</th><th>State</th><th>Temp</th><th></th></tr></thead><tbody>
    ${rows.map(b => { const z = zoneOf(b), ps = binPutStatus(b), k = binKey(b); return `<tr class="click" data-href="#bins/edit/${encodeURIComponent(k)}"><td><b class="mono">${esc(b.code)}</b><br><span class="note">${esc(b.name || '')}</span></td><td>${esc(whRec(b.wh).name)}<br><span class="note">${esc((z.code || '') + ' · ' + (z.name || ''))}</span></td>
      <td><span class="mono note">${esc(areaOf(b).code || '')}</span></td><td><span class="note">${esc(bpl(b.binProfile))}</span><br><span class="note">${esc(b.role || '')}</span></td><td class="num">${binCount(b)}${b.cap < 99 ? ' / ' + b.cap : ''}</td>
      <td>${ps === 'Available' ? '<span class="pill p-good">Putaway</span>' : `<span class="pill p-${['Draft', 'Inactive', 'Blocked', 'Placement blocked'].includes(ps) ? 'warn' : 'mute'}">${esc(ps)}</span>`} ${!allocBlocked(b) && b.pick !== false ? '<span class="pill p-info">Picking</span>' : ''}</td>
      <td>${pill(b.status === 'Blocked' ? 'Blocked' : binState(b))}</td><td>${esc(b.temp)}</td><td class="num">${rowBtns('bins', k)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No bins match the filters.</div>');
}
Object.assign(TONE, { Empty: 'mute', 'In use': 'info', Full: 'warn', Blocked: 'bad' });

/* ---- full-page forms (same framework as the ERP: Parent Mapping → details → controls) ---- */
let pf = { kind: 'warehouse', id: null };
const PF = {};
PF.warehouse = { single: 'warehouse', plural: 'Warehouses', list: '#warehouses', name: r => r.name,
  load: id => { if (id) return { ...whRec(id), company: DATA.company, temps: [] };
    return { company: DATA.company, loc: 'JED', id: nextWhCode(), name: '', regime: 'Single-temperature', defTemp: 'Ambient', temps: ['Frozen', 'Chilled', 'Ambient', 'Dry'], opModel: OP_MODELS[0], tz: TIMEZONES[0], capacity: 100,
      city: 'Jeddah', country: 'Saudi Arabia', street1: '', street2: '', state: '', zip: '', shortAddr: '', email: '', phone: '', manager: '', supervisor: '', status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' }; },
  sections: (r, ed) => { const stock = ed && palletsOf(r.id) > 0, multi = r.regime === 'Multi-temperature'; return [
    { title: 'Parent Mapping', fields: [
      { id: 'company', label: 'Company', type: 'select', req: 1, options: [[DATA.company, DATA.company]], lock: 1 },
      { id: 'loc', label: 'Location / Branch', type: 'select', req: 1, options: M.locations.map(l => [l.id, l.id + ' · ' + l.name]), lock: stock, hint: stock ? 'This warehouse holds stock, so it cannot move to another branch.' : 'All transactions of this warehouse belong to this branch.' }] },
    { title: 'Warehouse details', fields: [
      { id: 'id', label: 'Warehouse code', mono: 1, lock: 1, hint: ed ? 'Fixed for this warehouse.' : 'Generated automatically, e.g. WH-101.' },
      { id: 'name', label: 'Warehouse name', req: 1, ph: 'e.g. Jeddah Warehouse' },
      { id: 'regime', label: 'Temperature regime', type: 'select', options: optA(REGIMES) },
      { id: 'defTemp', label: 'Default temperature profile', type: 'select', options: optA(['Unspecified', 'Ambient', 'Chilled', 'Frozen', 'Dry']), lock: multi, hint: 'Used for single-temperature warehouses. Multi-temperature warehouses set it per zone / room.' },
      { id: 'temps', label: 'Create temperature zones', type: 'checks', wrap: 'pf_mixTemps', hidden: ed || !multi, options: [['Frozen', 'Frozen · FRZ-01'], ['Chilled', 'Chilled · CH-01'], ['Ambient', 'Ambient · AMB-01'], ['Dry', 'Dry · DRY-01']], hint: 'Optional. One zone / room is created for each one you tick.' },
      { id: 'opModel', label: 'Operating model', type: 'select', options: optA(OP_MODELS) },
      { id: 'tz', label: 'Time zone', type: 'select', options: optA(TIMEZONES) },
      { id: 'capacity', label: 'Planned pallet positions', type: 'number', min: 1, req: 1 }] },
    { title: 'Address', fields: [
      { id: 'street1', label: 'Street 1', ph: 'Building no., street name' }, { id: 'street2', label: 'Street 2', ph: 'District, additional no.' },
      { id: 'city', label: 'City', req: 1 }, { id: 'country', label: 'Country', list: 'dl_wcountry' },
      { id: 'state', label: 'State / region', list: 'dl_region' }, { id: 'zip', label: 'Zip / postal code', mono: 1, ph: '5 digits' },
      { id: 'shortAddr', label: 'National address short code', mono: 1, ph: 'e.g. JEDA1234', hint: 'Saudi national address (4 letters + 4 digits). Couriers and ZATCA invoices use it.' }] },
    { title: 'Contact', fields: [
      { id: 'phone', label: 'Phone', type: 'tel', ph: '+966 12 345 6789' }, { id: 'email', label: 'Email', type: 'email', ph: 'jeddah.wh@company.sa' },
      { id: 'manager', label: 'Warehouse manager', list: 'dl_staff' }, { id: 'supervisor', label: 'Warehouse supervisor', list: 'dl_staff' }] },
    ctlSec()]; },
  extra: () => `<datalist id="dl_wcountry">${GCC.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl_region">${KSA_REGIONS.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl_staff">${M.users.map(u => `<option value="${esc(u.name)}">`).join('')}</datalist>`,
  update(fm, t) { const q = n => fm.querySelector(`[name="${n}"]`); if (!t) return;
    if (t.name === 'regime') { const multi = t.value === 'Multi-temperature'; q('defTemp').disabled = multi; if (multi) q('defTemp').value = 'Unspecified'; else if (q('defTemp').value === 'Unspecified' && t.value === 'Single-temperature') q('defTemp').value = 'Ambient'; const m = fm.querySelector('#pf_mixTemps'); if (m && !pf.id) m.hidden = !multi; }
    if (t.name === 'loc' && !pf.id) { const c = q('city'); if (!c.value || M.locations.some(l => l.name === c.value)) c.value = locName(t.value); } },
  save(d, id) {
    if (!M.locations.some(l => l.id === d.loc)) throw new Error('Choose the location / branch this warehouse belongs to.');
    d.name = (d.name || '').trim(); if (!d.name) throw new Error('Enter the warehouse name.');
    if (DB.warehouses.some(w => w.id !== id && w.name.toLowerCase() === d.name.toLowerCase())) throw new Error('A warehouse called ' + d.name + ' already exists.');
    d.city = (d.city || '').trim(); if (!d.city) throw new Error('Enter the city.');
    if (!REGIMES.includes(d.regime)) d.regime = 'Unspecified';
    if (d.regime === 'Multi-temperature') d.defTemp = 'Unspecified';
    if (d.regime === 'Single-temperature' && !W_TEMPS.includes(d.defTemp)) throw new Error('Choose the default temperature profile for a single-temperature warehouse.');
    d.capacity = +d.capacity; if (!(d.capacity > 0)) throw new Error('Enter the planned pallet positions.');
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new Error('The contact email is not valid.');
    if (d.phone && !/^\+?[\d\s()-]{7,20}$/.test(d.phone)) throw new Error('The phone number can use digits, spaces, dashes and a leading +.');
    d.zip = (d.zip || '').trim(); if (d.zip && /saudi/i.test(d.country || '') && !/^\d{5}(-\d{4})?$/.test(d.zip)) throw new Error('Saudi postal codes have 5 digits (optionally -4 more).');
    d.shortAddr = (d.shortAddr || '').trim().toUpperCase(); if (d.shortAddr && !/^[A-Z]{4}\d{4}$/.test(d.shortAddr)) throw new Error('The national address short code is 4 letters followed by 4 digits, e.g. JEDA1234.');
    ctlCheck(d);
    d.type = d.regime === 'Multi-temperature' ? 'Mixed' : d.regime === 'Single-temperature' ? d.defTemp : 'Ambient';
    const temps = (d.temps || []).filter(t => W_TEMPS.includes(t)); delete d.temps; delete d.company;
    if (id) { const w = whRec(id), pal = palletsOf(id);
      if (w.loc !== d.loc && pal) throw new Error('This warehouse holds stock, so it cannot move to another branch.');
      if (d.capacity < pal) throw new Error(`${w.name} already holds ${pal} pallets. Planned pallet positions cannot be lower than that.`);
      if (d.status !== 'Active' && pal) throw new Error(`${w.name} still holds stock, so it must stay Active. Use Block placement to stop new putaway.`);
      Object.assign(w, d, { id }); return w; }
    d.id = nextWhCode();
    const w = { ...d }; DB.warehouses.push(w);
    const mkZone = o => { const z = { id: nidOf('ZN', DB.zones), wh: w.id, enclosure: 'Open area', tempProfile: W_TEMPS.includes(w.type) ? w.type : 'Unspecified', prefix: 'UNS', tmin: '', tmax: '', humReq: 'Not specified', rhMin: '', rhMax: '', status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '', ...o }; DB.zones.push(z); return z; };
    [['Receiving', 'RCV-01', 'Receiving', 'DOCK-IN', 'Receiving dock', 'STAGING'], ['Dispatch staging', 'STG-01', 'Dispatch staging', 'STAGE-OUT', 'Dispatch staging', 'STAGING'], ['Returns', 'RET-01', 'Returns', 'RET-01', 'Quarantine', 'QUARANTINE'], ['Quarantine', 'QAR-01', 'Quarantine', 'QA-HOLD', 'Quarantine', 'QUARANTINE']]
      .forEach(([n, code, type, bc, role, bp]) => { const z = mkZone({ name: n, code, type });
        const a = { id: nidOf('SA', DB.areas), wh: w.id, zoneId: z.id, grouping: bp === 'STAGING' ? 'Staging lane' : 'Floor block', aisle: '00', side: 'None', code: code + '-GEN', name: n + ' — general area', binProfile: bp, dflt: true, status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' }; DB.areas.push(a);
        DB.bins.push(binDerive({ wh: w.id, zoneId: z.id, areaId: a.id, aisle: '00', code: bc, name: n + ' / ' + bc, barcode: w.id + ':' + bc, binProfile: bp, cap: 99, role, temp: 'Any', client: '', maxKg: '', maxVol: '', clearH: '', life: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '', pallets: 0 })); });
    const made = [], NM = { Frozen: 'Frozen Room 01', Chilled: 'Chilled Room 01', Ambient: 'Ambient Storage 01', Dry: 'Dry Store 01' };
    const stz = t => { const pre = PRE_OF[t], r = WH_TEMP_RANGE[t]; made.push(mkZone({ name: w.regime === 'Multi-temperature' ? NM[t] : t + ' Storage 01', type: 'Reserve storage', prefix: pre, code: nextPrefixCode(w.id, pre), tempProfile: t, enclosure: ['Frozen', 'Chilled'].includes(t) ? 'Enclosed room' : 'Open area', tmin: r[0], tmax: r[1], humReq: t === 'Dry' ? 'Defined limits' : 'Not specified', rhMin: t === 'Dry' ? 30 : '', rhMax: t === 'Dry' ? 60 : '' }).name); };
    if (w.regime === 'Multi-temperature') temps.forEach(stz); else if (w.regime === 'Single-temperature') stz(w.type);
    w._made = made; return w; },
  done: (w, ed) => { const m = w._made || []; delete w._made; return ed ? `${w.name} saved.` : `${w.id} · ${w.name} created with receiving, dispatch, returns and quarantine areas${m.length ? ' and ' + m.join(', ') : ''}. Add storage areas and bins next.`; } };

PF.zone = { single: 'zone / room', plural: 'Zones / rooms', list: '#zones', name: z => z.name,
  load: id => { if (id) return { ...zoneBy(id) };
    const w = pf.wh || (whParentOpts()[0] || [])[0] || '', W = whRec(w), tp = W.regime === 'Single-temperature' ? W.defTemp : 'Frozen', pre = PRE_OF[tp] || 'UNS', r = WH_TEMP_RANGE[tp];
    return { wh: w, prefix: pre, code: nextPrefixCode(w, pre), name: '', type: 'Reserve storage', enclosure: ['Frozen', 'Chilled'].includes(tp) ? 'Enclosed room' : 'Open area', tempProfile: tp, tmin: r ? r[0] : '', tmax: r ? r[1] : '', humReq: 'Not specified', rhMin: '', rhMax: '', status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' }; },
  sections: (z, ed) => { const hasBins = ed && DB.bins.some(b => b.zoneId === z.id), hum = z.humReq === 'Defined limits'; return [
    { title: 'Parent Mapping', fields: [{ id: 'wh', label: 'Warehouse', type: 'select', req: 1, options: whParentOpts(), lock: hasBins, hint: hasBins ? 'This zone has bins, so it stays in its warehouse.' : '' }] },
    { title: 'Zone / room details', note: ed ? `<span class="mono">${esc(z.id)}</span>` : '', fields: [
      { id: 'prefix', label: 'Zone profile prefix', type: 'select', options: optA(ZPREFIX), hint: 'FRZ frozen · CH chilled · AMB ambient · DRY dry goods · MIX mixed · UNS unspecified.' },
      { id: 'code', label: 'Zone code', req: 1, mono: 1, ph: 'e.g. FRZ-01', hint: 'Enter the full code, such as FRZ-01. It must start with the prefix and a hyphen.' },
      { id: 'name', label: 'Zone name', req: 1, ph: 'e.g. Frozen Room 01' },
      { id: 'type', label: 'Primary function', type: 'select', options: optA(ZTYPES), hint: 'Putaway suggests bins only in Reserve storage and Forward picking zones.' },
      { id: 'enclosure', label: 'Physical enclosure', type: 'select', options: optA(ENCLOSURES) },
      { id: 'tempProfile', label: 'Temperature profile', type: 'select', options: optA(TPROFILES) },
      { id: 'tmin', label: 'Minimum temperature °C', type: 'number', step: 'any' }, { id: 'tmax', label: 'Maximum temperature °C', type: 'number', step: 'any' },
      { id: 'humReq', label: 'Humidity requirement', type: 'select', options: optA(['Not specified', 'Defined limits']) },
      { id: 'rhMin', label: 'Minimum relative humidity %', type: 'number', step: 'any', min: 0, lock: !hum }, { id: 'rhMax', label: 'Maximum relative humidity %', type: 'number', step: 'any', min: 0, lock: !hum }] },
    ctlSec()]; },
  update(fm, t) { const q = n => fm.querySelector(`[name="${n}"]`); if (!t) return;
    if (t.name === 'code') t.dataset.auto = '0';
    if ((t.name === 'prefix' || t.name === 'wh') && q('code').dataset.auto !== '0' && !pf.id) q('code').value = nextPrefixCode(q('wh').value, q('prefix').value);
    if (t.name === 'prefix' && !pf.id) { const tp = ZPREFIX_T[t.value]; q('tempProfile').value = tp; const r = WH_TEMP_RANGE[tp]; q('tmin').value = r ? r[0] : ''; q('tmax').value = r ? r[1] : ''; if (t.value === 'DRY') { q('humReq').value = 'Defined limits'; q('rhMin').disabled = q('rhMax').disabled = false; } if (['FRZ', 'CH'].includes(t.value)) q('enclosure').value = 'Enclosed room'; }
    if (t.name === 'tempProfile') { const r = WH_TEMP_RANGE[t.value]; q('tmin').value = r ? r[0] : ''; q('tmax').value = r ? r[1] : ''; }
    if (t.name === 'humReq') { const on = t.value === 'Defined limits'; q('rhMin').disabled = q('rhMax').disabled = !on; if (!on) { q('rhMin').value = ''; q('rhMax').value = ''; } } },
  save(d, id) {
    const old = id ? zoneBy(id) : null;
    if (!whRec(d.wh).id) throw new Error('Choose the warehouse.');
    d.name = (d.name || '').trim(); if (!d.name) throw new Error('Enter the zone name.');
    if (!ZTYPES.includes(d.type)) d.type = 'Reserve storage'; if (!ZPREFIX.includes(d.prefix)) d.prefix = old ? old.prefix : 'UNS';
    d.code = (d.code || '').trim().toUpperCase(); if (!d.code) d.code = nextPrefixCode(d.wh, d.prefix, id);
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(d.code)) throw new Error('The zone code uses up to 16 letters, digits or dashes.');
    const sysCode = Object.values(ZONE_ABBR).some(p => d.code.startsWith(p + '-'));
    if ((!old || old.code !== d.code) && !sysCode && !d.code.startsWith(d.prefix + '-')) throw new Error('The zone code must start with the selected prefix and a hyphen, e.g. ' + d.prefix + '-01.');
    if (DB.zones.some(z => z.wh === d.wh && z.id !== id && z.code === d.code)) throw new Error('Zone code ' + d.code + ' is already used in ' + whRec(d.wh).name + ' (inactive zones included).');
    if (DB.zones.some(z => z.wh === d.wh && z.id !== id && z.name.toLowerCase() === d.name.toLowerCase())) throw new Error('A zone called ' + d.name + ' already exists in ' + whRec(d.wh).name + '.');
    d.tmin = numOrBlank(d.tmin, 'Minimum temperature'); d.tmax = numOrBlank(d.tmax, 'Maximum temperature');
    if (d.tmin !== '' && d.tmax !== '' && d.tmin > d.tmax) throw new Error('The minimum temperature is higher than the maximum.');
    if (d.humReq !== 'Defined limits') { d.humReq = 'Not specified'; d.rhMin = ''; d.rhMax = ''; }
    else { d.rhMin = numOrBlank(d.rhMin, 'Minimum relative humidity', { min: 0, max: 100 }); d.rhMax = numOrBlank(d.rhMax, 'Maximum relative humidity', { min: 0, max: 100 }); if (d.rhMin === '' && d.rhMax === '') throw new Error('Enter the humidity limits, or set Humidity requirement to Not specified.'); if (d.rhMin !== '' && d.rhMax !== '' && d.rhMin > d.rhMax) throw new Error('The minimum humidity is higher than the maximum.'); }
    ctlCheck(d);
    if (old && old.wh !== d.wh && DB.bins.some(b => b.zoneId === id)) throw new Error('This zone has bins, so it stays in its warehouse.');
    if (old && d.status !== 'Active' && DB.bins.some(b => b.zoneId === id && binCount(b))) throw new Error('This zone holds stock, so it must stay Active. Use Block placement to stop new putaway.');
    const rec = { wh: d.wh, code: d.code, name: d.name, prefix: d.prefix, type: d.type, enclosure: d.enclosure, tempProfile: d.tempProfile, tmin: d.tmin, tmax: d.tmax, humReq: d.humReq, rhMin: d.rhMin, rhMax: d.rhMax, status: d.status, blockPlace: d.blockPlace, blockAlloc: d.blockAlloc, reason: d.reason };
    if (old) { Object.assign(old, rec); DB.areas.filter(a => a.zoneId === id && a.dflt).forEach(a => a.code = old.code + '-GEN');
      DB.bins.filter(b => b.zoneId === id && PUT_ROLES.includes(b.role)).forEach(b => b.temp = zoneTemp(old)); return old; }
    const z = { id: nidOf('ZN', DB.zones), ...rec }; DB.zones.push(z); return z; },
  done: (z, ed) => ed ? `${z.code} · ${z.name} saved.` : `${z.code} · ${z.name} added. Add storage areas next.` };

PF.area = { single: 'storage area', plural: 'Storage areas', list: '#areas', name: a => a.name,
  load: id => { if (id) return { ...areaById(id) };
    const z = (pf.zone && zoneBy(pf.zone).id && zoneBy(pf.zone)) || DB.zones.find(x => STORE_Z.includes(x.type) && x.status !== 'Inactive') || DB.zones[0] || {};
    const a = { wh: z.wh, zoneId: z.id, grouping: 'Rack area', aisle: '01', side: 'Left', binProfile: 'PALLET-RACK', status: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' };
    let n = 1; while (DB.areas.some(x => x.wh === a.wh && x.code === areaCode(z, String(n).padStart(2, '0'), a.side))) n++; a.aisle = String(n).padStart(2, '0');
    a.code = areaCode(z, a.aisle, a.side); a.name = areaName(z, a.grouping, a.aisle, a.side); return a; },
  sections: (a, ed) => { const hasBins = ed && DB.bins.some(b => b.areaId === a.id); return [
    { title: 'Parent Mapping', fields: [
      { id: 'wh', label: 'Warehouse', type: 'select', req: 1, options: whParentOpts(), lock: hasBins },
      { id: 'zoneId', label: 'Zone / Room', type: 'select', req: 1, options: zoneOptsP(a.wh), lock: hasBins, hint: hasBins ? 'This storage area has bins, so it stays in its zone.' : '' }] },
    { title: 'Storage area details', fields: [
      { id: 'grouping', label: 'Physical grouping', type: 'select', options: optA(GROUPINGS) },
      { id: 'aisle', label: 'Aisle number', mono: 1, ph: '01', lock: hasBins },
      { id: 'side', label: 'Side', type: 'select', options: optA(SIDES), lock: hasBins },
      { id: 'code', label: 'Storage area code', req: 1, mono: 1, lock: a.dflt, hint: 'Built from zone code, aisle and side, e.g. FRZ-01-A01-L. You can change it.' },
      { id: 'name', label: 'Storage area name', req: 1 },
      { id: 'binProfile', label: 'Default bin profile', type: 'select', options: bpOpts(), hint: 'New bins in this area start with this profile.' }] },
    ctlSec()]; },
  update(fm, t) { const q = n => fm.querySelector(`[name="${n}"]`); if (!t) return;
    if (t.name === 'code' || t.name === 'name') t.dataset.auto = '0';
    if (t.name === 'wh') q('zoneId').innerHTML = opt(zoneOptsP(t.value), '');
    if (t.name === 'aisle') t.dataset.auto = '0';
    if (['wh', 'zoneId', 'side'].includes(t.name) && !pf.id && q('aisle').dataset.auto !== '0') { const z = zoneBy(q('zoneId').value); let n = 1; while (DB.areas.some(x => x.wh === z.wh && x.code === areaCode(z, String(n).padStart(2, '0'), q('side').value))) n++; q('aisle').value = String(n).padStart(2, '0'); }
    if (['wh', 'zoneId', 'aisle', 'side', 'grouping'].includes(t.name) && !pf.id) { const z = zoneBy(q('zoneId').value);
      if (q('code').dataset.auto !== '0') q('code').value = areaCode(z, q('aisle').value, q('side').value);
      if (q('name').dataset.auto !== '0') q('name').value = areaName(z, q('grouping').value, q('aisle').value, q('side').value); } },
  save(d, id) {
    const old = id ? areaById(id) : null;
    const z = zoneBy(d.zoneId); if (!z.id) throw new Error('Choose the zone / room. Create one first if the warehouse has none.');
    if (z.wh !== d.wh) throw new Error('That zone / room is not in the chosen warehouse.');
    if (!GROUPINGS.includes(d.grouping)) d.grouping = 'Rack area'; if (!SIDES.includes(d.side)) d.side = 'None'; if (!BIN_PROFILES.includes(d.binProfile)) d.binProfile = 'PALLET-RACK';
    d.aisle = String(d.aisle || '').trim(); if (!/^\d{1,3}$/.test(d.aisle)) throw new Error('The aisle number uses digits, e.g. 01.'); d.aisle = d.aisle.padStart(2, '0');
    d.code = (d.code || areaCode(z, d.aisle, d.side)).trim().toUpperCase(); if (!/^[A-Z0-9][A-Z0-9-]{0,23}$/.test(d.code)) throw new Error('The storage area code uses up to 24 letters, digits or dashes.');
    if (DB.areas.some(a => a.wh === d.wh && a.id !== id && a.code === d.code)) throw new Error('Storage area code ' + d.code + ' is already used in ' + whRec(d.wh).name + ' (inactive areas included).');
    d.name = (d.name || '').trim(); if (!d.name) throw new Error('Enter the storage area name.');
    ctlCheck(d);
    if (old && old.zoneId !== d.zoneId && DB.bins.some(b => b.areaId === id)) throw new Error('This storage area has bins, so it stays in its zone.');
    if (old && d.status !== 'Active' && DB.bins.some(b => b.areaId === id && binCount(b))) throw new Error('This storage area holds stock, so it must stay Active. Use Block placement to stop new putaway.');
    const rec = { wh: d.wh, zoneId: d.zoneId, grouping: d.grouping, aisle: d.aisle, side: d.side, code: d.code, name: d.name, binProfile: d.binProfile, status: d.status, blockPlace: d.blockPlace, blockAlloc: d.blockAlloc, reason: d.reason };
    if (old) { Object.assign(old, rec); DB.bins.filter(b => b.areaId === id).forEach(b => { b.aisle = old.aisle; }); return old; }
    const a = { id: nidOf('SA', DB.areas), ...rec }; DB.areas.push(a); return a; },
  done: (a, ed) => ed ? `${a.code} saved.` : `${a.code} · ${a.name} added. Add bins next.` };

PF.bin = { single: 'bin / slot / pick face', plural: 'Bins / slots', list: '#bins', name: b => 'Bin ' + b.code,
  load: k => { if (k) { const b = binByKey(k); return { ...b, aisle: areaOf(b).aisle || b.aisle || '', side: areaOf(b).side || '' }; }
    let a = (pf.area && areaById(pf.area).id && areaById(pf.area)) || DB.areas.find(x => !x.dflt && STORE_Z.includes(zoneBy(x.zoneId).type) && x.status !== 'Inactive') || DB.areas[0] || {};
    const z = zoneBy(a.zoneId), b = { wh: a.wh || z.wh, zoneId: z.id, areaId: a.id, aisle: a.aisle || '', side: a.side || '', rack: 'A', level: '01', position: '01', binProfile: a.binProfile || 'PALLET-RACK', cap: 1, maxKg: '', maxVol: '', clearH: '', role: roleForZone(z.type), life: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' };
    outer: for (const r of RACKS) for (const l of LEVELS) for (const p of POSNS) if (!binRec(b.wh, binCodeOf(z, a, r, l, p))) { b.rack = r; b.level = l; b.position = p; break outer; }
    b.code = binCodeOf(z, a, b.rack, b.level, b.position); b.name = binNameOf(z, a, b.rack, b.level, b.position); b.barcode = (b.wh || 'WH') + ':' + b.code; return b; },
  sections: (b, ed) => { const full = ed && binCount(b) > 0, sys = ed && SYS_BINS.includes(b.code); return [
    { title: 'Parent Mapping', fields: [
      { id: 'wh', label: 'Warehouse', type: 'select', req: 1, options: whParentOpts(), lock: ed },
      { id: 'zoneId', label: 'Zone / Room', type: 'select', req: 1, options: zoneOptsP(b.wh), lock: full || sys },
      { id: 'areaId', label: 'Storage Area', type: 'select', req: 1, options: areaOptsP(b.zoneId), lock: full || sys, hint: full ? 'This bin holds stock, so it stays where it is.' : '' }] },
    { title: 'Bin / slot / pick face details', fields: [
      { id: 'aisle', label: 'Aisle', mono: 1, lock: 1, hint: 'From the storage area.' }, { id: 'side', label: 'Side', lock: 1, hint: 'From the storage area.' },
      { id: 'rack', label: 'Rack', type: 'select', options: optA(RACKS), lock: ed }, { id: 'level', label: 'Level', type: 'select', options: optA(LEVELS), lock: ed },
      { id: 'position', label: 'Position', type: 'select', options: optA(POSNS), lock: ed },
      { id: 'code', label: 'Bin code', req: 1, mono: 1, lock: 1, hint: ed ? 'Fixed once the bin exists.' : 'Built from zone, aisle, side, rack, level and position.' },
      { id: 'name', label: 'Bin name', req: 1 },
      { id: 'barcode', label: 'Barcode', mono: 1, lock: 1, hint: 'Warehouse code and bin code. Printed on the label.' },
      { id: 'binProfile', label: 'Bin profile', type: 'select', options: bpOpts() },
      { id: 'cap', label: 'Pallet positions', type: 'number', min: 1, req: 1 },
      { id: 'maxKg', label: 'Maximum weight kg', type: 'number', min: 0, step: 'any' }, { id: 'maxVol', label: 'Maximum volume m³', type: 'number', min: 0, step: 'any' },
      { id: 'clearH', label: 'Clear height cm', type: 'number', min: 0, step: 'any' },
      { id: 'role', label: 'Operational role', type: 'select', options: optA(BIN_ROLES), lock: sys, hint: 'Putaway suggests Reserve storage and Pick face bins only.' }] },
    { title: 'Status & operational controls', fields: [
      { id: 'life', label: 'Lifecycle status', type: 'select', options: optA(LIFE), lock: sys },
      { id: 'blockPlace', label: 'Block placement', type: 'select', options: YN }, { id: 'blockAlloc', label: 'Block new allocation', type: 'select', options: YN },
      { id: 'reason', label: 'Restriction / change reason', ph: 'Required when a block is set' }] }]; },
  update(fm, t) { const q = n => fm.querySelector(`[name="${n}"]`); if (!t) return;
    if (t.name === 'name') t.dataset.auto = '0';
    if (t.name === 'wh') q('zoneId').innerHTML = opt(zoneOptsP(t.value), '');
    if (t.name === 'wh' || t.name === 'zoneId') q('areaId').innerHTML = opt(areaOptsP(q('zoneId').value), '');
    if (['wh', 'zoneId', 'areaId', 'rack', 'level', 'position'].includes(t.name)) {
      const z = zoneBy(q('zoneId').value), a = areaById(q('areaId').value);
      q('aisle').value = a.aisle || ''; q('side').value = a.side || '';
      if (['areaId', 'zoneId', 'wh'].includes(t.name) && a.binProfile) q('binProfile').value = a.binProfile;
      if (['zoneId', 'wh'].includes(t.name) && z.id) q('role').value = roleForZone(z.type);
      if (!pf.id) { const c = binCodeOf(z, a, q('rack').value, q('level').value, q('position').value); q('code').value = c; q('barcode').value = q('wh').value + ':' + c; if (q('name').dataset.auto !== '0') q('name').value = binNameOf(z, a, q('rack').value, q('level').value, q('position').value); } } },
  save(d, key) {
    const prev = key ? binByKey(key) : null; if (key && !prev) throw new Error('Bin not found.');
    const z = zoneBy(d.zoneId); if (!z.id) throw new Error('Choose the zone / room.');
    if (z.wh !== d.wh) throw new Error('That zone / room is not in the chosen warehouse.');
    const a = areaById(d.areaId); if (!a.id) throw new Error('Choose the storage area. Create one first under Storage areas.');
    if (a.zoneId !== z.id) throw new Error('That storage area is not in the chosen zone / room.');
    if (!RACKS.includes(d.rack)) d.rack = prev ? prev.rack : 'A'; if (!LEVELS.includes(d.level)) d.level = prev ? prev.level : '01'; if (!POSNS.includes(d.position)) d.position = prev ? prev.position : '01';
    const code = prev ? prev.code : binCodeOf(z, a, d.rack, d.level, d.position);
    if (!prev && binRec(d.wh, code)) throw new Error('Bin ' + code + ' already exists in ' + whRec(d.wh).name + '. Choose another rack, level or position.');
    d.name = (d.name || '').trim(); if (!d.name) throw new Error('Enter the bin name.');
    if (!BIN_PROFILES.includes(d.binProfile)) d.binProfile = a.binProfile || 'PALLET-RACK';
    d.cap = +d.cap; if (!(d.cap >= 1)) throw new Error('Pallet positions must be at least 1.');
    if (prev && d.cap < binCount(prev) && prev.cap < 99) throw new Error('Bin ' + prev.code + ' holds ' + binCount(prev) + ' pallets, so it needs at least that many positions.');
    d.maxKg = numOrBlank(d.maxKg, 'Maximum weight', { min: 0 }); d.maxVol = numOrBlank(d.maxVol, 'Maximum volume', { min: 0 }); d.clearH = numOrBlank(d.clearH, 'Clear height', { min: 0 });
    if (!BIN_ROLES.includes(d.role)) d.role = prev ? prev.role : 'Reserve storage';
    d.status = d.life; ctlCheck(d); d.life = d.status;
    if (prev && binCount(prev) && (prev.zoneId !== z.id || prev.areaId !== a.id)) throw new Error('This bin holds stock, so it stays in its zone and storage area.');
    if (prev && d.life !== 'Active' && binCount(prev)) throw new Error('Bin ' + prev.code + ' holds stock, so it must stay Active. Use Block placement to stop new putaway.');
    const temp = PUT_ROLES.includes(d.role) ? zoneTemp(z) : 'Any';
    const rec = { code, zoneId: z.id, areaId: a.id, aisle: a.aisle, rack: d.rack, level: d.level, position: d.position, name: d.name, barcode: d.wh + ':' + code, binProfile: d.binProfile, cap: d.cap, maxKg: d.maxKg, maxVol: d.maxVol, clearH: d.clearH, role: d.role, temp, life: d.life, blockPlace: d.blockPlace, blockAlloc: d.blockAlloc, reason: d.reason };
    if (prev) { if (SYS_BINS.includes(prev.code)) { rec.role = prev.role; rec.life = 'Active'; rec.temp = prev.temp; rec.rack = prev.rack; rec.level = prev.level; rec.position = prev.position; } if (prev.barcode) rec.barcode = prev.barcode; Object.assign(prev, rec); return binDerive(prev); }
    const b = { wh: d.wh, client: '', pallets: 0, ...rec }; DB.bins.push(b); return binDerive(b); },
  done: (b, ed) => ed ? `Bin ${b.code} saved.` : `Bin ${b.code} added to ${areaOf(b).code || ''}.` };

const genAreas = () => DB.areas.filter(a => STORE_Z.includes(zoneBy(a.zoneId).type) && a.status !== 'Inactive');
const genPlan = d => { const a = areaById(d.areaId), z = zoneBy(a.zoneId); if (!a.id || !z.id) return { err: 'Choose a storage area.', codes: [] };
  const r1 = RACKS.indexOf(d.rackFrom), r2 = RACKS.indexOf(d.rackTo), lv = +d.levels, ps = +d.positions;
  if (r2 < r1) return { err: '"To rack" must come after "From rack".', codes: [] };
  if (!(lv >= 1 && lv <= LEVELS.length)) return { err: 'Levels per rack must be 1 to ' + LEVELS.length + '.', codes: [] };
  if (!(ps >= 1 && ps <= POSNS.length)) return { err: 'Positions per level must be 1 to ' + POSNS.length + '.', codes: [] };
  const codes = []; for (let r = r1; r <= r2; r++) for (let l = 0; l < lv; l++) for (let p = 0; p < ps; p++) codes.push({ rk: RACKS[r], le: LEVELS[l], po: POSNS[p], code: binCodeOf(z, a, RACKS[r], LEVELS[l], POSNS[p]) });
  const exist = codes.filter(c => binRec(z.wh, c.code)).length;
  return { a, z, codes, exist, err: codes.length > 300 ? 'That is more than 300 bins. Generate them in smaller batches.' : '' }; };
const genPreview = d => { const p = genPlan(d); if (p.err && !p.codes.length) return `<p class="note" style="margin:0">${esc(p.err)}</p>`;
  const nw = p.codes.length - p.exist, cap = nw * (+d.cap || 0);
  return `<div class="gen-pv"><div class="gen-tiles">${[[p.codes.length, 'bins', 'In this range'], [nw, 'new', 'Will be created'], [p.exist, 'skip', 'Already exist'], [cap, 'pallets', 'Added capacity']].map(([n, u, l]) => `<div><b>${n0(n)}</b> <span class="note">${u}</span><span>${l}</span></div>`).join('')}</div>
    ${p.err ? `<p class="err" style="margin:10px 0 0">${esc(p.err)}</p>` : ''}
    <div class="gen-codes"><span class="note">First bin</span><b class="mono">${esc(p.codes[0].code)}</b><span class="note">Last bin</span><b class="mono">${esc(p.codes[p.codes.length - 1].code)}</b><span class="note">Barcode example</span><b class="mono">${esc(p.z.wh + ':' + p.codes[0].code)}</b></div>
    <div class="gen-chips">${p.codes.slice(0, 24).map(c => `<span class="mf-chip mono ${binRec(p.z.wh, c.code) ? 'gen-old' : ''}">${esc(c.code)}</span>`).join('')}${p.codes.length > 24 ? `<span class="note">+ ${n0(p.codes.length - 24)} more</span>` : ''}</div></div>`; };
PF.gen = { single: 'bins', plural: 'Bins / slots', list: '#bins', action: 'Generate bins', name: () => 'Generate bins',
  load: () => { const as = genAreas(); let a = (pf.area && areaById(pf.area).id && areaById(pf.area)) || as.find(x => !x.dflt) || as[0] || {}; const z = zoneBy(a.zoneId);
    return { wh: a.wh || '', zoneId: z.id || '', areaId: a.id || '', rackFrom: 'A', rackTo: 'B', levels: 2, positions: 4, cap: 1, binProfile: a.binProfile || 'PALLET-RACK', role: z.type === 'Forward picking' ? 'Pick face' : 'Reserve storage' }; },
  sections: g => { const wl = [...new Set(genAreas().map(a => a.wh))]; return [
    { title: 'Parent Mapping', sub: 'Bins are created inside one storage area. Only storage areas in Reserve storage and Forward picking zones are listed.', fields: [
      { id: 'wh', label: 'Warehouse', type: 'select', req: 1, options: whParentOpts().filter(o => wl.includes(o[0])) },
      { id: 'zoneId', label: 'Zone / Room', type: 'select', req: 1, options: zoneOptsP(g.wh).filter(o => genAreas().some(a => a.zoneId === o[0])) },
      { id: 'areaId', label: 'Storage Area', type: 'select', req: 1, options: genAreas().filter(a => a.zoneId === g.zoneId).map(a => [a.id, a.code + ' · ' + a.name]) }] },
    { title: 'Bin layout', sub: 'Bins are numbered rack → level → position, the same way as the bin form.', fields: [
      { id: 'rackFrom', label: 'From rack', type: 'select', options: optA(RACKS) }, { id: 'rackTo', label: 'To rack', type: 'select', options: optA(RACKS) },
      { id: 'levels', label: 'Levels per rack', type: 'number', min: 1, req: 1, hint: '1 to ' + LEVELS.length + '.' }, { id: 'positions', label: 'Positions per level', type: 'number', min: 1, req: 1, hint: '1 to ' + POSNS.length + '.' },
      { id: 'cap', label: 'Pallet positions per bin', type: 'number', min: 1, req: 1 }, { id: 'binProfile', label: 'Bin profile', type: 'select', options: bpOpts() },
      { id: 'role', label: 'Operational role', type: 'select', options: optA(PUT_ROLES), hint: 'Putaway suggests these bins.' }] },
    { title: 'Preview', fields: [{ type: 'html', html: `<div id="genPv">${genPreview(g)}</div>` }] }]; },
  update(fm, t) { const q = n => fm.querySelector(`[name="${n}"]`); if (!t) return;
    const zO = w => zoneOptsP(w).filter(o => genAreas().some(a => a.zoneId === o[0])), aO = z => genAreas().filter(a => a.zoneId === z).map(a => [a.id, a.code + ' · ' + a.name]);
    if (t.name === 'wh') q('zoneId').innerHTML = opt(zO(t.value), '');
    if (t.name === 'wh' || t.name === 'zoneId') q('areaId').innerHTML = opt(aO(q('zoneId').value), '');
    if (['wh', 'zoneId', 'areaId'].includes(t.name)) { const a = areaById(q('areaId').value), z = zoneBy(a.zoneId); if (a.binProfile) q('binProfile').value = a.binProfile; q('role').value = z.type === 'Forward picking' ? 'Pick face' : 'Reserve storage'; }
    const d = {}; ['areaId', 'rackFrom', 'rackTo', 'levels', 'positions', 'cap'].forEach(k => d[k] = q(k).value); $('#genPv').innerHTML = genPreview(d); },
  save(d) { const p = genPlan(d); if (p.err) throw new Error(p.err);
    if (!(+d.cap >= 1)) throw new Error('Pallet positions per bin must be at least 1.');
    if (p.a.blockPlace === 'Yes' || p.a.status !== 'Active') throw new Error('Storage area ' + p.a.code + ' is ' + (p.a.status !== 'Active' ? p.a.status.toLowerCase() : 'blocked for placement') + '. Change it before adding bins.');
    let made = 0; p.codes.forEach(c => { if (binRec(p.z.wh, c.code)) return; PF.bin.save({ wh: p.z.wh, zoneId: p.z.id, areaId: p.a.id, rack: c.rk, level: c.le, position: c.po, name: binNameOf(p.z, p.a, c.rk, c.le, c.po), binProfile: BIN_PROFILES.includes(d.binProfile) ? d.binProfile : p.a.binProfile, cap: d.cap, maxKg: '', maxVol: '', clearH: '', role: PUT_ROLES.includes(d.role) ? d.role : 'Reserve storage', life: 'Active', blockPlace: 'No', blockAlloc: 'No', reason: '' }, null); made++; });
    if (!made) throw new Error('All of those bins already exist.');
    return { made, skip: p.exist, code: p.a.code }; },
  done: r => `${r.made} bins created in ${r.code}${r.skip ? `, ${r.skip} already existed` : ''}.` };

const pfField = (f, val) => {
  const id = 'pf_' + f.id, dis = f.lock ? ' disabled' : '', full = f.full ? ' full' : '', req = f.req ? '<span class="req"> *</span>' : '', hint = f.hint ? `<small class="hint">${f.hint}</small>` : '';
  if (f.type === 'html') return `<div class="full">${f.html}</div>`;
  if (f.type === 'select') return `<label class="field${full}" for="${id}"><span class="flbl">${f.label}${req}</span><select id="${id}" name="${f.id}"${dis}>${opt(f.options.map(([k, l]) => [String(k), l]), String(val ?? ''))}</select>${hint}</label>`;
  if (f.type === 'checks') return `<div class="field full"${f.wrap ? ` id="${f.wrap}"` : ''}${f.hidden ? ' hidden' : ''}><span class="flbl">${f.label}</span><div class="row" style="gap:4px 18px">${f.options.map(([v, t]) => `<label class="chk"><input type="checkbox" name="${f.id}" data-multi="1" value="${esc(v)}" ${(val || []).includes(v) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div>${hint}</div>`;
  return `<label class="field${full}" for="${id}"><span class="flbl">${f.label}${req}</span><input id="${id}" name="${f.id}" type="${f.type || 'text'}" value="${esc(val ?? '')}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${f.step ? ` step="${f.step}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.list ? ` list="${f.list}"` : ''}${f.mono ? ' class="mono"' : ''} autocomplete="off"${dis}>${hint}</label>`;
};
function pfPage(kind, id, ctx = {}) {
  pf = { kind, id: id || null, ...ctx };
  const def = PF[kind], ed = !!pf.id, rec = def.load(pf.id);
  if (kind === 'gen' && !genAreas().length) return head2('Warehouse Setup / Bins / slots', 'Generate bins', `<a class="btn" href="#areas/new">+ New storage area</a>`) + '<div class="card empty">Create a storage area in a Reserve storage or Forward picking zone first.</div>';
  if (kind === 'bin' && !ed && !DB.areas.length) return head2('Warehouse Setup / Bins / slots', 'New bin', `<a class="btn" href="#areas/new">+ New storage area</a>`) + '<div class="card empty">Create a storage area first.</div>';
  const del = ed ? `<button class="btn danger" type="button" data-do="whDel" data-id="${esc({ warehouse: 'warehouses', zone: 'zones', area: 'areas', bin: 'bins' }[kind] + '|' + pf.id)}">Delete</button>` : '';
  const btns = `<a class="btn" href="${def.list}">Cancel</a>${del}${ed || def.action ? '' : '<button class="btn" type="button" data-do="pfSave" data-id="new">Save &amp; new</button>'}<button class="btn pri" type="button" data-do="pfSave" data-id="">${def.action || (ed ? 'Save changes' : 'Save')}</button>`;
  setTimeout(() => { const fm = $('#pgForm'); if (fm) fm.querySelectorAll('input[name="code"],input[name="name"]').forEach(i => i.dataset.auto = ed ? '0' : '1'); }, 0);
  return `${head2(`Warehouse Setup / <a href="${def.list}" style="color:inherit">${def.plural}</a> / ${def.action ? def.name(rec) : ed ? 'Edit' : 'New'}`, ed || def.action ? esc(def.name(rec)) : 'New ' + def.single, btns)}
  <form id="pgForm" novalidate onsubmit="return false" style="display:flex;flex-direction:column;gap:14px"><div class="err" id="pfErr" role="alert"></div>
  ${def.sections(rec, ed).map(s => `<section class="card"><div class="card-h"><div><h2>${s.title}</h2>${s.sub ? `<p class="note">${s.sub}</p>` : ''}</div>${s.note ? `<span class="note">${s.note}</span>` : ''}</div><div class="card-b fgrid f2">${s.fields.map(f => pfField(f, rec[f.id])).join('')}</div></section>`).join('')}
  <div class="form-foot">${btns}</div></form>${def.extra ? def.extra() : ''}`;
}
function readPF() {
  const fm = $('#pgForm'), out = {};
  fm.querySelectorAll('[name]').forEach(el => { if (el.dataset.multi) { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); return; } out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  return out;
}

/* ---- actions ---- */
Object.assign(DO, {
  pfSave(mode) {
    const def = PF[pf.kind], ed = !!pf.id;
    try { const rec = def.save(readPF(), pf.id); persist(); toast(def.done(rec, ed));
      if (mode === 'new') { route(); window.scrollTo(0, 0); } else go(def.list); }
    catch (e) { formErr('#pfErr', e); }
  },
  whDel(v) {
    const [kind, key] = String(v).split(/\|(.*)/s), block = m => toast(m);
    Object.values(FILT).forEach(f => Object.keys(f).forEach(k => { if (f[k] === key) delete f[k]; }));
    if (kind === 'warehouses') { const w = whRec(key);
      if (palletsOf(key)) return block(w.name + ' holds ' + palletsOf(key) + ' pallets and cannot be deleted. Set it to Inactive once it is empty.');
      if (DB.asns.some(a => a.wh === key) || DB.orders.some(o => o.wh === key) || DB.stock.some(s => s.wh === key)) return block(w.name + ' has stock or transactions and cannot be deleted. Set it to Inactive instead.');
      if (!confirm(`Delete ${w.name}? Its ${DB.zones.filter(z => z.wh === key).length} zones, ${DB.areas.filter(a => a.wh === key).length} storage areas and ${DB.bins.filter(b => b.wh === key).length} bins are deleted too.`)) return;
      DB.warehouses = DB.warehouses.filter(x => x.id !== key); DB.zones = DB.zones.filter(x => x.wh !== key); DB.areas = DB.areas.filter(x => x.wh !== key); DB.bins = DB.bins.filter(x => x.wh !== key);
      persist(); toast(w.name + ' deleted.'); return go('#warehouses'); }
    if (kind === 'zones') { const z = zoneBy(key), bs = DB.bins.filter(b => b.zoneId === key);
      if (bs.some(binCount)) return block(z.code + ' holds stock and cannot be deleted. Use Block placement or set it to Inactive once it is empty.');
      if (bs.some(b => SYS_BINS.includes(b.code))) return block(z.code + ' holds a working bin used by receiving, dispatch, returns or quarantine, so it cannot be deleted.');
      if (!confirm(`Delete zone ${z.code} · ${z.name}? Its ${DB.areas.filter(a => a.zoneId === key).length} storage areas and ${bs.length} bins are deleted too.`)) return;
      DB.zones = DB.zones.filter(x => x.id !== key); DB.areas = DB.areas.filter(x => x.zoneId !== key); DB.bins = DB.bins.filter(x => x.zoneId !== key);
      persist(); toast('Zone ' + z.code + ' deleted.'); return go('#zones'); }
    if (kind === 'areas') { const a = areaById(key), bs = DB.bins.filter(b => b.areaId === key);
      if (bs.some(binCount)) return block(a.code + ' holds stock and cannot be deleted.');
      if (bs.some(b => SYS_BINS.includes(b.code))) return block(a.code + ' holds a working bin, so it cannot be deleted.');
      if (!confirm(`Delete storage area ${a.code}? Its ${bs.length} bins are deleted too.`)) return;
      DB.areas = DB.areas.filter(x => x.id !== key); DB.bins = DB.bins.filter(x => x.areaId !== key);
      persist(); toast('Storage area ' + a.code + ' deleted.'); return go('#areas'); }
    if (kind === 'bins') { const b = binByKey(key); if (!b) return;
      if (binCount(b)) return block('Bin ' + b.code + ' holds ' + binCount(b) + ' pallets and cannot be deleted.');
      if (SYS_BINS.includes(b.code)) return block(b.code + ' is a working bin used by receiving, dispatch, returns or quarantine, so it cannot be deleted.');
      if (!confirm('Delete bin ' + b.code + '?')) return;
      DB.bins = DB.bins.filter(x => x !== b); persist(); toast('Bin ' + b.code + ' deleted.'); return go('#bins'); }
  }
});
document.addEventListener('input', e => { if (e.target.closest('#pgForm') && PF[pf.kind].update && !e.target.matches('select')) PF[pf.kind].update($('#pgForm'), e.target); });
document.addEventListener('change', e => { if (e.target.closest('#pgForm') && PF[pf.kind].update) PF[pf.kind].update($('#pgForm'), e.target); });
