# Implementation plan

## Top priority — dashboard overview and drilldowns

User priority: complete and validate the actual dashboard before automatic collection, history coverage expansion, retention automation, popup saving, and other release work. Default landing view must summarize bookmarks/folders/duplicate copies/empty folders/checked-dead candidates/new bookmarks, and history visits/pages/websites/repeat visits/dead checks/recent activity/newly archived visits. Every metric must lead to its corresponding records, cleanup candidates, folder contents, website group, or details.

Implemented: overview-first navigation, live permission-gated Chrome bookmark counts, persistent link-check results, current-tree bookmark/folder browsers, source-aware history summaries, website groups, recent archive details, and filtered drilldowns. Real bookmarks use actual Chrome saved timestamps; visit activity and first-archive timestamps remain separate. Unavailable Chrome counts show a dash, unchecked URLs are labeled, and repeated visits are not presented as duplicate source records. New archive timestamp tracking begins with this update; older source records without that field are not fabricated as new.

Validation before lower-priority work: verify the dashboard and card navigation on the user's real archive, check that counts match each detail view, and review responsive/keyboard behavior. Automated data/count/drilldown tests and migration checks accompany this implementation; browser UI validation remains outstanding.

Phone-tab debug fix: declare/request optional tab URL permission alongside sessions, collect sessions before lengthy history imports, and report per-device session/tab/missing-URL/accepted counts plus skips and source failures. Chromium scrubs session Tab URL fields without sufficient permissions; the previous importer silently discarded them. Existing installs need an explicit runtime permission grant through the new coverage repair action. Mock regression reproduces the failure and permission repair; actual phone coverage still needs user validation.

This scaffold establishes the project foundation, not a completed MVP.

Implemented prototype: consent and optional-permission onboarding; manual collectors with bounded explicit-range history, bookmark reconciliation, snapshot deduplication, unknown remote history provenance, domain exclusions, pause, and per-source outcomes. Mock API/IndexedDB checks cover key archive invariants. M1 still needs real Chrome coverage validation; M2 still needs checkpoints, automatic events, and stronger recovery.

1. **M1 — Feasibility:** implement consent onboarding and optional permissions. Prototype history with explicit start/end times, bookmark folder traversal, and exposed remote sessions. Validate provenance, timestamp units, device identity limitations, permission failures, and initial import range on the intended Chrome version.
2. **M2 — Archive:** implement incremental collectors, checkpoints, transactions, reconciliation, and progress. Verify restart recovery, source deduplication, history deletion retention, missing records, and device-name collisions.
3. **M3 — Dashboard:** implement source/device/domain/date filters, source-specific dates, details, visit timelines and period visit sorting. Add indexed search and virtualization; benchmark 50,000 links before claiming the 500 ms target.
4. **M4 — Controls:** tags, collections, exclusions, pause, deletion with suppression, explicit recollection, validated versioned JSON import/export, and CSV export.
5. **M5 — Release:** Chrome integration checks, keyboard/accessibility QA, migrations and recovery, export reminders, packaging, and coverage documentation.
6. **M6 — Optional sync:** defer accounts, backend, mobile viewer, consistency, and deletion propagation until the local product is reliable.

Review schema identities and checkpoint fields against M1 findings before shipping real archives. Store browser-reported history totals separately from derived visit counts when implemented. Do not deduplicate devices solely by name or attribute bookmarks to the collecting device.

Discovery now includes full-archive text search, paginated results, source/device/website/date/bookmark-status filters, period visit sorting, and read-only source details. Source dates use their own timestamp semantics. Version 2 adds a title index and is tested against a version-one archive. Search uses bounded link pages and metadata maps; the agreed 50,000-link performance target and browser accessibility still require validation.

Organization and transfer: details now edit tags, notes, and collection membership; sidebar collections filter search. Version-one JSON archive export/import validates records and foreign references, remaps exact-URL duplicates, preserves existing notes, and deduplicates source identities transactionally. CSV export escapes formula-like text. Import does not enable collectors or change local settings, and imported foreign-local visits are not attributed to the current installation. Tests verify round trips, repeated imports, URL remapping, collection membership, invalid inputs, and atomic rollback. Automatic retention rules, larger/streaming transfers, and real-browser file/keyboard QA remain pending.

Deletion and coverage: archive-only single/bulk/date/full deletion includes preview, stale-record checks, source suppression, orphan pruning, membership cleanup, and explicit recollection controls. Full deletion pauses collection and retains only local settings and suppression among the archive tables. Snapshot suppression keys are hashed. Collectors now enforce pause/exclusions/suppression inside persistence transactions. History diagnostics distinguish API local/synced/unknown visits, excluded/withheld counts, range, cap, and outcome from archive totals and session snapshots. Tests reproduce tabs with no synced history and validate all-source suppression, date semantics, stale previews, new visit IDs, and explicit recollection. Actual user Chrome coverage and browser UI interactions still need validation; phone history remains constrained by the exposed Chrome APIs.

User-authorized scope expansion: Chrome bookmark cleanup now supports exact-URL duplicates with chosen keepers, empty branches, similar folder suggestions with chosen destinations across branches, and opt-in bounded HTTP link checks. It previews actual Chrome operations and stores a local pre-change tree/operation journal before mutations. Protected nodes, cycles, stale trees, changed contents, disappearing duplicate keepers, and unconfirmed dead-link candidates are guarded. Partial mutations are reported; backup HTML can be imported through Chrome. Archive source metadata reconciles without deleting archived links/annotations. Schema version 3 preserves existing archives and adds cleanup backups. Mock tests validate cleanup, managed-node protection, exact URL semantics, cross-branch and shared-destination merges, backup escaping, source reconciliation, partial failure, HTTP classifications, and full-deletion cleanup of backup data. Real Chrome permission prompts, network behavior, HTML backup import, and mutation UI still need manual verification.

Chrome references:
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics
- https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- https://developer.chrome.com/docs/extensions/reference/api/history
- https://developer.chrome.com/docs/extensions/reference/api/bookmarks
- https://developer.chrome.com/docs/extensions/reference/api/sessions
