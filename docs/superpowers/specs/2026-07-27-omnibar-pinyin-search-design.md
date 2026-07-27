# Omnibar Pinyin Fuzzy Search Design

**Status:** Approved

**Date:** 2026-07-27

## Goal

Add optional pinyin fuzzy search to every URL-like Surfingkeys Omnibar:

- tabs and close-tabs
- history
- bookmarks
- recently closed entries
- current-tab history
- the combined `URLs` search opened by `t`

The feature must support:

- full pinyin: `weixin` matches `微信`
- pinyin initials: `wx` matches `微信`
- ordered letter skipping: `weixn` and `wix` match `微信`
- order enforcement: `xiw` does not match `微信`
- mixed keywords: `wx docs` and `docs wx` match `微信 Docs`
- polyphonic words: both `chongqing` and `zhongqing` match `重庆`

Existing title, URL, Chinese, English, case-sensitivity, and multi-keyword
behavior must remain unchanged when pinyin search is disabled.

## Non-goals

- Pinyin highlighting in rendered results
- Typo correction or out-of-order letter matching
- Pinyin conversion of URLs
- Persistent search indexes
- New permissions, shortcuts, or loading UI
- Changes to opening, closing, deleting, or navigating results

## Configuration

Add the following runtime setting with a default value of `true`:

```js
settings.omnibarPinyinSearch = true;
```

Users can set it to `false` in their Surfingkeys settings. When disabled, all
handlers use the existing browser-API filtering and `filterByTitleOrUrl` paths.
They must produce the same results in the same order as the current `master`
branch.

Document the setting in the English and Chinese README settings tables.

## Dependency

Use `pinyin-pro` as a production dependency. It supports browsers, phrase-aware
pronunciation, polyphonic alternatives, full pinyin, initials, and configurable
matching precision.

The evaluated `3.28.1` browser distribution adds approximately 142 KB gzip.
The package has no transitive runtime dependencies. Surfingkeys currently does
not commit an npm lock file, so this change will not introduce one.

References:

- <https://pinyin-pro.cn/use/match.html>
- <https://pinyin-pro.cn/use/polyphonic.html>
- <https://www.npmjs.com/package/pinyin-pro>

## Architecture

Add an Omnibar-only module such as:

```text
src/content_scripts/ui/pinyinSearch.js
```

The module owns pinyin conversion, token matching, scoring, stable sorting, and
the per-Omnibar-session cache. It must not own browser API calls or UI
rendering.

Keep `pinyin-pro` out of `src/common/utils.js`. The common module is imported by
both background and frontend bundles; importing the dictionary there would
duplicate it across bundles. Only the Omnibar frontend bundle should contain
the pinyin dependency.

The data flow is:

```text
Omnibar input
  -> handler obtains unfiltered candidates
  -> unified filter and scorer
  -> stable sort
  -> existing listURLs rendering
```

The filter returns the original tab, history, or bookmark objects. It does not
persist scores or phonetic data on browser-owned objects.

## Matching Semantics

Split the query on whitespace. Query-token order is not significant, preserving
the existing multi-keyword behavior. Characters inside each token must remain
in order, but the matcher may skip characters.

For each candidate and each query token:

1. Try the original title and URL first.
2. If the token does not match either field and contains ASCII letters, try the
   title's pinyin representations.
3. Keep the candidate only when every query token matches.

This optimization is per candidate and per query token. For `wx docs` against
`微信 Docs`, `docs` is an original-text match while only `wx` requires pinyin
conversion.

Original title and URL matching continues to use Surfingkeys' current
case-sensitivity rules. Pinyin matching ignores case and tones.

### Match tiers

Each query token receives its best tier:

| Tier | Match |
| --- | --- |
| 0 | Existing original-title or URL match |
| 1 | Exact full-pinyin or initials representation |
| 2 | Pinyin or initials prefix/contiguous match |
| 3 | Ordered pinyin or initials subsequence |

Examples:

- `weixin` and `wx` against `微信` are tier 1.
- `wei` against `微信` is tier 2.
- `wix` and `weixn` against `微信` are tier 3.
- `xiw` does not match.

Use `pinyin-pro` for phrase-aware primary readings and all valid polyphonic
readings. The scorer selects the valid path with the fewest skips and shortest
coverage. If paths have identical metrics, prefer the phrase-aware primary
reading without changing the candidate's external score.

Use bounded dynamic programming over per-character pronunciation alternatives
to calculate the best ordered alignment. Do not materialize the Cartesian
product of polyphonic readings.

### Stable ranking

Sort candidates lexicographically by:

```text
(
  worst token tier,
  total skipped letters,
  total match start offsets,
  total covered length,
  original candidate index
)
```

Smaller values rank first. The original candidate index is the final
tie-breaker, preserving tab MRU order and history visit-count/time order for
equal matches.

## Cache

Create a title-to-phonetic-data cache when an Omnibar opens:

- A title is converted at most once during that Omnibar session.
- Query changes reuse converted data.
- A changed tab title naturally uses a different cache key.
- The cache is cleared when the Omnibar closes.
- No index is written to extension storage.

Do not convert a title unless at least one ASCII query token failed original
title and URL matching for that candidate.

## Candidate Acquisition

Pinyin input cannot be passed to browser history or bookmark search APIs,
because those APIs would discard Chinese-titled candidates before local
matching.

### Tabs, recently closed, and tab history

`Tabs`, `CloseTabs`, `RecentlyClosed`, and `TabURLs` obtain their complete
candidate lists without pinyin-query prefiltering, then pass them to the unified
frontend filter.

### Bookmarks

When pinyin matching is needed:

- Global bookmark search obtains all bookmarks and filters them in the
  frontend.
- Search inside an entered bookmark folder obtains only that folder's current
  level, preserving existing folder-navigation semantics.
- Raw bookmark candidates are cached for the current Omnibar session.

When pinyin matching is not needed, retain the current browser-side query path.

### History

History must not be limited to the latest `omnibarHistoryCacheSize` raw entries,
because that would make older Chinese-titled entries unsearchable. It also must
not load the complete history into the frontend at once.

Add a background action that returns one time-ordered raw history page. The
request contains an end-time cursor and page size; the response contains the
entries, the next cursor, and whether history is exhausted.

The frontend:

1. Reads a page of 500 raw history entries.
2. Filters and ranks the accumulated entries locally.
3. Stops after finding `omnibarHistoryCacheSize` matches or exhausting history.
4. Reuses pages already fetched when the query changes.
5. Fetches more pages only when the cached pages do not provide enough matches.
6. Yields between pages so typing remains responsive.
7. Uses the existing query sequence number to discard stale asynchronous
   results.

The combined `URLs` handler uses the same history paging behavior after tabs,
top sites, and bookmarks are included. Existing result and display-page limits
remain in force.

When pinyin matching is not needed, retain the existing history query path.

## Error and Compatibility Behavior

- `pinyin-pro` is a build-time dependency. Missing or incompatible dependency
  setup must fail the build instead of silently disabling the feature.
- Pinyin conversion is synchronous and performs no network requests.
- Browser API error handling follows existing project conventions.
- History pages may update visible results progressively; no new loading state
  is added.
- Every asynchronous page response checks the active query sequence before
  updating results.
- No new extension permissions are required.

## Tests

Add focused Jest unit tests for:

- `weixin` and `wx` matching `微信`
- `weixn` and `wix` matching `微信`
- `xiw` not matching `微信`
- `chongqing` and `zhongqing` matching `重庆`
- `yinyue` and `yinle` matching `音乐`
- `wx docs` and `docs wx` matching `微信 Docs`
- original title and URL matches ranking before pinyin matches
- exact, contiguous, and subsequence tier ordering
- skip count, start offset, covered length, and stable-index tie-breakers
- case-insensitive pinyin and existing raw-text case behavior
- disabled-setting parity with the existing filter
- one conversion per title per Omnibar session

Add handler/background tests for:

- pinyin-enabled tab filtering from complete candidates
- raw bookmark acquisition without passing the pinyin token to browser search
- folder-local bookmark behavior
- history page continuation and stop-at-result-limit behavior
- cached-page reuse after query changes
- stale history responses not overwriting a newer query
- combined `URLs` merging and stable ranking

## Verification

The implementation is complete when:

1. All Jest tests pass.
2. Chrome and Firefox production builds pass.
3. The before/after production archive sizes are recorded.
4. A Chrome unpacked build is manually verified for tabs, close-tabs, history,
   bookmarks, recently closed entries, tab history, and combined `t` search.
5. The same manual searches are repeated with
   `settings.omnibarPinyinSearch = false` to confirm legacy behavior.
6. English and Chinese README setting documentation is present.
