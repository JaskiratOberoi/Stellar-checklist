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

## Design tokens

Modern lab feel: cool, precise, high-contrast, quiet colour except for status. No gradients on data surfaces.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F4F7F9` | `#0B1220` | app background |
| `--surface` | `#FFFFFF` | `#111A2B` | cards, sheets |
| `--surface-2` | `#EAF0F4` | `#182338` | table headers, section bands |
| `--ink` | `#0E1726` | `#E6EDF5` | primary text |
| `--ink-2` | `#4B5A6B` | `#9FB0C3` | secondary text |
| `--line` | `#D6DEE6` | `#243247` | borders |
| `--brand` | `#0E8C8C` | `#2BB5B5` | primary actions, active nav (teal) |
| `--brand-ink` | `#FFFFFF` | `#06201F` | text on brand |
| `--accent` | `#2563EB` | `#60A5FA` | links, focus ring |
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
