import createHistoryPager from 'src/content_scripts/ui/historyPager';

describe('history pager', () => {
    test('loads pages until enough matches are found', async () => {
        const fetchPage = jest.fn()
            .mockResolvedValueOnce({
                history: [{title: 'Docs'}],
                nextEndTime: 10,
                done: false,
            })
            .mockResolvedValueOnce({
                history: [{title: '微信'}],
                nextEndTime: 0,
                done: true,
            });
        const pager = createHistoryPager(fetchPage);
        const filter = items => items.filter(item => item.title === '微信');

        await expect(pager.search(filter, 1)).resolves.toEqual([{title: '微信'}]);
        expect(fetchPage).toHaveBeenNthCalledWith(1, {
            endTime: undefined,
            maxResults: 500,
        });
        expect(fetchPage).toHaveBeenNthCalledWith(2, {
            endTime: 10,
            maxResults: 500,
        });
    });

    test('reuses fetched entries for the next query', async () => {
        const fetchPage = jest.fn().mockResolvedValue({
            history: [{title: '微信'}, {title: 'Docs'}],
            nextEndTime: 0,
            done: true,
        });
        const pager = createHistoryPager(fetchPage);

        await expect(pager.search(
            items => items.filter(item => item.title === '微信'),
            1
        )).resolves.toEqual([{title: '微信'}]);
        await expect(pager.search(
            items => items.filter(item => item.title === 'Docs'),
            1
        )).resolves.toEqual([{title: 'Docs'}]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    test('stops loading when the result limit is reached', async () => {
        const fetchPage = jest.fn().mockResolvedValue({
            history: [{title: '微信'}],
            nextEndTime: 10,
            done: false,
        });
        const pager = createHistoryPager(fetchPage);

        await expect(pager.search(items => items, 1))
            .resolves.toEqual([{title: '微信'}]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    test('does not refilter unmatched entries from earlier pages', async () => {
        const oldMiss = {
            title: 'Old miss',
            url: 'https://example.com/old-miss',
        };
        const firstMatch = {
            title: 'First match',
            url: 'https://example.com/first-match',
        };
        const secondMatch = {
            title: 'Second match',
            url: 'https://example.com/second-match',
        };
        const fetchPage = jest.fn()
            .mockResolvedValueOnce({
                history: [oldMiss],
                nextEndTime: 20,
                done: false,
            })
            .mockResolvedValueOnce({
                history: [firstMatch],
                nextEndTime: 10,
                done: false,
            })
            .mockResolvedValueOnce({
                history: [secondMatch],
                nextEndTime: 0,
                done: true,
            });
        const filterCounts = new Map();
        const filter = jest.fn(items => items.filter(item => {
            filterCounts.set(item.url, (filterCounts.get(item.url) || 0) + 1);
            return item !== oldMiss;
        }));
        const pager = createHistoryPager(fetchPage);

        await expect(pager.search(filter, 2))
            .resolves.toEqual([firstMatch, secondMatch]);
        expect(filterCounts.get(oldMiss.url)).toBe(1);
    });

    test('deduplicates overlapping pages by URL', async () => {
        const historyItem = {
            title: "Meet Alice. Alice is impatient. – Marc's Blog",
            url: 'https://brooker.co.za/blog/2026/06/19/waiting.html',
        };
        const fetchPage = jest.fn()
            .mockResolvedValueOnce({
                history: [historyItem],
                nextEndTime: 10,
                done: false,
            })
            .mockResolvedValueOnce({
                history: [historyItem],
                nextEndTime: 9,
                done: false,
            });
        const pager = createHistoryPager(fetchPage);

        await expect(pager.search(items => items, 2))
            .resolves.toEqual([historyItem]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    test('discards an in-flight page after clear', async () => {
        let resolveFirstPage;
        const fetchPage = jest.fn()
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveFirstPage = resolve;
            }))
            .mockResolvedValueOnce({
                history: [{title: 'New session'}],
                nextEndTime: 0,
                done: true,
            });
        const pager = createHistoryPager(fetchPage);
        const oldSearch = pager.search(items => items, 1);

        pager.clear();
        resolveFirstPage({
            history: [{title: 'Old session'}],
            nextEndTime: 0,
            done: true,
        });

        await expect(oldSearch).resolves.toEqual([]);
        await expect(pager.search(items => items, 1))
            .resolves.toEqual([{title: 'New session'}]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    test('allows the same URL to be loaded again after clear', async () => {
        const historyItem = {
            title: 'Docs',
            url: 'https://example.com/docs',
        };
        const fetchPage = jest.fn().mockResolvedValue({
            history: [historyItem],
            nextEndTime: 0,
            done: true,
        });
        const pager = createHistoryPager(fetchPage);

        await expect(pager.search(items => items, 1))
            .resolves.toEqual([historyItem]);
        pager.clear();
        await expect(pager.search(items => items, 1))
            .resolves.toEqual([historyItem]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });
});
