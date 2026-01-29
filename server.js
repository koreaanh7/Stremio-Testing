const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN; // API KEY (v3)

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.vip.final.v43",
    version: "43.0.0",
    name: "Phim4K VIP (Speed - Parallel)",
    description: "Parallel TMDB & Cinemeta fetching for max speed",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (Clean) ===
const VIETNAMESE_MAPPING = {
    "oppenheimer": ["oppenheimer 2023"],
    "harry potter and the sorcerer's stone": ["harry potter colection"],
    "harry potter and the philosopher's stone": ["harry potter colection"],
    "harry potter and the chamber of secrets": ["harry potter colection"],
    "harry potter and the prisoner of azkaban": ["harry potter colection"],
    "harry potter and the goblet of fire": ["harry potter colection"],
    "harry potter and the order of the phoenix": ["harry potter colection"],
    "harry potter and the half-blood prince": ["harry potter colection"],
    "harry potter and the deathly hallows: part 1": ["harry potter colection"],
    "harry potter and the deathly hallows: part 2": ["harry potter colection"],
};

// === ASYNC DATA FETCHING ===

// Fetch Cinemeta (Metadata gốc)
async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { timeout: 3000 });
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

// Fetch TMDB (Tên tiếng Việt)
async function getTmdbVietnameseTitle(imdbId, type) {
    if (!TMDB_TOKEN) return null;
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_TOKEN}&external_source=imdb_id&language=vi-VN`;
        const res = await axios.get(url, { timeout: 2500 }); // Timeout ngắn hơn để fail-fast

        if (!res.data) return null;

        let results = [];
        if (type === 'movie') results = res.data.movie_results;
        else if (type === 'series') results = res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            if (viTitle && viTitle.toLowerCase() !== originalTitle.toLowerCase()) {
                return viTitle;
            }
        }
    } catch (e) {
        // Silent error để không ảnh hưởng luồng chính
    }
    return null;
}

// === CALCULATOR LOGIC ===
function getMHAOffset(season) {
    switch (season) {
        case 2: return 14; case 3: return 40; case 4: return 65;
        case 5: return 92; case 6: return 119; case 7: return 149;
        case 8: return 170; default: return 0;
    }
}
function getNarutoShippudenOffset(season) {
    switch (season) {
        case 2: return 32; case 3: return 53; case 4: return 71; case 5: return 88;
        case 6: return 112; case 7: return 143; case 8: return 151; case 9: return 175;
        case 10: return 196; case 11: return 222; case 12: return 242; case 13: return 260;
        case 14: return 295; case 15: return 320; case 16: return 348; case 17: return 361;
        case 18: return 393; case 19: return 413; case 20: return 431; case 21: return 450;
        case 22: return 458; default: return 0;
    }
}
function getAbsoluteTarget(title, season, episode) {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("attack on titan")) {
        if (season === 1) return null;
        if (season === 2) return 25 + episode;
        if (season === 3) return 37 + episode;
        if (season === 4) return 59 + episode;
    }
    if (lowerTitle.includes("my hero academia") || lowerTitle.includes("boku no hero")) {
        if (season === 1) return null;
        return getMHAOffset(season) + episode;
    }
    if (lowerTitle.includes("naruto shippuden") || lowerTitle.includes("naruto: shippuden")) {
        if (season === 1) return null;
        return getNarutoShippudenOffset(season) + episode;
    }
    return null;
}

// === UTILS ===
function normalizeForSearch(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") 
        .replace(/['":\-.()\[\]?,]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}
function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    const matchSE = name.match(/(?:s|season)[\s\.]?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)[\s\.]?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };
    const matchE = name.match(/(?:e|ep|episode|tap|#)[\s\.]?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };
    return null;
}
function createSmartRegex(episodeName) {
    if (!episodeName) return null;
    let cleanName = episodeName.replace(/['"!?,.]/g, "").trim();
    if (cleanName.length === 0) return null;
    const words = cleanName.split(/\s+/).map(w => w.replace(/[.*+^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(words.join("[\\W_]+"), 'i');
}
function getHPKeywords(originalName) {
    const name = originalName.toLowerCase();
    if (name.includes("sorcerer") || name.includes("philosopher")) return ["philosopher", "sorcerer", "hòn đá", " 1 "];
    if (name.includes("chamber")) return ["chamber", "phòng chứa", " 2 "];
    if (name.includes("azkaban")) return ["azkaban", "tù nhân", " 3 "];
    if (name.includes("goblet")) return ["goblet", "chiếc cốc", " 4 "];
    if (name.includes("phoenix")) return ["phoenix", "phượng hoàng", " 5 "];
    if (name.includes("half-blood")) return ["half", "hoàng tử lai", " 6 "];
    if (name.includes("deathly hallows") && name.includes("part 1")) return ["part 1", "part.1", "pt.1", "phần 1", " 7 "];
    if (name.includes("deathly hallows") && name.includes("part 2")) return ["part 2", "part.2", "pt.2", "phần 2", " 8 "];
    return null;
}
function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;
    if (originalName.toLowerCase().includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;
    
    let yearMatch = false;
    if (!hasYear || serverClean.includes("harry potter colection")) yearMatch = true;
    else {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            const tolerance = (type === 'series' || originalName.toLowerCase().includes('naruto')) ? 2 : 1;
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) 
                     || candidate.releaseInfo.includes((year-1).toString()) 
                     || candidate.releaseInfo.includes((year+1).toString());
        } else yearMatch = true;
    }
    if (!yearMatch) return false;

    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (mappedClean.length <= 3) {
                const strictRegex = new RegExp(`(^|\\s|\\W)${mappedClean}($|\\s|\\W)`, 'i');
                if (strictRegex.test(serverClean)) return true;
            } else if (serverClean.includes(mappedClean)) return true;
        }
    }
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        if (qClean.length <= 9) {
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) return true;
        } else if (serverClean.includes(qClean)) return true;
    }
    return false;
}

// === MAIN HANDLER ===
builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("tt")) return { streams: [] };
    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    // --- PARALLEL EXECUTION: START ---
    // Bắn request lấy Cinemeta và TMDB cùng lúc.
    const metaPromise = getCinemetaMetadata(type, imdbId);
    const tmdbPromise = getTmdbVietnameseTitle(imdbId, type);

    // Chờ cả 2 xong (hoặc fail).
    const [meta, tmdbVietnamese] = await Promise.all([metaPromise, tmdbPromise]);
    // --- PARALLEL EXECUTION: END ---

    if (!meta) return { streams: [] };

    const originalName = meta.name;
    const lowerOrig = originalName.toLowerCase();
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    // Special logic setup
    const isTomAndJerry = lowerOrig.includes("tom and jerry");
    const isRegularShow = lowerOrig.includes("regular show");
    const isDemonSlayer = lowerOrig.includes("demon slayer") || lowerOrig.includes("kimetsu no yaiba");
    
    let useSmartRegex = false;
    let targetEpisodeTitle = null;
    if (isTomAndJerry || (isRegularShow && season >= 3)) {
        useSmartRegex = true;
        if (meta.videos && season !== null && episode !== null) {
            const currentVideo = meta.videos.find(v => v.season === season && v.episode === episode);
            if (currentVideo) targetEpisodeTitle = currentVideo.name || currentVideo.title;
        }
    }

    let targetAbsoluteNumber = null;
    if (season && episode && type === 'series') {
        targetAbsoluteNumber = getAbsoluteTarget(originalName, season, episode);
    }

    // Build Queries
    const queries = [];
    let mappedVietnameseList = [];
    
    // 1. Manual Map
    const mappingRaw = VIETNAMESE_MAPPING[lowerOrig];
    if (mappingRaw) {
        const list = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
        mappedVietnameseList = mappedVietnameseList.concat(list);
        list.forEach(name => queries.push(name));
    }
    // 2. TMDB Map (Fetched in parallel above)
    if (tmdbVietnamese) {
        queries.push(tmdbVietnamese);
        mappedVietnameseList.push(tmdbVietnamese);
        console.log(`[TMDB] Auto-mapped: ${tmdbVietnamese}`);
    }

    // 3. Standard queries
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerOrig) queries.push(cleanName);
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') queries.push(splitName);
    }
    if (/\d/.test(cleanName) && cleanName.includes(" ")) queries.push(cleanName.replace(/\s/g, ""));
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Scan (v43): "${originalName}" (${year}) ===`);
    
    // Search Phim4K
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    // Filter Logic
    const isHarryPotter = lowerOrig.includes("harry potter");
    
    // Subtitle Check
    matchedCandidates = matchedCandidates.filter(m => {
        const cleanCand = normalizeForSearch(m.name);
        if (originalName.includes(":")) {
            const parts = originalName.split(":");
            if (parts.length >= 2) {
                const subtitle = normalizeForSearch(parts[1]);
                if (subtitle.length > 3 && cleanName.includes("original sin") && !cleanCand.includes("original sin")) return false;
            }
        }
        return true;
    });

    if (mappedVietnameseList.length > 0) {
        const strictMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        if (strictMatches.length > 0) matchedCandidates = strictMatches; 
    }

    if (matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !isDemonSlayer) {
        const oClean = normalizeForSearch(originalName);
        const goldenMatches = matchedCandidates.filter(m => 
            normalizeForSearch(m.name).replace(year.toString(), "").trim() === oClean
        );
        if (goldenMatches.length > 0 && matchedCandidates.length > goldenMatches.length) { }
    }
    
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !isDemonSlayer) {
        const exactMatches = matchedCandidates.filter(m => {
             const yearMatches = m.name.match(/\d{4}/g);
             if (yearMatches) return yearMatches.some(y => parseInt(y) === year);
             if (m.releaseInfo) return m.releaseInfo.includes(year.toString());
             return false;
        });
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    if (cleanName.length <= 9 && matchedCandidates.length > 0 && !useSmartRegex) {
        matchedCandidates = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            const qClean = normalizeForSearch(originalName);
            if (mappedVietnameseList.length > 0 && mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)))) return true;
            return new RegExp(`[\\s]${qClean}$`, 'i').test(mClean) || mClean === qClean || mClean === `${qClean} ${year}` || new RegExp(`^${qClean}[\\s]`, 'i').test(mClean);
        });
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    
    let allStreams = [];
    const hpKeywords = getHPKeywords(originalName);

    // Fetch Streams
    const streamPromises = matchedCandidates.map(async (match) => {
        const fullId = match.id;
        try {
            if (type === 'movie') {
                const sRes = await axios.get(`${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    let streams = sRes.data.streams;
                    if (useSmartRegex && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) streams = streams.filter(s => titleRegex.test(s.title || s.name || ""));
                    } else if (isHarryPotter && hpKeywords) {
                        streams = streams.filter(s => {
                            const sTitle = (s.title || s.name || "").toLowerCase();
                            const hasKeyword = hpKeywords.some(kw => sTitle.includes(kw));
                            if (hpKeywords.includes("part 1") && (sTitle.includes("part 2") || sTitle.includes("pt.2"))) return false;
                            return hasKeyword;
                        });
                    }
                    return streams.map(s => ({
                        name: "Phim4K VIP", title: s.title || s.name, url: s.url,
                        behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip", proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } }, headers: { "User-Agent": "KSPlayer/1.0" } }
                    }));
                }
            } else if (type === 'series') {
                const metaRes = await axios.get(`${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];
                let matchedVideos = metaRes.data.meta.videos;

                if (useSmartRegex && targetEpisodeTitle) {
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    if (titleRegex) matchedVideos = matchedVideos.filter(vid => titleRegex.test(vid.title || vid.name || ""));
                } else if (targetAbsoluteNumber) {
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        return (info && info.e === targetAbsoluteNumber) || new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i').test(vid.title || vid.name || "");
                    });
                } else if (isDemonSlayer) {
                     if (season === 1) matchedVideos = matchedVideos.filter(vid => {
                         const name = (vid.title || vid.name || "").toLowerCase();
                         return !name.includes("hashira") && !name.includes("geiko") && new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                     });
                     else if (season === 5) matchedVideos = matchedVideos.filter(vid => {
                         const name = (vid.title || vid.name || "").toLowerCase();
                         return (name.includes("hashira") || name.includes("geiko")) && new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                     });
                     else matchedVideos = matchedVideos.filter(vid => {
                         const info = extractEpisodeInfo(vid.title || vid.name || "");
                         return info && info.s === season && info.e === episode;
                     });
                } else {
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        if (isRegularShow && season <= 2 && !new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(vid.title || vid.name || "")) return false;
                        if (info.s === 0) return season === 1 && info.e === episode;
                        return info.s === season && info.e === episode;
                    });
                }

                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const sRes = await axios.get(`${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            const st = s.title || s.name || "";
                            if (useSmartRegex && targetEpisodeTitle) {
                                const tr = createSmartRegex(targetEpisodeTitle);
                                if (tr && !tr.test(st)) return;
                            } else if (targetAbsoluteNumber) {
                                const info = extractEpisodeInfo(st);
                                if ((info && info.e !== targetAbsoluteNumber) || (!info && !new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i').test(st))) return;
                            } else if (isDemonSlayer) {
                                const sn = st.toLowerCase();
                                if (season === 1 && (sn.includes("hashira") || sn.includes("geiko") || !new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sn))) return;
                                if (season === 5 && ((!sn.includes("hashira") && !sn.includes("geiko")) || !new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sn))) return;
                                if (season !== 1 && season !== 5) {
                                    const si = extractEpisodeInfo(st);
                                    if (!si || si.s !== season || si.e !== episode) return;
                                }
                            } else {
                                const si = extractEpisodeInfo(st);
                                if (!si) return;
                                if (isRegularShow && season <= 2 && !new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(st)) return;
                                if (si.s === 0 && (season !== 1 || si.e !== episode)) return;
                                if (si.s !== 0 && (si.s !== season || si.e !== episode)) return;
                            }
                            episodeStreams.push({
                                name: `Phim4K S${season}E${episode}`, title: (s.title || vid.title) + `\n[${match.name}]`, url: s.url,
                                behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip", proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } }, headers: { "User-Agent": "KSPlayer/1.0" } }
                            });
                        });
                    }
                }
                return episodeStreams;
            }
        } catch (e) { return []; }
        return [];
    });

    const results = await Promise.all(streamPromises);
    results.forEach(streams => allStreams = allStreams.concat(streams));
    allStreams.sort((a, b) => {
        const qA = a.title.includes("4K") ? 3 : (a.title.includes("1080") ? 2 : 1);
        const qB = b.title.includes("4K") ? 3 : (b.title.includes("1080") ? 2 : 1);
        return qB - qA;
    });
    return { streams: allStreams };
});

async function getCinemetaMetadata(type, imdbId) { // Fallback helper if needed locally, but we used the async one above
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
