# 05 · UX and design

## Principles

1. **Two-minute count.** The daily count is the whole product for a lab tech. Everything else is secondary
   navigation. The count sheet opens directly from the notification and from the Today screen's primary button.
2. **Big numbers, little typing.** Quantities are the only free input. Prefilled expected values, packs + loose
   entry, steppers, and a numeric keypad on mobile. Items are never typed; they come from the BU's list.
3. **Grouped by instrument.** The count sheet is sectioned the way the bench is: one section per instrument,
   then general consumables, then materials. Techs recognise the machine before the reagent name.
4. **Variance is shown, not blocked.** A value that differs from expectation gets an amber marker and a note
   field. Submission is never blocked by a variance; managers review later.
5. **Role-shaped navigation.** A lab tech sees Today, Count, Stock, Alerts. A manager adds Instruments, Items,
   Reminders, Team. Admins add Catalogue, BUs, Users. Only super_admin sees Reports. Nothing is greyed out;
   it is absent.
6. **Same app everywhere.** Phone-first layout that widens into a two-column desktop layout at 1024 px. No
   separate "mobile version".

## Screens

| Screen | Role | Content |
| --- | --- | --- |
| Login | all | Email + password, remember device. BU picker if member of several. |
| **Today** | all BU roles | Two cards: Opening (status chip: Due 09:00 / Submitted 08:41 by R. Sharma / Missed) and Closing. Primary button "Start closing count". Below: Alerts strip (low stock, expiring lots, yesterday's variances). |
| **Count sheet** | tech+ | Sticky header: BU, date, session, progress "18 / 42 items". Sections per instrument (collapsible, with model + serial). Each line: item name, code in mono, lot chips (when tracked), expected value, input `packs` `loose` → computed base qty, variance marker, note icon. Footer: "Submit" with summary sheet (items counted, variances, notes). Drafts autosave every change. |
| Variance review | manager+ | Yesterday's submitted counts with variance > tolerance, notes, who submitted, quick "acknowledge". |
| **Stock** | all BU roles | Levels table per bu_item with on-hand, min, status pill (OK / Low / Out), last counted. Filters by instrument and kind. Tap → item drawer: lots with expiry, recent movements, thresholds (editable by manager). |
| Receive | tech+ | Item picker (search within BU list), lot no, expiry, supplier, packs received. Scan button reserved for phase 5. |
| Wastage / Adjust / Transfer | tech / manager | One form with type toggle; transfer shows destination BU picker. |
| Instruments | manager+ | Cards per instrument (model, serial, status, count of tracked reagents). Add instrument → proposes reagent list from model with checkboxes. |
| BU items | manager+ | Manage what the BU tracks, thresholds, sort order, active flag. |
| Reminders | manager (BU), tech (own) | List of reminders with kind, time, days, escalation. Toggle. "Send test" button. |
| Catalogue | admin+ | Items, instrument models with reagent lists, suppliers. |
| BUs, Users, API keys, Audit | admin / super_admin | Standard tables with drawers. API key shown once in a copy box. |
| **Reports** | super_admin | Consumption by BU (bar), by instrument, by item; date range; trend line; period snapshot table with lock button; missed-count heatmap (BU × day). CSV export. |

## Core flow: closing count from a push notification

1. 21:00 local: device shows "Closing count due · DEL-CENTRAL". Tap.
2. App opens `/count/today?session=closing`; a draft exists or is created; lines prefilled.
3. Tech walks the bench: expand "Sysmex XN-550 · A1234", enter packs/loose per reagent; move on.
4. Progress bar reaches 42/42. Tap "Submit". Summary sheet shows 2 variances, one without a note → inline
   prompt to add it. Confirm.
5. Today screen shows Closing · Submitted 21:14. The manager's escalation is cancelled server-side.

## Branding

SMS is an Infinity product run for Noble Diagnostics, and both identities appear in every bar, never merged
(the same rule as Stellar-Infinity's `NobleMark.tsx`):

- **Infinity**: the cyan→teal→blue double-helix figure-8 (`web/src/ui/Brand.tsx`, same geometry as Infinity's
  `Mark.tsx`) beside the `SMS` wordmark with the small line "Stock Management · Infinity". Primary buttons and
  the progress bar carry the Infinity gradient (`#0e7490 → #0f766e → #1d4ed8`, bright stops in dark mode).
- **Noble Diagnostics**: the supplied navy roundel + wordmark PNG (`web/public/branding/noble-logo-onlight.png`,
  `-ondark.png`, copied from Stellar-Infinity), shown after a hairline divider. Login shows it above the card;
  the desktop rail shows it at the foot; the phone top bar shows it right of the unit switcher.
- The login ground is Infinity's splash: faint 32px grid, cyan and blue ambient glows, glassy card.

## Design tokens

Infinity's palette on a cool clinical ground: precise, high-contrast, quiet colour except for status and the
one gradient reserved for primary actions. Values below supersede the first draft (2026-09-21 branding pass).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-top` / `--bg-bottom` | `#fbfdff` / `#eaf4f8` | `#0c1826` / `#08111b` | page ground gradient |
| `--surface` | `#ffffff` | `#111f2e` | cards, sheets |
| `--surface-2` | `#eef4f7` | `#172a3c` | table headers, section bands |
| `--ink` | `#0f2233` | `#e6eef7` | primary text |
| `--ink-2` | `#4a5f72` | `#9fb3c6` | secondary text |
| `--line` | `rgba(15,34,51,.10)` | `rgba(230,238,247,.10)` | borders |
| `--cyan` / `--teal` / `--blue` | `#06b6d4` / `#0d9488` / `#2563eb` | `#22d3ee` / `#2dd4bf` / `#60a5fa` | the Infinity mark and gradient stops |
| `--brand` | `#0f766e` | `#2dd4bf` | active nav, links, brand chips (AA on the surface) |
| `--grad-from/mid/to` | `#0e7490` / `#0f766e` / `#1d4ed8` | `#22d3ee` / `#2dd4bf` / `#60a5fa` | primary button and progress gradient |
| `--brand-ink` | `#ffffff` | `#071019` | text on the gradient |
| `--noble` | `#2e2a6b` | `#ffffff` | Noble navy (the PNG swaps to the white version in dark) |
| `--ok` | `#15803D` | `#4ADE80` | submitted, in stock |
| `--warn` | `#B45309` | `#FBBF24` | variance, low stock, due soon |
| `--danger` | `#B91C1C` | `#F87171` | missed, out of stock, expired |
| `--radius` | 10px | | cards, inputs |
| `--radius-pill` | 999px | | status chips |
| `--shadow` | `0 1px 2px rgb(14 23 38 / 6%), 0 4px 12px rgb(14 23 38 / 6%)` | none (use `--line`) | cards |

Typography: **Inter** for UI (400/500/600), **JetBrains Mono** for item codes, lot numbers, serials and
quantities in tables. Base 15 px on mobile, 14 px on desktop; count inputs 22 px.

Spacing scale 4 / 8 / 12 / 16 / 24 / 32. Touch targets ≥ 44 px. Bottom tab bar on < 768 px (Today, Count,
Stock, Alerts, More); left rail on desktop.

## Components (web/src/ui)

`AppShell`, `BuSwitcher`, `StatusChip` (ok/warn/danger/neutral), `StatTile`, `CountLine` (the sheet row),
`QtyInput` (packs + loose with live base-unit readout and stepper), `LotChip`, `Section` (instrument group with
progress), `Drawer`, `Sheet` (mobile bottom sheet), `DataTable` (sticky header, mono numeric column),
`EmptyState`, `Toast`, `ConfirmDialog`.

## Accessibility and offline

- WCAG AA contrast on all tokens above; focus visible; every icon button labelled.
- Count sheet keyboard flow: Tab moves between quantity inputs only; Enter advances to the next line.
- Draft counts are cached in IndexedDB; the sheet works offline and syncs on reconnect (phase 5 hardens
  conflict handling; phase 1 keeps a single-device assumption per draft).
- Notifications deep-link with the BU and session so the right sheet opens even when the user belongs to
  several BUs.
