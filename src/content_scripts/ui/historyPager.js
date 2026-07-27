export default function createHistoryPager(fetchPage) {
    let items = [];
    let endTime;
    let done = false;
    let loading;

    function loadPage() {
        if (!loading) {
            loading = fetchPage({
                endTime,
                maxResults: 500,
            }).then(response => {
                items = items.concat(response.history);
                endTime = response.nextEndTime;
                done = response.done;
                loading = null;
            });
        }
        return loading;
    }

    return {
        async search(filter, limit) {
            let matches = filter(items);
            while (matches.length < limit && !done) {
                await loadPage();
                matches = filter(items);
            }
            return matches.slice(0, limit);
        },

        clear() {
            items = [];
            endTime = undefined;
            done = false;
            loading = null;
        },
    };
}
