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

All pages follow the lanewms ERP: same fields, required marks, item-line tables, step bar and validation rules.
Submitted ASNs and approved orders are added to the dashboard (work queue and recent orders).

## Data

- Dashboard figures and master data (customers, warehouses, items, stock) are in the `DATA` object at the top of the `<script>` in `index.html`.
- Customers, quotations, contracts, items, materials, groups, categories, units, warehouses, zones, storage areas, bins, ASNs and orders are kept in the browser (`localStorage`, key `graylane.web.v2`; sample records are loaded the first time) until a backend exists — replace `persist()` / `store()` with API calls then.
