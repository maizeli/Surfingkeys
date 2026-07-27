import { pinyin, polyphonic } from 'pinyin-pro';
import { filterByTitleOrUrl } from '../../common/utils';

const asciiToken = /[a-z]/i;
const chineseText = /\p{Script=Han}/u;

function normalizePinyin(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compareValues(left, right) {
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return left[i] - right[i];
        }
    }
    return 0;
}

function compareAlignment(left, right) {
    return compareValues(
        [left.skipped, left.start, left.span, left.primaryPenalty],
        [right.skipped, right.start, right.span, right.primaryPenalty]
    );
}

function keepBest(states) {
    const best = new Map();
    states.forEach(state => {
        const key = `${state.queryIndex}:${state.started}:${state.suffix}`;
        const current = best.get(key);
        if (!current || compareAlignment(state, current) < 0) {
            best.set(key, state);
        }
    });
    return Array.from(best.values());
}

function advance(states, letter, query) {
    const advanced = [];

    states.forEach(state => {
        const complete = state.queryIndex === query.length;
        if (complete) {
            advanced.push(Object.assign({}, state, {suffix: true}));
        } else if (state.started) {
            advanced.push(Object.assign({}, state, {
                skipped: state.skipped + 1,
                span: state.span + 1,
            }));
        } else {
            advanced.push(Object.assign({}, state, {
                start: state.start + 1,
            }));
        }

        if (!complete && letter === query[state.queryIndex]) {
            advanced.push(Object.assign({}, state, {
                queryIndex: state.queryIndex + 1,
                started: true,
                span: state.span + 1,
            }));
        }
    });

    return keepBest(advanced);
}

function matchLayers(layers, query) {
    let states = [{
        queryIndex: 0,
        started: false,
        skipped: 0,
        start: 0,
        span: 0,
        suffix: false,
        primaryPenalty: 0,
    }];

    layers.forEach(layer => {
        const next = [];
        layer.forEach(option => {
            let optionStates = states.map(state => Object.assign({}, state, {
                primaryPenalty: state.primaryPenalty + (option.primary ? 0 : 1),
            }));
            Array.from(option.value).forEach(letter => {
                optionStates = advance(optionStates, letter, query);
            });
            next.push(...optionStates);
        });
        states = keepBest(next);
    });

    const matches = states.filter(state => state.queryIndex === query.length && state.started);
    if (!matches.length) {
        return null;
    }

    return matches.map(state => {
        let tier = 3;
        if (state.skipped === 0) {
            tier = state.start === 0 && !state.suffix ? 1 : 2;
        }
        return {
            tier,
            skipped: state.skipped,
            start: state.start,
            span: state.span,
            primaryPenalty: state.primaryPenalty,
        };
    }).sort((left, right) => compareValues(
        [left.tier, left.skipped, left.start, left.span, left.primaryPenalty],
        [right.tier, right.skipped, right.start, right.span, right.primaryPenalty]
    ))[0];
}

function createLayers(primary, alternatives, initials) {
    return alternatives.map((readings, index) => {
        const primaryValue = normalizePinyin(primary[index] || '');
        const values = [primaryValue].concat(readings.map(normalizePinyin));
        const unique = Array.from(new Set(values));

        return unique.map(value => {
            const normalized = initials && value.length ? value[0] : value;
            const normalizedPrimary = initials && primaryValue.length
                ? primaryValue[0]
                : primaryValue;
            return {
                value: normalized,
                primary: normalized === normalizedPrimary,
            };
        }).filter((option, optionIndex, options) => {
            return options.findIndex(candidate => candidate.value === option.value) === optionIndex;
        });
    });
}

function createPhoneticData(title) {
    if (!chineseText.test(title)) {
        return null;
    }

    const primary = pinyin(title, {
        toneType: 'none',
        type: 'array',
    });
    const alternatives = polyphonic(title, {
        toneType: 'none',
        type: 'array',
    });

    return {
        full: createLayers(primary, alternatives, false),
        initials: createLayers(primary, alternatives, true),
    };
}

function rawTokenScore(item, token, caseSensitive) {
    const title = item.title || '';
    const url = item.url || '';
    const needle = caseSensitive ? token : token.toLowerCase();
    const fields = caseSensitive
        ? [title, url]
        : [title.toLowerCase(), url.toLowerCase()];
    const starts = fields
        .map(field => field.indexOf(needle))
        .filter(index => index >= 0);

    if (!starts.length) {
        return null;
    }

    return {
        tier: 0,
        skipped: 0,
        start: Math.min(...starts),
        span: token.length,
    };
}

function bestPinyinScore(data, token) {
    if (!data || !token.length) {
        return null;
    }

    const matches = [
        matchLayers(data.full, token),
        matchLayers(data.initials, token),
    ].filter(Boolean);

    if (!matches.length) {
        return null;
    }

    return matches.sort((left, right) => compareValues(
        [left.tier, left.skipped, left.start, left.span, left.primaryPenalty],
        [right.tier, right.skipped, right.start, right.span, right.primaryPenalty]
    ))[0];
}

export default function createPinyinSearch() {
    const cache = new Map();

    return {
        filter(items, query, caseSensitive, enabled) {
            if (!enabled) {
                return filterByTitleOrUrl(items, query, caseSensitive);
            }

            const tokens = query.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) {
                return items;
            }

            return items.map((item, index) => {
                const tokenScores = tokens.map(token => {
                    const raw = rawTokenScore(item, token, caseSensitive);
                    if (raw || !asciiToken.test(token)) {
                        return raw;
                    }

                    const title = item.title || '';
                    if (!cache.has(title)) {
                        cache.set(title, createPhoneticData(title));
                    }
                    return bestPinyinScore(cache.get(title), normalizePinyin(token));
                });

                if (tokenScores.some(score => score === null)) {
                    return null;
                }

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
            }).filter(Boolean).sort((left, right) => {
                return compareValues(left.score, right.score);
            }).map(entry => entry.item);
        },

        clear() {
            cache.clear();
        },
    };
}
