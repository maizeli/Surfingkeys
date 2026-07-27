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
});
