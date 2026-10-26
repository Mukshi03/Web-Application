# Gray Lane — Web App

Single self-contained HTML file — no build step.

## Run it

- **Online:** https://mukshi03.github.io/Web-Application/
- **Locally:** open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000

## Pages

| Address | Page |
|---|---|
| `#dashboard` | Operations Dashboard |
| `#asn-new` | New ASN (Inbound booking / ASN) |
| `#order-new` | New Outbound Order |
| `#customers` · `#customers/new` · `#customers/edit/CL-001` | Customers list and customer form |
| `#quotes` · `#quotes/new` · `#quotes/edit/QT-JED-00001` | Service quotations list and form |
| `#contracts` · `#contracts/new` · `#contracts/edit/CTR-00001` | Contracts list and form |
| `#items` · `#items/new` · `#items/edit/RSF-RICE-5K` | Customer items (SKUs) list and item form |
| `#materials` · `#materials/new` · `#materials/edit/MAT-001` | VAS materials list and form |
| `#groups` · `#categories` · `#uom` (add `/new` to open the form) | Item groups, categories, units of measure |
| `#warehouses` · `#zones` · `#areas` · `#bins` (add `/new` or `/edit/ID`) | Warehouse Setup: warehouses, zones / rooms, storage areas, bins / slots |
| `#bins/generate` | Generate bins in bulk with a preview |
| `#inbound` | Inbound dashboard |
| `#asn` · `#asn/new` · `#asn/edit/ASN-101` | ASN register and ASN record (draft → submit → approve) |
| `#receiving` · `#grn` · `#putaway` · `#ibinv` (add `/edit/ASN-101`) | Receiving, GRN, put-away and inbound inventory for an ASN |
| `#outbound` | Outbound dashboard |
| `#oborders` · `#oborders/new` · `#oborders/edit/OB-JED-00061` | Outbound order register and order record |
| `#alloc` · `#pick` · `#loading` · `#dispatch` (add `/edit/OB-JED-00061`) | Allocate stock, pick & confirm, load, confirm dispatch for an order |
| `#obhistory` | Outbound exceptions & activity history |
| `#stock` · `#bycust` · `#expiry` · `#holds` | Stock (LPN list, adjust / hold / move), stock by customer, batch & expiry, holds & quarantine |
| `#moves[/new]` · `#transfers[/new]` | Bin moves inside a warehouse; warehouse transfers (draft → ship → receive → put-away) |
| `#counts[/new]` · `#adjust[/new]` · `#damage[/new]` | Cycle and full stock counts (freezes the warehouse), adjustments with approval, damage & loss register |
| `#ledger` · `#ageing` · `#statement` | Stock ledger, stock ageing by customer, customer stock statement (opening → closing) |
| `#returns` · `#rma/new` | Returns (RMA) dashboard and new RMA request |
| `#rmareq` · `#rmarecv` · `#rmaclose` | RMA Request, Receive & Inspect, Reconcile & Close queues |
| `#rma/s1/RMA-JED-00001` (`s2`, `s3`) | One return at step 1, 2 or 3 |
| `#vas` · `#vasreq` · `#vaswo` · `#vasdone` | VAS dashboard, requests, work orders, completion & verification |
| `#vasreq/new` · `#vasreq/edit/VAS-JED-00001` · `#vasw/VAS-JED-00001` | New / draft VAS request, and one work order |
| `#svc` · `#svc/new` · `#svc/view/STR-001` · `#svc/edit/STR-001` | Billing Engine service items |
| `#ratecard` · `#custrates` | Standard rate card, customer contract rates |
| `#charges` · `#charges/new` · `#storage` | Charges register, manual charge, storage capture |
| `#billrun` · `#billrun/new` · `#billrun/view/ID` | Billing runs: run → review & approve → send |
| `#bdrafts` · `#bdrafts/view/ID` · `#billexc` | Draft invoices and billing exceptions |
| `#reports` · `#reports/fav` | Report dashboard (key figures, every report by category, search, favourites) |
| `#rep-biz` · `#rep-cust` · `#rep-inv` · `#rep-wh` · `#rep-bill` · `#rep-audit` | Report categories |
| `#rep/KEY` (e.g. `#rep/monthly`, `#rep/cpt`, `#rep/audit`) | One report, with CSV export and print |
| `#settings` | Settings home (organization, users & roles, taxes, setup, customization, automation, module settings) |
| `#settings/KEY` (e.g. `profile`, `users`, `roles`, `data`, `m_inbound`) · `#settings/role/ID` | One settings page; Data & backup has backup, restore and reset |

All pages follow the lanewms ERP: same fields, required marks, item-line tables, step bar and validation rules.
Submitted ASNs and approved orders are added to the dashboard (work queue and recent orders).

## Data

- Dashboard figures and master data (customers, warehouses, items, stock) are in the `DATA` object at the top of the `<script>` in `index.html`.
- Customers, quotations, contracts, items, materials, groups, categories, units, warehouses, zones, storage areas, bins, ASNs and orders are kept in the browser (`localStorage`, key `graylane.web.v2`; sample records are loaded the first time) until a backend exists — replace `persist()` / `store()` with API calls then.

## Project structure

Each section of the app is its own file. `index.html` loads them in this order:

| File | Section |
|---|---|
| `index.html` | Page shell (sidebar, top bar), loads the stylesheet and scripts |
| `css/styles.css` | All styles (light and dark mode) |
| `js/core.js` | Sample data, storage, shared helpers, dashboard, new ASN / order forms, sidebar |
| `js/customers.js` | Customers & Commercial: customers, service quotations, contracts, pop-up forms |
| `js/items.js` | Items / SKU Master: items, VAS materials, groups, categories, units of measure |
| `js/warehouse.js` | Warehouse Setup: warehouses, zones, storage areas, bins |
| `js/inbound.js` | Inbound: ASN, receiving, GRN, put-away, inbound inventory |
| `js/outbound.js` | Outbound: orders, allocation, pick, load, dispatch, history |
| `js/inventory.js` | Inventory: stock, holds, moves, transfers, counts, adjustments, damage, ledger, ageing, statement |
| `js/returns.js` | Returns (RMA) |
| `js/vas.js` | Value-Added Services |
| `js/billing.js` | Billing Engine |
| `js/reports.js` | Reports & Analytics |
| `js/settings.js` | Settings |
| `js/app.js` | Router and start-up (must load last) |

The scripts are plain `<script>` files that share one global scope, so keep the load order when adding a file.
