# Omnibar Pinyin Fuzzy Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable full-pinyin, initials, polyphonic, and ordered-subsequence search to every URL-like Surfingkeys Omnibar.

**Architecture:** Keep pinyin conversion in a new Omnibar-only frontend module so the dictionary is bundled once. Existing handlers provide raw candidates to a stable scorer; bookmarks use an unfiltered retrieval mode and history uses a reusable progressive pager.

**Tech Stack:** JavaScript, Jest, Webpack 5, Chrome/Firefox extension APIs, `pinyin-pro@^3.28.1`.

## Global Constraints

- `settings.omnibarPinyinSearch` defaults to `true` and can disable the complete feature.
- Disabled behavior must use the existing filters and preserve current ordering.
- Pinyin applies to titles only; URLs retain literal matching.
- Query tokens may skip letters but must preserve letter order.
- Query-token order remains insignificant.
- Phrase-aware and alternate polyphonic readings are supported.
- No new permissions, shortcuts, persistent indexes, loading UI, or pinyin highlighting.
- Do not add an npm lock file.

---

### Task 1: Deterministic Pinyin Matcher

**Files:**
- Modify: `package.json:57-79`
- Create: `src/content_scripts/ui/pinyinSearch.js`
- Create: `tests/content_scripts/ui/pinyinSearch.test.js`

**Interfaces:**
- Consumes: `filterByTitleOrUrl(items, query, caseSensitive)` and `pinyin-pro`'s `pinyin`/`polyphonic` exports.
- Produces: `createPinyinSearch()` returning `{ filter(items, query, caseSensitive, enabled), clear() }`.
- `filter` returns the original item objects in score order and never mutates them.

- [ ] **Step 1: Add failing matcher tests**

Cover the approved behavior with table-driven tests:

```js
import createPinyinSearch from 'src/content_scripts/ui/pinyinSearch';

const url = (title, url = `https://${title}.example`) => ({title, url});

describe('pinyin search', () => {
    let search;
    beforeEach(() => {
        search = createPinyinSearch();
    });

    test.each([
        ['weixin', '微信'],
        ['wx', '微信'],
        ['weixn', '微信'],
        ['wix', '微信'],
        ['chongqing', '重庆'],
        ['zhongqing', '重庆'],
        ['yinyue', '音乐'],
        ['yinle', '音乐'],
        ['wx docs', '微信 Docs'],
        ['docs wx', '微信 Docs'],
    ])('%s matches %s', (query, title) => {
        expect(search.filter([url(title)], query, false, true)).toHaveLength(1);
    });

    test('out-of-order letters do not match', () => {
        expect(search.filter([url('微信')], 'xiw', false, true)).toEqual([]);
    });

    test('orders literal, exact pinyin, contiguous pinyin, then subsequence', () => {
        const items = [
            url('微信'),
            url('微'),
            url('wix literal'),
            url('Weixin'),
        ];
        expect(search.filter(items, 'wix', false, true).map(i => i.title))
            .toEqual(['wix literal', '微信']);
        expect(search.filter(items, 'wei', false, true).map(i => i.title))
            .toEqual(['Weixin', '微', '微信']);
    });

    test('keeps original order for equal scores', () => {
        const items = [url('微信 A'), url('微信 B')];
        expect(search.filter(items, 'wx', false, true)).toEqual(items);
    });

    test('disabled mode is identical to the legacy filter', () => {
        const items = [url('微信'), url('weixin literal')];
        expect(search.filter(items, 'weixin', false, false))
            .toEqual([items[1]]);
    });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm install --no-package-lock
npm test -- --runInBand tests/content_scripts/ui/pinyinSearch.test.js
```

Expected: FAIL because `src/content_scripts/ui/pinyinSearch.js` does not exist.

- [ ] **Step 3: Add `pinyin-pro` and implement the matcher**

Add `"pinyin-pro": "^3.28.1"` to `dependencies`.

Install the added dependency without creating a lock file:

```bash
npm install --no-package-lock
```

Implement these private units in `pinyinSearch.js`:

```js
import { pinyin, polyphonic } from 'pinyin-pro';
import { filterByTitleOrUrl } from '../../common/utils';

const asciiToken = /[a-z]/i;
const normalizePinyin = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

function rawTokenScore(item, token, caseSensitive) {
    const title = item.title || '';
    const url = item.url || '';
    const needle = caseSensitive ? token : token.toLowerCase();
    const fields = caseSensitive ? [title, url] : [title.toLowerCase(), url.toLowerCase()];
    const starts = fields.map(field => field.indexOf(needle)).filter(index => index >= 0);
    return starts.length ? {tier: 0, skipped: 0, start: Math.min(...starts), span: token.length} : null;
}

function createPhoneticData(title) {
    const primary = pinyin(title, {toneType: 'none', type: 'array'});
    const alternatives = polyphonic(title, {toneType: 'none', type: 'array'});
    return {primary, alternatives};
}

function compareScore(a, b) {
    const left = [a.tier, a.skipped, a.start, a.span, a.primaryPenalty || 0];
    const right = [b.tier, b.skipped, b.start, b.span, b.primaryPenalty || 0];
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
}
```

Implement a bounded dynamic-programming `matchLayers(layers, token)`:

- Each layer is one original title character.
- Each layer contains normalized full readings or their first letters.
- State contains `{queryIndex, started, skipped, start, span, suffix, primaryPenalty}`.
- For each candidate letter, retain both the skip transition and, when equal to the next query letter, the match transition.
- Deduplicate states by `queryIndex`, `started`, and `suffix`, retaining the lower score.
- A complete state is tier 1 when it starts at zero, has no internal skips, and no suffix; tier 2 when it has no internal skips; otherwise tier 3.

`createPinyinSearch()` must:

```js
export default function createPinyinSearch() {
    const cache = new Map();
    return {
        filter(items, query, caseSensitive, enabled) {
            if (!enabled) return filterByTitleOrUrl(items, query, caseSensitive);
            const tokens = query.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) return items;

            return items.map((item, index) => {
                const tokenScores = tokens.map(token => {
                    const raw = rawTokenScore(item, token, caseSensitive);
                    if (raw || !asciiToken.test(token)) return raw;
                    let data = cache.get(item.title || '');
                    if (!data) {
                        data = createPhoneticData(item.title || '');
                        cache.set(item.title || '', data);
                    }
                    return bestPinyinScore(data, normalizePinyin(token));
                });
                if (tokenScores.some(score => score === null)) return null;
                return {
                    item,
                    score: [
                        Math.max(...tokenScores.map(score => score.tier)),
                        tokenScores.reduce((sum, score) => sum + score.skipped, 0),
                        tokenScores.reduce((sum, score) => sum + score.start, 0),
                        tokenScores.reduce((sum, score) => sum + score.span, 0),
                        index,
                    ],
                };
            }).filter(Boolean).sort((a, b) => {
                for (let i = 0; i < a.score.length; i++) {
                    if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
                }
                return 0;
            }).map(entry => entry.item);
        },
        clear() {
            cache.clear();
        },
    };
}
```

- [ ] **Step 4: Run matcher tests**

Run:

```bash
npm test -- --runInBand tests/content_scripts/ui/pinyinSearch.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit matcher**

```bash
git add package.json src/content_scripts/ui/pinyinSearch.js tests/content_scripts/ui/pinyinSearch.test.js
git commit -m "feat: add omnibar pinyin matcher"
```

### Task 2: Reusable Raw-History Pager

**Files:**
- Create: `src/content_scripts/ui/historyPager.js`
- Create: `tests/content_scripts/ui/historyPager.test.js`
- Modify: `src/background/start.js:718-742,1135-1142`
- Modify: `tests/background/start.test.js:70-110`

**Interfaces:**
- Produces: `createHistoryPager(fetchPage)` returning `{ search(filter, limit), clear() }`.
- `fetchPage({endTime, maxResults})` resolves `{history, nextEndTime, done}`.
- Produces background action `getHistoryPage`.

- [ ] **Step 1: Write failing pager and background tests**

Test that cached pages are reused and reading stops at the requested match limit:

```js
import createHistoryPager from 'src/content_scripts/ui/historyPager';

test('pages until enough matches and reuses cached entries', async () => {
    const fetchPage = jest.fn()
        .mockResolvedValueOnce({history: [{title: 'A'}], nextEndTime: 10, done: false})
        .mockResolvedValueOnce({history: [{title: '微信'}], nextEndTime: 0, done: true});
    const pager = createHistoryPager(fetchPage);
    const filter = items => items.filter(item => item.title === '微信');

    await expect(pager.search(filter, 1)).resolves.toEqual([{title: '微信'}]);
    await expect(pager.search(filter, 1)).resolves.toEqual([{title: '微信'}]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
});
```

Extend the background test with a `getHistoryPage` request and assert
`text: ""`, `maxResults: 500`, the passed `endTime`, and an exclusive next
cursor.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npm test -- --runInBand tests/content_scripts/ui/historyPager.test.js tests/background/start.test.js
```

Expected: FAIL because the pager and background action are missing.

- [ ] **Step 3: Implement pager and background action**

Implement `createHistoryPager(fetchPage)` with `items`, `endTime`, `done`, and
an in-flight promise. `search` repeatedly calls `fetchPage` until `filter(items)`
reaches `limit` or `done` is true, then returns `matches.slice(0, limit)`.
`clear` resets all four fields.

Add to `start.js`:

```js
self.getHistoryPage = function(message, sender, sendResponse) {
    const maxResults = message.maxResults || 500;
    const endTime = message.endTime || Date.now();
    chrome.history.search({
        text: "",
        startTime: 0,
        endTime,
        maxResults
    }, function(items) {
        const nextEndTime = items.length
            ? items[items.length - 1].lastVisitTime - 0.01
            : 0;
        _response(message, sendResponse, {
            history: items,
            nextEndTime,
            done: items.length < maxResults
        });
    });
};
```

- [ ] **Step 4: Run pager and background tests**

```bash
npm test -- --runInBand tests/content_scripts/ui/historyPager.test.js tests/background/start.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit pager**

```bash
git add src/content_scripts/ui/historyPager.js tests/content_scripts/ui/historyPager.test.js src/background/start.js tests/background/start.test.js
git commit -m "feat: page raw omnibar history"
```

### Task 3: Integrate Tabs and Bookmarks

**Files:**
- Modify: `src/content_scripts/common/runtime.js:40-100`
- Modify: `src/content_scripts/ui/omnibar.js:1-15,488-600,709-930,1083-1150`
- Modify: `src/background/start.js:1095-1133`
- Modify: `tests/content_scripts/ui/omnibar.test.js`
- Modify: `tests/background/start.test.js`

**Interfaces:**
- Consumes: `createPinyinSearch().filter(...)`.
- Adds `omnibar.filterURLs(items, query)` and clears matcher cache in `ui.onHide`.
- Adds `raw: true` to `getBookmarks` for unfiltered global/folder-local retrieval.

- [ ] **Step 1: Add failing integration tests**

Add `omnibarPinyinSearch: true` to the mocked settings and verify:

- `Tabs`, `CloseTabs`, `RecentlyClosed`, and `TabURLs` pass complete candidates
  through `omnibar.filterURLs`.
- Global bookmark pinyin input sends `{raw: true}` rather than the pinyin query.
- Folder-local raw retrieval preserves only the current level.
- Setting `omnibarPinyinSearch: false` uses the old query arguments.

In the background test, make `chrome.bookmarks.search({})` return a Chinese
bookmark and assert `getBookmarks({raw: true})` returns it.

- [ ] **Step 2: Run focused integration tests and confirm failure**

```bash
npm test -- --runInBand tests/content_scripts/ui/omnibar.test.js tests/background/start.test.js
```

Expected: FAIL because the setting, unified filter, and raw bookmark mode are absent.

- [ ] **Step 3: Add setting and unified filter**

Add to `runtime.conf`:

```js
omnibarPinyinSearch: true,
```

Instantiate one matcher inside `createOmnibar`:

```js
const pinyinSearch = createPinyinSearch();
self.filterURLs = function(items, query = self.input.value) {
    return pinyinSearch.filter(
        items,
        query,
        runtime.getCaseSensitive(query),
        runtime.conf.omnibarPinyinSearch
    );
};
```

Call `pinyinSearch.clear()` from `ui.onHide`. Replace direct
`filterByTitleOrUrl` calls in tab-like handlers with `omnibar.filterURLs`.

- [ ] **Step 4: Add raw bookmark retrieval**

In the background:

```js
if (message.raw && !message.parentId) {
    chrome.bookmarks.search({}, function(tree) {
        _response(message, sendResponse, {bookmarks: tree});
    });
    return;
}
```

For `parentId`, keep `getSubTree(...).children` and skip the query filter when
`raw` is true. In `OpenBookmarks`, cache the raw response for the current
folder/global context and apply `omnibar.filterURLs` locally.

- [ ] **Step 5: Run integration and matcher tests**

```bash
npm test -- --runInBand tests/content_scripts/ui/pinyinSearch.test.js tests/content_scripts/ui/omnibar.test.js tests/background/start.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit integration**

```bash
git add src/content_scripts/common/runtime.js src/content_scripts/ui/omnibar.js src/background/start.js tests/content_scripts/ui/omnibar.test.js tests/background/start.test.js
git commit -m "feat: search tabs and bookmarks by pinyin"
```

### Task 4: Integrate History and Combined URL Search

**Files:**
- Modify: `src/content_scripts/ui/omnibar.js:721-766,1040-1081`
- Modify: `tests/content_scripts/ui/omnibar.test.js`

**Interfaces:**
- Consumes: `createHistoryPager(fetchPage)` and `omnibar.filterURLs`.
- `History` and combined `URLs` create independent pagers per Omnibar open.
- Existing `OpenURLs` sequence number remains the stale-response gate.

- [ ] **Step 1: Add failing history and combined-search tests**

Mock `RUNTIME('getHistoryPage')` with two pages and verify:

- Pinyin history search continues until the configured result limit or `done`.
- Cached history pages are reused after query changes.
- A slower old query cannot replace the newer query's results.
- Combined `URLs` merges tabs, top sites, raw bookmarks, and paged history,
  then calls the stable scorer once.
- Disabling the setting uses `getHistory`/`getAllURLs` as before.

- [ ] **Step 2: Run focused test and confirm failure**

```bash
npm test -- --runInBand tests/content_scripts/ui/omnibar.test.js
```

Expected: FAIL because history handlers do not use `getHistoryPage`.

- [ ] **Step 3: Add history-pager factory to Omnibar**

```js
function createOmnibarHistoryPager() {
    return createHistoryPager(args => new Promise(resolve => {
        RUNTIME('getHistoryPage', {
            endTime: args.endTime,
            maxResults: args.maxResults
        }, resolve);
    }));
}
```

Use paging only when `runtime.conf.omnibarPinyinSearch` is true and the query
contains ASCII letters. Pass a filter closure using `omnibar.filterURLs` and
the current query. Keep each handler's pager until it closes.

- [ ] **Step 4: Merge combined URL candidates before one stable sort**

Collect raw tabs, top sites, bookmarks, and enough history candidates. Run
`omnibar.filterURLs` on the combined list, slice to the existing cache limit,
and call `resolve`. Preserve `detectAndInsertURLItem` after filtering.

- [ ] **Step 5: Run all JavaScript tests**

```bash
npm test -- --runInBand
```

Expected: all Jest suites PASS.

- [ ] **Step 6: Commit history integration**

```bash
git add src/content_scripts/ui/omnibar.js tests/content_scripts/ui/omnibar.test.js
git commit -m "feat: search omnibar history by pinyin"
```

### Task 5: Documentation and Release Verification

**Files:**
- Modify: `README.md:551-555`
- Modify: `README_CN.md:538-542`

**Interfaces:**
- Documents `settings.omnibarPinyinSearch`.
- Produces verified Chrome and Firefox unpacked builds.

- [ ] **Step 1: Document the setting**

Add:

```markdown
| settings.omnibarPinyinSearch | true | Whether Omnibar URL sources support full-pinyin, initials, polyphonic, and ordered-subsequence matching. |
```

and:

```markdown
| settings.omnibarPinyinSearch | true | 是否为搜索栏中的标签页、历史、书签等网址来源启用全拼、首字母、多音字和有序跳字母匹配。 |
```

- [ ] **Step 2: Run formatting and full tests**

```bash
git diff --check
npm test -- --runInBand
```

Expected: no whitespace errors and all tests PASS.

- [ ] **Step 3: Build Chrome and Firefox production packages**

```bash
npm run build:prod
browser=firefox npm run build:prod
```

Expected: both Webpack builds complete successfully and produce
`dist/production/chrome/sk.zip` and `dist/production/firefox/sk.zip`.

- [ ] **Step 4: Record archive sizes**

```bash
ls -lh dist/production/chrome/sk.zip dist/production/firefox/sk.zip
```

Record the exact sizes in the final handoff.

- [ ] **Step 5: Manual Chrome verification**

Load `dist/development/chrome` or `dist/production/chrome` as an unpacked
extension and verify:

- tabs, close-tabs, bookmarks, history, recently closed, tab history, and `t`
- `weixin`, `wx`, `weixn`, `wix`, and `xiw`
- `chongqing`, `zhongqing`, `yinyue`, and `yinle`
- `settings.omnibarPinyinSearch = false`

- [ ] **Step 6: Commit documentation**

```bash
git add README.md README_CN.md
git commit -m "docs: document omnibar pinyin search"
```

- [ ] **Step 7: Final verification**

```bash
git status --short
git log --oneline --decorate -6
```

Expected: clean worktree with the design, plan, implementation, tests, and
documentation committed on `feature/omnibar-pinyin-search`.
