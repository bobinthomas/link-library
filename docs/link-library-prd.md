# Link Library — Product Requirements Document

Version: 1.0  
Date: 13 October 2026  
Status: Proposed specification  
Platform: Desktop Chrome extension; cloud sync and mobile viewer in a later release

## 1. Product summary

Link Library collects bookmarks, available browsing history, and Chrome’s synced device tabs into a searchable personal archive. Users can browse device sections such as “BOBS” and “iPhone 14,” then filter links by source, topic, website, visits, and time.

The default behavior is **archive mode**: once collected, data remains in Link Library even if the user deletes Chrome history. Users delete archived data through separate library controls. Onboarding must explain this before collection starts.

## 2. Problem and target user

People browse across desktops, laptops, phones, and tablets. Useful links become scattered among bookmarks, history, and Chrome’s “Your devices” sections. Finding a page later requires remembering its title, device, or approximate visit date.

The primary user is an individual who uses Chrome across devices and wants to collect, rediscover, and organize these links without manually saving every page.

## 3. Goals

- Collect the data Chrome exposes into a durable personal archive.
- Make device sections a primary navigation method.
- Support finding links by title, URL, website, source, time, and visit frequency.
- Preserve source records when the same URL appears in multiple places.
- Clearly distinguish actual visits from observed device tabs.
- Give users control over collection, exclusions, retention, export, and deletion.

## 4. Scope and platform constraints

| Source | Available information | Important limitation |
|---|---|---|
| Synced device sessions | Device name, exposed tabs/windows, session modification time | A snapshot of available synced sessions; not complete historical browsing activity |
| History | URLs, titles, visit counts, visit timestamps, local-versus-synced origin | Synced visits do not include the originating device name |
| Bookmarks | URLs, titles, folders, creation date and other available metadata | Original saving device is not exposed |

The extension must not claim complete collection from every device. A phone can appear through synced sessions available to desktop Chrome without running this extension on the phone. Availability depends on Chrome’s sync state and the data its APIs expose.

Known local history belongs to the collecting installation. Remote history without an identified device belongs under “Other synced devices.” Bookmarks without device provenance appear in the shared bookmarks view. The device that imported a record must not be presented as its original source device.

Time spent reading pages is out of scope. Session modification time, observation time, bookmark creation time, and visit time are separate fields and must have separate labels.

## 5. Release scope

### MVP

- Desktop Chrome extension with a full-page dashboard and quick-search popup.
- Import available bookmarks and history; collect synced device-tab snapshots.
- Durable local archive.
- All-links, bookmarks, history, device-tabs, and individual-device views.
- Search, date filters, source/device filters, website filters, and visit sorting.
- Link details, manual tags, and collections.
- Refresh, collection pause, domain exclusions, archive deletion, and export/import.
- Clear collection status and source coverage messages.

### Subsequent releases

- Rule-based topic suggestions with user corrections.
- Optional accounts, cloud sync between desktop installations, and mobile-friendly library access.
- Improved duplicate suggestions and bulk organization.
- Optional mirror mode that removes corresponding archive history when Chrome history is deleted.

### Not included in MVP

- Complete per-device history from phones or tablets.
- A native mobile extension or mobile app.
- Reading-time measurement, page-content capture, screenshots, or full-text indexing of websites.
- Automatic modification of Chrome bookmark folders or deletion of Chrome history.
- AI classification that requires sending browsing data to an external service.

## 6. Core user journeys

### First collection

1. User opens the extension and sees the archive-retention explanation.
2. User chooses which sources to enable and grants the required permissions.
3. User names the collecting installation and sets optional site exclusions.
4. Import runs with progress and per-source status.
5. Dashboard shows collected links and discovered device sections.

### Find a link from another device

1. User selects “iPhone 14.”
2. Available and previously archived tab observations appear with their status.
3. User searches or filters by website/topic.
4. User opens a result or saves it to a collection.

### Find a frequently visited page

1. User opens History and selects a date range.
2. User sorts by recorded visits in that range.
3. Link details show the matching visit timeline and known origin.

### Delete Chrome history

1. User deletes history in Chrome.
2. Previously collected data remains in the archive.
3. The extension updates current source state where detectable; it does not imply the data still exists in Chrome.
4. User can separately delete matching records or the entire archive in Link Library.

## 7. Functional requirements

| ID | Priority | Requirement and acceptance criteria |
|---|---|---|
| FR-01 | P0 | Import bookmark links and folder paths. Multiple bookmarks for one URL retain their separate folder associations. |
| FR-02 | P0 | Import available history over an explicit time range. The importer must not accidentally use the API’s default 24-hour range as the complete history. |
| FR-03 | P0 | Collect devices and sessions exposed by Chrome. Show returned device names and clearly label missing, empty, or stale data. |
| FR-04 | P0 | Store independent archive records. Records survive dashboard closure, browser restart, and Chrome history deletion. Local storage is not a backup guarantee against uninstall or storage clearing. |
| FR-05 | P0 | Preserve provenance. Use local installation identity only for confirmed local visits; never infer a remote device from matching URLs. |
| FR-06 | P0 | Deduplicate repeated imports. Refreshing a tab snapshot never creates an actual visit or increases visit frequency. |
| FR-07 | P0 | Search title, URL, domain, and tags. Combine search with source, device, website, date, and bookmark-status filters. |
| FR-08 | P0 | Provide source-appropriate date filters: visit time for history, saved time for bookmarks, observed time for tab snapshots. Mixed results display the relevant date label. |
| FR-09 | P0 | Sort history by recorded visits in the selected period. Keep browser-reported total counts separate from counts derived from archived visit records; do not add overlapping counts together. |
| FR-10 | P0 | Provide link details with full URL, known devices, source badges, folders, visit timeline, observations, tags, and notes. Unsupported fields show “Unavailable,” not fabricated values. |
| FR-11 | P1 | Add/remove manual tags and collection membership without changing Chrome’s bookmark structure. |
| FR-12 | P0 | Support collection pause and domain exclusions. Exclusions apply to every enabled collector before persistence; existing matching data can be deleted separately. |
| FR-13 | P0 | Offer archive-only deletion by link, selected records, date range, and all data. Explain that deletion does not delete Chrome records. |
| FR-14 | P0 | After deletion, avoid immediately re-importing deleted records. Maintain minimal suppression markers, with an explicit option to collect those records again. |
| FR-15 | P0 | Export/import a versioned JSON archive; offer CSV link export. Re-importing the same archive does not duplicate source records. |
| FR-16 | P0 | Show import progress, last successful collection, errors, and permission state per source. Partial failures must not erase previously archived data. |
| FR-17 | P1 | Suggest topics using local rules. User corrections take precedence, and unclassified links remain searchable. |

## 8. Page design

### Layout

The full-page dashboard uses a left sidebar, a search/header area, a compact device overview, a filter toolbar, and a results list. Clicking a result opens a details panel on the right.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ LINK LIBRARY   Search titles, websites, tags…       Refresh  Settings │
├────────────────┬─────────────────────────────────────────────────────┤
│ LIBRARY        │ All devices                                         │
│ All links      │                                                     │
│ Bookmarks      │ [BOBS · This desktop] [iPhone 14 · Synced tabs]       │
│ History        │                                                     │
│ Device tabs    │ Source ▾ Device ▾ Website ▾ Date ▾ Sort ▾            │
│                │                                                     │
│ DEVICES        │ Title / Website    Source      Device       Time    │
│ BOBS           │ GitHub tutorial    Device tab  iPhone 14    Seen…   │
│ iPhone 14      │ Documentation      History     BOBS         Visited…│
│ Other synced   │ Artizent           Bookmark    Unavailable  Saved…  │
│ devices        │                                                     │
│                │                                                     │
│ COLLECTIONS    │                                                     │
│ Work           │                                                     │
│ Learning       │                                                     │
│ + Collection   │                                                     │
└────────────────┴─────────────────────────────────────────────────────┘
```

Rows are illustrative, not assertions about collected records.

### Navigation and interactions

- **All links:** one row per exact URL with combined source badges.
- **Device view:** records confidently associated with that device; distinguish available session tabs from archived observations.
- **Bookmarks:** retain folder browsing and support tag/collection filters.
- **History:** offer timeline grouping and visit-frequency sorting.
- **Device tabs:** separate currently exposed sessions from previously observed tabs. Do not claim a remote tab is open in real time.
- **Details panel:** open/copy URL, edit tags/notes, add to collection, view provenance, or delete from archive.
- **Popup:** quick search, save current page to a collection, collection status, and open dashboard.

### Visual direction

Charcoal background, slightly lighter panels, subtle borders, blue accents, website favicons, and device icons. Compact rows prioritize scanning. Device cards show collection status rather than implying live connectivity. Source badges use both text and color. Keyboard navigation, visible focus states, accessible contrast, and a light theme are required.

### Empty and error states

- No synced devices: explain that Chrome has not exposed any synced sessions; provide refresh and sync-check guidance.
- Permission denied: keep other sources usable and offer a clear permission action.
- Import running: show progress and results already collected.
- Stale device data: show last observed time and an archive label.
- No search results: show active filters and a clear-filters action.
- Unavailable provenance: display “Other synced devices” or “Device unavailable.”

## 9. Data model and collection behavior

| Entity | Key fields |
|---|---|
| Link | ID, exact URL, title, domain, first collected time, last collected time |
| Visit | Link ID, collector ID, source visit ID, visit timestamp, local/synced origin, known device ID |
| Bookmark | Link ID, collector ID, source bookmark ID, folder path, saved time, last-used time if available, current source status |
| Device | Internal ID, source name, collector ID, user alias, first/last observed time |
| Tab observation | Link ID, device ID, session/window/tab reference when available, session modification time, observation time, snapshot ID |
| Collection/tag | User label and link membership |
| Collection run | Source, start/end time, outcome, counts, error information |
| Suppression | Minimal identifier needed to prevent deleted records from being re-imported |

Use exact URL equality for initial merging. Do not strip arbitrary query parameters or fragments, which may identify different content. Broader duplicate detection can suggest merges later.

Import and observation jobs must be repeatable, resumable, and bounded. Update bookmarks/history through applicable API events and reconciliation. Refresh remote sessions when the dashboard opens, on user request, and through scheduled opportunities while Chrome runs. Chrome’s sessions change event does not monitor remote synced-session changes.

Device names are not guaranteed globally unique identifiers. Keep collector context and permit user aliases; do not silently merge devices solely by name.

## 10. Storage, privacy, and retention

- MVP stores data locally in IndexedDB through Dexie; no account is required.
- Onboarding explicitly states: “Link Library keeps collected data even after you delete Chrome history.”
- Local archive retention defaults to keeping records until deleted. Optional retention rules must preview which records they affect.
- Do not collect incognito activity in MVP.
- Do not transmit titles, URLs, history, or notes for analytics.
- Treat imported titles, URLs, and notes as untrusted input; render text safely and validate navigation targets.
- Local data can be lost when the extension is removed or its storage is cleared. Provide export reminders and explain this limitation.
- Future cloud sync must propagate deletions, define backup-retention behavior, and provide account-data deletion controls before launch.

## 11. Proposed architecture

Desktop Chrome Manifest V3 extension written in TypeScript. React provides the dashboard and popup. A background service worker coordinates collectors; IndexedDB/Dexie holds the archive. Use only permissions required for selected sources and collection scheduling.

The initial implementation needs no backend. A later authenticated API and PostgreSQL database can sync the archive across desktop installations and serve a mobile viewer. This sync shares collected records; it does not grant access to additional phone history.

## 12. Nonfunctional requirements

- Search target: results within 500 ms for 50,000 unique links on an agreed reference desktop, measured after indexing.
- Use incremental imports, indexes, and list virtualization to avoid loading the entire archive into memory.
- Interrupted imports resume without corrupting data or duplicating records.
- Database schema migrations preserve existing archives and have recovery/export provisions.
- Background collection respects browser scheduling; it does not promise continuous execution while Chrome is closed.
- All primary dashboard flows support keyboard operation and usable layouts at common desktop sizes.

These are proposed acceptance targets and must be benchmarked during implementation.

## 13. Development milestones

| Milestone | Deliverable | Exit criteria |
|---|---|---|
| M1: Feasibility | Minimal collectors tested on BOBS and iPhone 14 sessions | Document returned data, coverage gaps, timestamp semantics, and device limitations |
| M2: Archive | IndexedDB schema, import pipeline, provenance, deduplication | Restart, repeated import, and history-deletion checks pass |
| M3: Dashboard | Sidebar, device views, search, filters, sorting, details | Core discovery journeys work with real and large sample data |
| M4: Controls | Tags, collections, exclusions, deletion suppression, export/import | Collection and retention controls pass acceptance checks |
| M5: Release readiness | Permission onboarding, accessibility, performance, packaging | MVP acceptance criteria pass and known limits are visible in product |
| M6: Optional sync | Account, cloud archive, mobile viewer, deletion propagation | Multi-installation consistency and account deletion are verified |

Cloud sync should start only after M1–M5 establish a reliable local product.

## 14. Verification and success measures

Required checks include repeated import, browser restart, Chrome history deletion, bookmark removal, disappearing remote tabs, permission revocation, interrupted jobs, device-name collisions, exclusions, archive deletion/re-import suppression, and export/import round trips.

Success measures for pilot evaluation:

- Users can find a known archived link through device/date filters without reopening Chrome’s native history menu.
- No false attribution of remote history or bookmarks to a named device.
- No duplicate actual visits caused by collection refreshes.
- All collected data survives Chrome history deletion in archive mode.
- Search meets the agreed performance target.

Evaluate with test datasets and voluntary pilot feedback; browsing-content telemetry is not required.

## 15. Risks and implementation decisions

| Risk | Response |
|---|---|
| Incomplete or delayed Chrome sync data | Display coverage and last-observed status; archive available snapshots |
| Missing remote-device provenance | Keep origin unknown rather than infer it |
| Re-importing deleted archive data | Implement suppression before releasing deletion controls |
| Large history volume | Incremental imports, indexed queries, and virtualized results |
| Confusing archive deletion with Chrome deletion | Separate actions and explain their scope |
| Overlapping records in future cloud sync | Establish cross-collector deduplication rules before reporting combined counts |

M1 must resolve the initial history-import range, session-result coverage, local installation naming, and permission behavior on the intended Chrome version. Timing estimates should follow that prototype rather than assume complete API coverage.

## 16. Technical references

- [Chrome Sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions): synced device sessions, session timestamps, result limits, and event limitations.
- [Chrome History API](https://developer.chrome.com/docs/extensions/reference/api/history): history queries, visit counts/times, local-versus-synced origin, and deletion events.
- [Chrome Bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks): bookmark tree, folders, dates, and change events.

API behavior should be revalidated during M1 against the Chrome version used for development.
