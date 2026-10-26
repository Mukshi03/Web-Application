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

All pages follow the lanewms ERP: same fields, required marks, item-line tables, step bar and validation rules.
Submitted ASNs and approved orders are added to the dashboard (work queue and recent orders).

## Data

- Dashboard figures and master data (customers, warehouses, items, stock) are in the `DATA` object at the top of the `<script>` in `index.html`.
- Customers, quotations, contracts, ASNs and orders are kept in the browser (`localStorage`, key `graylane.web.v2`; sample records are loaded the first time) until a backend exists — replace `persist()` / `store()` with API calls then.
