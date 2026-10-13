# Link Library

Local-first Chrome extension scaffold based on [the PRD](docs/link-library-prd.md). React, TypeScript, and Dexie provide the dashboard/popup shells and archive foundation. No backend is needed.

## Development

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the Vite URL for the dashboard or `/popup.html` for the popup. Browser preview has a separate IndexedDB origin from the installed extension.

## Load in Chrome

```sh
npm run build
```

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked** and choose `dist`.
3. Open the extension popup, then select **Open dashboard**.
4. After rebuilding, reload the extension and its pages.

Production scripts are bundled locally, including `dist/background.js`. Load the production build as the extension.

## Scaffold scope

Implemented: Manifest V3 packaging, React dashboard/popup, permission and retention onboarding, manual bookmark/history/synced-tab collectors, exclusions, pause/resume, source/device views, per-source progress/errors, full-archive text search with paginated results, website/date/bookmark-status filters, recorded-visit sorting, a provenance details panel, dashboard dark/light theme, safe HTTP(S) navigation, and Dexie persistence.

Pending: automatic scheduling/event collection, resumable import checkpoints, search-performance optimization/benchmarking, and automatic retention rules. Collection starts only after retention consent and selected-source permission grants. No data is fabricated.

## Discovery

The dashboard now opens to an overview instead of the full link list. Bookmark cards count the actual Chrome tree: bookmarks, folders excluding browser roots, exact-URL duplicate copies, editable empty folders, last-checked not-found/gone bookmarks, and bookmarks saved in the last seven days. Counts require granted bookmark access; unavailable values show a dash. Each card drills into current bookmark/folder records or the cleanup workspace. Folder rows open their contents. Archive bookmark records have a separate entry because archival retention differs from current Chrome state.

History cards summarize actual archived visits, unique pages, websites, repeat activity, persisted dead-link checks, recent visits, newly archived visits, and local/synced/unknown origins. Repeated visits are not duplicate archive records. Website groups drill into that hostname's history; activity rows open link details. Creation/visit/check/first-archive dates remain separately labeled. Source collection timestamps are preserved on repeated refresh and start tracking with this update; legacy records without timestamps are excluded from newly-archived counts. Schema version 4 adds persistent health checks. Full archive deletion also clears stored health-check URLs.

Cleanup, source coverage, backup, and deletion controls are now separate sidebar destinations. **Dashboard** and **Back to dashboard** return to the summary. The overview and drilldowns are the current top priority before remaining automation/release work.

Search checks titles, exact URLs, domains, and tags across the entire archive. Dashboard results are paginated in groups of 30; popup search uses 10. Website filters use exact hostnames. Date boundaries follow local calendar days: history uses visit time, bookmarks use saved time, and snapshots use observation time. Mixed views match any eligible source. Unknown saved dates do not match a date range. The bookmark-status filter describes the last collected Chrome state, including archive links whose bookmarks have been removed.

Visit sorting counts only actual archived visits matching the date/device filters; tab observations are never added. Results show source-specific date labels. **View details** opens a keyboard-accessible side dialog with full URL/copy/open actions, folder associations and source status, paginated visits, and paginated observations with separately labeled session modification timestamps.

## Organization and backups

Create collections in the sidebar, then open **View details** to edit comma-separated tags, notes, and collection membership. Choose **Save organization** to persist changes. Tags are searchable; collection navigation filters results. These edits do not change Chrome bookmarks. Tags are limited to 50 labels of 100 characters each; notes support 20,000 characters.

Open **Backup and restore** to download a version-one JSON archive, export CSV links, or merge a JSON archive (up to 50 MB). JSON contains links, visits, bookmarks, devices, tab observations, tags/notes, collections, and suppression markers. It excludes collector settings, permission grants, and collection-run status. CSV includes title, exact URL, website, tags, and notes, with spreadsheet formula escaping; it is not a restorable archive.

Import validates fields, safe HTTP(S) URLs, identifiers, and cross-record references before writing. Exact-URL matches remap source references and collection membership to existing links, union tags, and preserve nonempty local notes. Existing source identities deduplicate repeated imports. Conflicting immutable source identities cancel the entire transaction. The current desktop's collector identity, consent, pause state, and permissions remain unchanged. Visits from another collector retain their origin and display an unavailable desktop name instead of being attributed to this installation.

Files are downloaded locally and never uploaded. Exported archives contain private browsing data and annotations. Large JSON exports materialize the archive in memory; streaming export and larger import support remain future work.

## Chrome bookmark cleanup

Open **Clean up Chrome bookmarks**, choose **Scan bookmarks**, select candidates, then **Review** and **Apply to Chrome bookmarks**. This explicitly requested feature modifies Chrome's real bookmark tree, and Chrome may sync changes to other devices. Scanning alone makes no changes. Root/system folders and managed bookmarks are excluded from modifications.

- Duplicates use exact URL equality, including query strings and fragments. Select a keeper for each group; cross-folder copies are shown with full paths and are not assumed accidental.
- Empty branches are removed leaf-first with the non-recursive Chrome remove API. Parent/child selections are validated, and a folder gaining contents stops cleanup rather than deleting its children.
- Similar folder suggestions use normalized names and conservative one-edit matching. Folders may be in different branches; choose the destination explicitly. Sources can share a destination, while cycles, ancestor merges, nested overlapping operations, and protected descendants are rejected. Children are moved before removing the empty source.
- Optional link checks request runtime host access for batches of up to 100 HTTP(S) URLs, four requests at a time, with eight-second timeouts. Checks omit cookies/referrers and do not follow redirects to new hosts. HEAD failures use GET fallback where applicable; 404/410 results are candidates for manual removal, while redirects, authentication/access errors, rate limits, server errors, and network failures remain uncertain. Protected pages may respond differently without cookies. Selected candidates are checked again before any mutation.

The original tree and operation plan are saved locally before writes, including pending/complete/partial state and completed operation count. Download the current tree or latest pre-cleanup backup as Chrome-importable bookmark HTML. Importing an HTML backup adds bookmarks; it does not reverse moves automatically. Chrome APIs do not provide an atomic multi-operation transaction, so failures stop remaining work and can leave partial changes. Stale scans are rejected before starting, and nodes/folder contents/duplicate keepers are rechecked during application. Re-scan after every cleanup run.

Existing Link Library bookmark records are reconciled with current Chrome source state and folder paths, while links, tags, notes, and other source records remain archived. Cleanup backups are separate from the version-one library JSON export and are removed by full-archive deletion. Schema version 3 adds the cleanup-backup store. No real Chrome cleanup has been exercised in automated tests; tests use a mock bookmark tree and mock HTTP responses.

## Other-device history diagnosis

Synced-tab URL access requires both `sessions` and `tabs` permissions. Existing installations must reload the extension, open **Collection coverage**, and choose **Grant session + tab URL access and retry**. Chromium scrubs sensitive fields from session tab objects according to tab/host permissions; previously, redacted tabs were silently skipped. Session collection now runs before history and persists per-device returned/accepted/missing-URL counts, exclusions, incognito skips, and withheld-record counts. Missing URL permission produces a visible source error and repair action. Regression tests reproduce redacted phone tabs, successful collection after permission grant, and repeat-refresh deduplication. This repair does not turn tab snapshots into history visits.

Named device views show synced tab snapshots. **Other synced devices** shows only visits explicitly returned with `isLocal: false`; no URL matching or tab observation is used to invent a visit or device attribution. Unknown-origin visits stay in the general History view.

The **Other-device history coverage** panel distinguishes archive totals from the latest Chrome history scan. It reports returned URL count, in-period local/synced/unknown visit counts, exclusions, withheld records, period, source outcome, and whether the URL cap was reached. No synced visits in a scan means none were identified in the URLs scanned, not that the device has no history. Running and failed scans remain partial. The panel's **Show synced visits** and **Show device tabs** actions clear discovery filters to avoid hiding records.

To investigate: enable History and tabs syncing under the same Chrome account on both devices, select **All available history** in collection settings, collect again, and inspect the panel. Compare against Chrome's native History and Tabs from other devices. Custom sync passphrases can restrict synced history to typed addresses. Tab availability does not guarantee synced history availability; the extension cannot fetch a phone's complete history or assign named remote devices to API visits.

## Archive deletion

Open a link's details to review single-link deletion, select result checkboxes for bulk deletion, or expand **Archive deletion controls** for source-specific date deletion and full-archive deletion. Each operation displays a preview and requires explicit confirmation. Changed archive records invalidate the preview instead of deleting unseen changes.

Date deletion uses visit/saved/observed timestamps and preserves links with remaining source records. Single-link deletion removes that link's source records, tags, notes, and collection membership. Full deletion additionally removes collections, devices, and collection logs and pauses collection; local settings and suppression markers remain. Chrome history/bookmarks/tabs are never modified.

Suppression identifiers prevent deleted source records from returning on refresh, including a refresh racing with deletion: collectors check pause, exclusions, and suppression in the same transaction as persistence. Snapshot suppression stores a SHA-256 identifier instead of a URL-containing snapshot key. New visit IDs and genuinely new snapshots can still be collected. Use exclusions to block future collection from a site. **Allow deleted records again** explicitly clears all suppression markers; resume if paused and refresh afterward. Explicit JSON import can restore backed-up records without changing collection settings.

Queries use IndexedDB indexes for website, title ordering, and visit/observation ranges, cursor-based text matching, and lightweight source/sort metadata. Search covers all links without materializing every link record, but source metadata scales with the archive. The PRD's 50,000-link/500 ms target has not been benchmarked. Database version 2 adds a title index without replacing existing records.

The local web preview cannot access Chrome extension APIs. Import real data through the unpacked extension: open its dashboard, configure sources/history range/exclusions, and choose **Grant access and collect**. Subsequent imports are manual through **Refresh**. Pause stops collection at record boundaries. Each source fails independently; errors preserve existing archive records.

History queries explicitly cover 7, 30, 90 days, or all available history, capped at 10,000 URLs per refresh. The cap produces a coverage warning. Chrome selects URLs by their last visit time; an older visit to a URL last visited outside the selected range can be omitted. Browser-reported lifetime totals are not added to archived visit counts. Sessions expose at most 25 session results in this prototype; missing tabs/devices do not imply absence of browsing activity. Observations are archived snapshots, not real-time open-tab status. Same-name returned devices are stored separately by result position, but Chrome exposes no stable remote device identifier; identities across reordered snapshots remain provisional.

## Structure

```text
public/manifest.json       Extension declaration
src/background/           Service worker
src/collectors/            Collector contracts
src/dashboard/             Dashboard entry point
src/popup/                 Popup entry point
src/domain/                Archive entities
src/storage/               Dexie schema and settings
src/shared/                Shared UI, styles, safe navigation
scripts/                   Background build
docs/                      PRD and implementation plan
```

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Automated tests mock the Chrome APIs with an IndexedDB implementation and verify consent gating, exact-URL deduplication, source provenance, folder associations, repeat refreshes, same-name device entries, exclusions, pause, suppression, partial failures, source removals, database reopening, concurrent render snapshots, full search beyond 100 links, source-aware date filters, visit sorting, pagination, detail timelines, and version-one archive migration. Real Chrome integration, browser UI accessibility, and performance checks remain necessary.

Manual Chrome smoke check: configure sources, inspect permission prompts and collection progress, open imported links, refresh without increasing visit counts, delete Chrome history and confirm archive retention, pause and refresh, revoke a source permission, and verify the other sources remain usable. Restart Chrome and confirm archived data persists. Test actual desktop/phone session coverage before claiming feasibility completion.

## Archive invariants

- Preserve exact URLs, including query parameters and fragments.
- Keep visits, bookmarks, and tab observations separate; observations never count as visits.
- Attribute devices only where source APIs establish provenance.
- Require onboarding consent and selected-source permissions before collection.
- Apply exclusions and suppression before collector persistence.
- Archive deletion must not delete Chrome records.
- Treat imported text as untrusted; no browsing-content telemetry.
- Uninstalling or clearing extension storage can erase the archive.

See [the implementation plan](docs/implementation-plan.md).
