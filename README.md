# Ticket Business Hub

Your private home base: sales stats, inventory, Discord sales sync, and your sites with encrypted logins.

## How it fits together (plain language)
- **Website** (`site/`): plain HTML/CSS/JS pages, published automatically to GitHub Pages every time code changes on `main`. They contain **no secrets**.
- **Supabase** (project `ticket-business-hub`): handles your login, stores all data, and does the encryption.
  - Only `dan5503@gmail.com` can create an account; all other sign-ups are blocked by the database.
  - Every table uses row-level security, so you only ever see your own rows.
  - Saved site passwords are encrypted with AES-256. The key lives in Supabase Vault, never in code or the browser.
  - The Chrome extension uses a **sync key** that you create in the hub (Discord Sales page). Only a scrambled fingerprint of the key is stored. A sync key can only *add* sales; it can't read anything. You can revoke one at any time.
- **Database setup**: `supabase/migrations/` (already applied to your project).

## Pages
| Page | What it does |
|---|---|
| Sales Dashboard | Total profit "tag" (hidden until you tap 👁), revenue/cost/ROI, monthly chart, top/bottom artists and venues, insights, ROI by month/year/account, full sales table with filters and CSV export |
| Inventory | Upload your orders sheet as a CSV (each upload replaces the previous one). Columns are matched automatically and you can fix any match before importing |
| Discord Sales | Sync status ("42 new sales added"), sync keys for the extension, paste-in backup, latest sales |
| My Sites | Link cards with optional encrypted username/password (Reveal / Copy, auto-hides after 20 s) |

## For the extension (developer notes)
Send sales with a POST to `https://jhbhkjomjjbldlofuigt.supabase.co/rest/v1/rpc/ingest_sales_with_key`
with headers `apikey: <publishable key>` and `Content-Type: application/json`, and this body:
```json
{ "p_key": "hubk_…", "p_sales": [ { "event": "…", "venue": "…", "event_date": "…", "section": "…", "row": "…",
  "qty": 2, "total_sale": "$1,240", "total_cost": "$900", "profit": "$340", "roi": "37.8%",
  "cost_per": "…", "sold_per": "…", "purchase_date": "…", "sold_date": "…", "order_number": "…",
  "account": "…", "marketplace": "…", "notes": "…", "discord_message_id": "…" } ] }
```
The response looks like `{ "received": 50, "added": 42, "duplicates": 8 }`. Duplicates (the same Discord message, or the same sale posted twice) are skipped automatically. Max 5,000 sales per call.
`rpc/sync_status_with_key` with `{ "p_key": "…" }` returns totals plus the newest Discord message ID, so a "sync new" button knows where to resume.
