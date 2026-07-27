import createPinyinSearch from 'src/content_scripts/ui/pinyinSearch';

const url = (title, target = `https://${encodeURIComponent(title)}.example`) => ({
    title,
    url: target,
});

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

    test('literal matches rank before pinyin subsequences', () => {
        const items = [
            url('微信'),
            url('wix literal'),
        ];

        expect(search.filter(items, 'wix', false, true).map(item => item.title))
            .toEqual(['wix literal', '微信']);
    });

    test('exact pinyin ranks before a pinyin prefix', () => {
        const items = [
            url('微信助手'),
            url('微信'),
        ];

        expect(search.filter(items, 'weixin', false, true).map(item => item.title))
            .toEqual(['微信', '微信助手']);
    });

    test('fewer skipped letters rank first', () => {
        const items = [
            url('文档消息'),
            url('微信'),
        ];

        expect(search.filter(items, 'wx', false, true).map(item => item.title))
            .toEqual(['微信', '文档消息']);
    });

    test('equal scores preserve candidate order', () => {
        const items = [
            url('微信 A'),
            url('微信 B'),
        ];

        expect(search.filter(items, 'wx', false, true)).toEqual(items);
    });

    test('raw matching keeps existing case sensitivity', () => {
        const items = [
            url('Docs'),
            url('docs'),
        ];

        expect(search.filter(items, 'Docs', true, true)).toEqual([items[0]]);
    });

    test('disabled mode uses the legacy filter', () => {
        const items = [
            url('微信'),
            url('weixin literal'),
        ];

        expect(search.filter(items, 'weixin', false, false)).toEqual([items[1]]);
    });

});
