export default function createHistoryPager(fetchPage) {
    let items = [];
    let endTime;
    let done = false;
    let loading;
    let generation = 0;

    function loadPage(searchGeneration) {
        if (!loading) {
            const request = fetchPage({
                endTime,
                maxResults: 500,
            }).then(response => {
                if (searchGeneration === generation) {
                    items = items.concat(response.history);
                    endTime = response.nextEndTime;
                    done = response.done;
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
        async search(filter, limit) {
            const searchGeneration = generation;
            let matches = filter(items);
            while (matches.length < limit && !done) {
                await loadPage(searchGeneration);
                if (searchGeneration !== generation) {
                    return [];
                }
                matches = filter(items);
            }
            return matches.slice(0, limit);
        },

        clear() {
            generation++;
            items = [];
            endTime = undefined;
            done = false;
            loading = null;
        },
    };
}
