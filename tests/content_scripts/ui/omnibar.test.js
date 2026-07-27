const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../../src/content_scripts/ui/frontend.html'), 'utf8');

import KeyboardUtils from 'src/content_scripts/common/keyboardUtils';

describe('ui omnibar', () => {

    let Mode, createOmnibar, omnibar, Front, runtime;
    beforeAll(async () => {
        global.chrome = {
            runtime: {
                sendMessage: jest.fn(),
                onMessage: {
                    addListener: jest.fn()
                },
                getURL: jest.fn()
            },
            storage: {
                local: {
                    get: jest.fn()
                }
            }
        }
        global.DOMRect = jest.fn();
        Element.prototype.scrollIntoView = jest.fn();
        window.focus = jest.fn();
        window.postMessage({surfingkeys_frontend_data: { action: "initFrontend", origin: document.location.origin }}, document.location.origin);

        document.documentElement.innerHTML = html.toString();
        runtime = require('src/content_scripts/common/runtime').runtime;
        createOmnibar = require('src/content_scripts/ui/omnibar').default;
        Mode = require('src/content_scripts/common/mode').default;
        Front = require('src/content_scripts/ui/frontend').default;

        const elmOmnibar = document.querySelector("#sk_omnibar");
        elmOmnibar.innerHTML = `
    <style></style>
    <div id="sk_omnibarSearchArea">
        <span class="prompt">
            <span class="separator">➤</span>
        </span>
        <input placeholder="">
        <span class="resultPage">
        </span>
    </div>
    <div id="sk_omnibarSearchResult">
        <ul>
            <li class="focused">
                <div class="title">🔖 WebAssembly - "Hello World" </div>
                <div class="url">https://www.tutorialspoint.com/webassembly/webassembly_hello_world.htm</div>
            </li>
            <li>
                <div class="title">🔖 From JavaScript to WebAssembly in three steps </div>
                <div class="url">https://engineering.q42.nl/webassembly/</div>
            </li>
            <li>
                <div class="title">🔥 GitHub </div>
                <div class="url">https://github.com/</div>
            </li>
        </ul>
    </div>
        `;
        elmOmnibar.querySelector('#sk_omnibarSearchResult>ul>li.focused').url = "https://www.tutorialspoint.com/webassembly/webassembly_hello_world.htm";
        document.body.appendChild(elmOmnibar);
        omnibar = createOmnibar(Front);
    });

    test('edit focus item in omnibar with editor', async () => {
        Front.showEditor = jest.fn();
        Mode.handleMapKey.call(omnibar, {
            sk_keyName: KeyboardUtils.encodeKeystroke("<Ctrl-i>")
        });
        await new Promise((r) => setTimeout(r, 100));
        expect(Front.showEditor).toHaveBeenCalledTimes(1);
    });

    test("toggle Omnibar's position", async () => {
        const elmOmnibarClass = document.getElementById("sk_omnibar").classList;
        window.postMessage({surfingkeys_frontend_data: { action: "openOmnibar", type: "URLs", extra: "getAllSites" }}, document.location.origin);
        await new Promise((r) => setTimeout(r, 100));
        expect(elmOmnibarClass.value).toContain('sk_omnibar_middle');
        Mode.handleMapKey.call(omnibar, {
            sk_keyName: KeyboardUtils.encodeKeystroke("<Ctrl-j>")
        });
        await new Promise((r) => setTimeout(r, 100));
        expect(elmOmnibarClass.value).toContain('sk_omnibar_bottom');
    });

    test('filters URL candidates with pinyin when enabled', () => {
        runtime.conf.omnibarPinyinSearch = true;
        const items = [{
            title: '微信',
            url: 'https://weixin.example',
        }];

        expect(omnibar.filterURLs(items, 'wx')).toEqual(items);
    });

    test('requests raw bookmarks for pinyin input', async () => {
        runtime.conf.omnibarPinyinSearch = true;
        localStorage.removeItem('surfingkeys.lastOpenBookmark');
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'getBookmarkFolders') {
                callback({folders: [{id: '0', title: ''}]});
            } else if (message.action === 'getBookmarks') {
                callback({bookmarks: []});
            }
        });

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'Bookmarks',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));

        chrome.runtime.sendMessage.mockClear();
        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getBookmarks',
                raw: true,
            }),
            expect.any(Function)
        );
        Front.hidePopup();
    });

    test('pages raw history for pinyin input', async () => {
        runtime.conf.omnibarPinyinSearch = true;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'getHistory') {
                callback({history: []});
            } else if (message.action === 'getHistoryPage') {
                callback({
                    history: [{
                        title: '微信',
                        url: 'https://example.com/wechat',
                    }],
                    nextEndTime: 0,
                    done: true,
                });
            }
        });

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'History',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));

        chrome.runtime.sendMessage.mockClear();
        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 250));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getHistoryPage',
                maxResults: 500,
            }),
            expect.any(Function)
        );
        expect(omnibar.getItems()).toEqual([
            expect.objectContaining({title: '微信'})
        ]);
        Front.hidePopup();
    });

    test('searches raw bookmarks and paged history in combined URLs', async () => {
        runtime.conf.omnibarPinyinSearch = true;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'getTabs') {
                callback({tabs: []});
            } else if (message.action === 'getTopSites') {
                callback({urls: []});
            } else if (message.action === 'getBookmarkFolders') {
                callback({folders: [{id: '0', title: ''}]});
            } else if (message.action === 'getAllURLs') {
                callback({urls: []});
            } else if (message.action === 'getBookmarks') {
                callback({
                    bookmarks: [{
                        id: '1',
                        parentId: '0',
                        title: '微信书签',
                        url: 'https://example.com/bookmark',
                    }]
                });
            } else if (message.action === 'getHistoryPage') {
                callback({
                    history: [{
                        title: '微信历史',
                        url: 'https://example.com/history',
                    }],
                    nextEndTime: 0,
                    done: true,
                });
            }
        });

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'URLs',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));

        chrome.runtime.sendMessage.mockClear();
        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 250));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getBookmarks',
                raw: true,
            }),
            expect.any(Function)
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getHistoryPage',
                maxResults: 500,
            }),
            expect.any(Function)
        );
        expect(omnibar.getItems()).toEqual([
            expect.objectContaining({title: '微信书签'}),
            expect.objectContaining({title: '微信历史'}),
        ]);
        Front.hidePopup();
    });

    test('does not render a stale pinyin history query', async () => {
        runtime.conf.omnibarPinyinSearch = true;
        let resolveHistoryPage;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'getHistory') {
                callback({history: []});
            } else if (message.action === 'getHistoryPage') {
                resolveHistoryPage = callback;
            }
        });

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'History',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));

        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 220));
        omnibar.input.value = 'zf';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 220));

        resolveHistoryPage({
            history: [
                {
                    title: '微信',
                    url: 'https://example.com/wechat',
                    visitCount: 2,
                },
                {
                    title: '支付',
                    url: 'https://example.com/payment',
                    visitCount: 1,
                },
            ],
            nextEndTime: 0,
            done: true,
        });
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(omnibar.getItems()).toEqual([
            expect.objectContaining({title: '支付'})
        ]);
        Front.hidePopup();
    });

    test('uses existing history APIs when pinyin search is disabled', async () => {
        runtime.conf.omnibarPinyinSearch = false;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'getHistory') {
                callback({history: []});
            } else if (message.action === 'getTabs') {
                callback({tabs: []});
            } else if (message.action === 'getTopSites') {
                callback({urls: []});
            } else if (message.action === 'getBookmarkFolders') {
                callback({folders: [{id: '0', title: ''}]});
            } else if (message.action === 'getAllURLs') {
                callback({urls: []});
            }
        });

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'History',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));
        chrome.runtime.sendMessage.mockClear();

        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 250));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getHistory',
                query: 'wx',
            }),
            expect.any(Function)
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({action: 'getHistoryPage'}),
            expect.any(Function)
        );
        Front.hidePopup();

        window.postMessage({
            surfingkeys_frontend_data: {
                action: 'openOmnibar',
                type: 'URLs',
            }
        }, document.location.origin);
        await new Promise(resolve => setTimeout(resolve, 20));
        chrome.runtime.sendMessage.mockClear();

        omnibar.input.value = 'wx';
        omnibar.input.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 250));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getAllURLs',
                query: 'wx',
            }),
            expect.any(Function)
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'getBookmarks',
                raw: true,
            }),
            expect.any(Function)
        );
        Front.hidePopup();
        runtime.conf.omnibarPinyinSearch = true;
    });
});
