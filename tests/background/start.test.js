const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

describe('background start', () => {
    let start, messageListener;

    beforeAll(async () => {
        global.chrome = {
            runtime: {
                getManifest: () => {
                    return {manifest_version: 2};
                },
                connectNative: () => {
                    return {
                        postMessage: jest.fn(),
                        onDisconnect: {
                            addListener: jest.fn()
                        },
                        onMessage: {
                            addListener: jest.fn()
                        }
                    };
                },
                setUninstallURL: jest.fn(),
                onMessage: {
                    addListener: (cb) => {
                        messageListener = cb;
                    }
                }
            },
            windows: {
                onFocusChanged: {
                    addListener: jest.fn()
                },
            },
            commands: {
                onCommand: {
                    addListener: jest.fn()
                },
            },
            tabs: {
                onCreated: {
                    addListener: jest.fn()
                },
                onMoved: {
                    addListener: jest.fn()
                },
                onActivated: {
                    addListener: jest.fn()
                },
                onAttached: {
                    addListener: jest.fn()
                },
                onDetached: {
                    addListener: jest.fn()
                },
                onRemoved: {
                    addListener: jest.fn()
                },
                onUpdated: {
                    addListener: jest.fn()
                }
            },
        }
        global.DOMRect = jest.fn();

        start = require('src/background/start.js').start;
        window.crypto = {
            getRandomValues: jest.fn(),
        };

        start({
            getLatestHistoryItem: (text, maxResults, cb) => {
                chrome.history.search({
                    startTime: 0,
                    text,
                    maxResults
                }, function(items) {
                    cb(items);
                });
            },
            _setNewTabUrl: jest.fn(),
            _getContainerName: jest.fn(),
            loadRawSettings: jest.fn(),
        });
    });

    test('unexpected fakeAction', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementationOnce(() => {
            /* empty */
        });
        messageListener({action: "fakeAction"}, null, null);
        expect(logSpy).toHaveBeenCalledWith("[unexpected runtime message] {\"action\":\"fakeAction\"}");
    });

    test('getHistory', async () => {
        const historyItems = [{
            "id": "1",
            "url": "https://www.aaa.com/",
            "title": "",
            "lastVisitTime": 1555206371136,
            "visitCount": 1
        }];
        chrome.history = {
            search: (detail, cb) => {
                cb(historyItems);
            }
        };
        const sendResponse = jest.fn();
        messageListener({action: "getHistory"}, null, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({"history": historyItems});
    });

    test('getHistoryPage', async () => {
        const historyItems = [{
            "id": "1",
            "url": "https://www.aaa.com/",
            "title": "",
            "lastVisitTime": 1555206371136,
            "visitCount": 1
        }];
        chrome.history = {
            search: jest.fn((detail, cb) => {
                cb(historyItems);
            })
        };
        const sendResponse = jest.fn();

        messageListener({
            action: "getHistoryPage",
            endTime: 1555206372000,
            maxResults: 500
        }, null, sendResponse);

        expect(chrome.history.search).toHaveBeenCalledWith({
            text: "",
            startTime: 0,
            endTime: 1555206372000,
            maxResults: 500
        }, expect.any(Function));
        expect(sendResponse).toHaveBeenCalledWith({
            history: historyItems,
            nextEndTime: 1555206371135.99,
            done: true
        });
    });

    test('getBookmarks raw', async () => {
        const bookmarks = [{
            id: "1",
            url: "https://weixin.example/",
            title: "微信"
        }];
        chrome.bookmarks = {
            search: jest.fn((query, cb) => cb(bookmarks)),
            getTree: jest.fn((cb) => cb([{children: []}]))
        };
        const sendResponse = jest.fn();

        messageListener({
            action: "getBookmarks",
            raw: true
        }, null, sendResponse);

        expect(chrome.bookmarks.search).toHaveBeenCalledWith({}, expect.any(Function));
        expect(sendResponse).toHaveBeenCalledWith({bookmarks});
    });

});
