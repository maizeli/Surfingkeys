export default function createHistoryPager(fetchPage) {
    let items = [];
    let endTime;
    let done = false;
    let loading;
    let generation = 0;
    let seenURLs = new Set();

    function loadPage(searchGeneration) {
        if (!loading) {
            const request = fetchPage({
                endTime,
                maxResults: 500,
            }).then(response => {
                if (searchGeneration === generation) {
                    const newItems = response.history.filter(item => {
                        if (!item.url || seenURLs.has(item.url)) {
                            return !item.url;
                        }
                        seenURLs.add(item.url);
                        return true;
                    });
                    items = items.concat(newItems);
                    endTime = response.nextEndTime;
                    done = response.done || newItems.length === 0;
                }
                if (loading === request) {
                    loading = null;
                }
            });
            loading = request;
        }
        return loading;
    }

    return {
        async search(filter, limit, onUpdate) {
            const searchGeneration = generation;
            let matches = filter(items);
            let processedCount = items.length;
            while (matches.length < limit && !done) {
                await loadPage(searchGeneration);
                if (searchGeneration !== generation) {
                    return [];
                }
                matches = filter(matches.concat(items.slice(processedCount)));
                processedCount = items.length;
                if (onUpdate && matches.length && !done) {
                    onUpdate(matches.slice(0, limit));
                }
            }
            return matches.slice(0, limit);
        },

        clear() {
            generation++;
            items = [];
            endTime = undefined;
            done = false;
            loading = null;
            seenURLs = new Set();
        },
    };
}
