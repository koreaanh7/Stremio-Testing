const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const https = require("https"); // Cần thiết cho Keep-Alive

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN; 

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// === OPTIMIZATION 1: AXIOS INSTANCE WITH KEEP-ALIVE ===
// Giúp tái sử dụng kết nối, giảm độ trễ SSL Handshake
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });
const client = axios.create({
    httpAgent: httpsAgent,
    httpsAgent: httpsAgent,
    timeout: 4000, // Giảm timeout xuống 4s (Fail fast)
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Connection': 'keep-alive'
    }
});

// === OPTIMIZATION 2: SIMPLE IN-MEMORY CACHE ===
// Lưu cache Metadata và TMDB Translate để không phải load lại khi đổi tập
const memoryCache = {
    tmdb: new Map(),
    meta: new Map()
};

// Hàm dọn cache định kỳ để tránh tràn RAM (giữ tối đa 500 items)
function pruneCache() {
    if (memoryCache.tmdb.size > 500) memoryCache.tmdb.clear();
    if (memoryCache.meta.size > 500) memoryCache.meta.clear();
}

const builder = new addonBuilder({
    id: "com.phim4k.vip.final.v43",
    version: "43.0.0",
    name: "Phim4K VIP (High Performance)",
    description: "Cached, Parallel Requests & Keep-Alive Optimized",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === MAPPING THỦ CÔNG (Minimal) ===
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

// === TMDB HELPER (WITH CACHE) ===
async function getTmdbVietnameseTitle(imdbId, type) {
    if (!TMDB_TOKEN) return null;
    if (memoryCache.tmdb.has(imdbId)) return memoryCache.tmdb.get(imdbId); // Hit Cache

    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_TOKEN}&external_source=imdb_id&language=vi-VN`;
        const res = await client.get(url);

        if (!res.data) return null;

        let results = [];
        if (type === 'movie') results = res.data.movie_results;
        else if (type === 'series') results = res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            if (viTitle && viTitle.toLowerCase() !== originalTitle.toLowerCase()) {
                console.log(`[TMDB] Found & Cached: "${viTitle}"`);
                memoryCache.tmdb.set(imdbId, viTitle);
                return viTitle;
            }
        }
    } catch (e) {
        // Silent error to keep speed up
    }
    return null;
}

// === CINEMETA HELPER (WITH CACHE) ===
async function getCinemetaMetadata(type, imdbId) {
    if (memoryCache.meta.has(imdbId)) return memoryCache.meta.get(imdbId); // Hit Cache

    try {
        const res = await client.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        const meta = (res.data && res.data.meta) ? res.data.meta : null;
        if (meta) {
            memoryCache.meta.set(imdbId, meta);
            pruneCache();
        }
        return meta;
    } catch (e) { return null; }
}

// === UTILS ===
function getHPKeywords(originalName) {
    const name = originalName.toLowerCase();
    if (name.includes("sorcerer") || name.includes("philosopher")) return ["philosopher", "sorcerer", "hòn đá", " 1 "];
    if (name.includes("chamber")) return ["chamber", "phòng chứa", " 2 "];
    if (name.includes("azkaban")) return ["azkaban", "tù nhân", " 3 "];
    if (name.includes("goblet")) return ["goblet", "chiếc cốc", " 4 "];
    if (name.includes("phoenix")) return ["phoenix", "phượng hoàng", " 5 "];
    if (name.includes("half-blood") || name.includes("half blood")) return ["half", "hoàng tử lai", " 6 "];
    if (name.includes("deathly hallows") && name.includes("part 1")) return ["part 1", "part.1", "pt.1", "phần 1", " 7 "];
    if (name.includes("deathly hallows") && name.includes("part 2")) return ["part 2", "part.2", "pt.2", "phần 2", " 8 "];
    return null;
}

// === CALCULATOR ===
function getMHAOffset(season) {
    switch (season) {
        case 2: return 14; case 3: return 40; case 4: return 65; 
        case 5: return 92; case 6: return 119; case 7: return 149; case 8: return 170;
        default: return 0;
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

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;
    if (originalName.toLowerCase().includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;
    
    let yearMatch = false;
    if (!hasYear) yearMatch = true;
    else {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            const tolerance = (type === 'series' || originalName.toLowerCase().includes('naruto')) ? 2 : 1;
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) || candidate.releaseInfo.includes((year-1).toString()) || candidate.releaseInfo.includes((year+1).toString());
        } else yearMatch = true;
    }
    if (serverClean.includes("harry potter colection")) yearMatch = true;
    if (!yearMatch) return false;

    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (mappedClean.length <= 3) {
                const strictRegex = new RegExp(`(^|\\s|\\W)${mappedClean}($|\\s|\\W)`, 'i');
                if (strictRegex.test(serverClean)) return true;
            } else {
                if (serverClean.includes(mappedClean)) return true;
            }
        }
    }

    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        if (qClean.length <= 9) {
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) return true;
        } else {
            if (serverClean.includes(qClean)) return true;
        }
    }
    return false;
}

function checkExactYear(candidate, targetYear) {
    const serverName = candidate.name;
    const yearMatches = serverName.match(/\d{4}/g);
    if (yearMatches) return yearMatches.some(y => parseInt(y) === targetYear);
    if (candidate.releaseInfo) return candidate.releaseInfo.includes(targetYear.toString());
    return false;
}

function passesSubtitleCheck(candidateName, originalName, queries) {
    const cleanOrig = normalizeForSearch(originalName);
    const cleanCand = normalizeForSearch(candidateName);
    if (originalName.includes(":")) {
        const parts = originalName.split(":");
        if (parts.length >= 2) {
            const subtitle = normalizeForSearch(parts[1]);
            if (subtitle.length > 3) {
                if (cleanOrig.includes("original sin") && !cleanCand.includes("original sin")) return false; 
            }
        }
    }
    return true;
}

builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("tt")) return { streams: [] };
    const t0 = Date.now(); // Start Timer

    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    // === OPTIMIZATION 3: PARALLEL STARTUP ===
    // Chạy đồng thời lấy Metadata và TMDB Map để tiết kiệm thời gian
    const [meta, tmdbVietnamese] = await Promise.all([
        getCinemetaMetadata(type, imdbId),
        getTmdbVietnameseTitle(imdbId, type)
    ]);

    if (!meta) return { streams: [] };

    const originalName = meta.name;
    const lowerOrig = originalName.toLowerCase();
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

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

    const queries = [];
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerOrig];
    if (mappingRaw) mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
    mappedVietnameseList.forEach(name => queries.push(name));

    if (tmdbVietnamese) {
        queries.push(tmdbVietnamese);
        mappedVietnameseList.push(tmdbVietnamese); 
    }

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
    console.log(`\n=== [${Date.now() - t0}ms] Xử lý (v43): "${originalName}" | Queries: ${uniqueQueries.length} ===`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    
    // === OPTIMIZATION 4: PARALLEL SEARCH REQUESTS ===
    const searchPromises = uniqueQueries.map(q => 
        client.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`)
            .catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    // Deduplicate by ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    const isHarryPotter = lowerOrig.includes("harry potter");
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName, uniqueQueries));

    if (mappedVietnameseList.length > 0) {
        const strictVietnameseMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        if (strictVietnameseMatches.length > 0) matchedCandidates = strictVietnameseMatches; 
    }

    if (matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !isDemonSlayer) {
        const oClean = normalizeForSearch(originalName);
        const goldenMatches = matchedCandidates.filter(m => {
            let mClean = normalizeForSearch(m.name);
            mClean = mClean.replace(year.toString(), "").trim();
            return mClean === oClean;
        });
        if (goldenMatches.length > 0 && matchedCandidates.length > goldenMatches.length) { }
    }
    
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !isDemonSlayer) {
        const exactMatches = matchedCandidates.filter(m => checkExactYear(m, year));
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    
    // === OPTIMIZATION 5: LIMIT CANDIDATES ===
    // Nếu không phải Harry Potter (collection) thì chỉ lấy tối đa 3 kết quả tốt nhất để xử lý
    // Giúp giảm số request gọi vào /stream/
    if (!isHarryPotter && matchedCandidates.length > 3) {
        matchedCandidates = matchedCandidates.slice(0, 3);
    }
    
    console.log(`[${Date.now() - t0}ms] Matched: ${matchedCandidates.length} items.`);

    let allStreams = [];
    const hpKeywords = getHPKeywords(originalName);

    const streamPromises = matchedCandidates.map(async (match) => {
        const fullId = match.id;
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
                const sRes = await client.get(streamUrl);
                
                if (sRes.data && sRes.data.streams) {
                    let streams = sRes.data.streams;
                    if (useSmartRegex && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) streams = streams.filter(s => titleRegex.test(s.title || s.name || ""));
                    } 
                    else if (isHarryPotter && hpKeywords) {
                        streams = streams.filter(s => {
                            const sTitle = (s.title || s.name || "").toLowerCase();
                            const hasKeyword = hpKeywords.some(kw => sTitle.includes(kw));
                            if (hpKeywords.includes("part 1") && (sTitle.includes("part 2") || sTitle.includes("pt.2"))) return false;
                            return hasKeyword;
                        });
                    }
                    return streams.map(s => ({
                        name: "Phim4K VIP", 
                        title: s.title || s.name,
                        url: s.url,
                        behaviorHints: { 
                            notWebReady: false, 
                            bingeGroup: "phim4k-vip",
                            proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } },
                            headers: { "User-Agent": "KSPlayer/1.0" }
                        }
                    }));
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
                const metaRes = await client.get(metaUrl);
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                if (useSmartRegex && targetEpisodeTitle) {
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    if (titleRegex) matchedVideos = matchedVideos.filter(vid => titleRegex.test(vid.title || vid.name || ""));
                } 
                else if (targetAbsoluteNumber) {
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        if (info && info.e === targetAbsoluteNumber) return true;
                        const regexAbs = new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                        return regexAbs.test(vidName);
                    });
                }
                else if (isDemonSlayer) {
                     if (season === 1) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (name.includes("hashira") || name.includes("geiko") || name.includes("mugen") || name.includes("yuukaku") || name.includes("katanakaji")) return false;
                            const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                            return epRegex.test(name);
                        });
                    } else if (season === 5) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (!name.includes("hashira") && !name.includes("geiko")) return false;
                            const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                            return epRegex.test(name);
                        });
                    } else {
                        matchedVideos = matchedVideos.filter(vid => {
                            const info = extractEpisodeInfo(vid.title || vid.name || "");
                            if (!info) return false;
                            return info.s === season && info.e === episode;
                        });
                    }
                }
                else {
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        if (!info) return false;
                        if (isRegularShow && season <= 2) {
                            if (!/(?:s|season)\s?0?1|1x/i.test(vidName) && season === 1) return false;
                            if (!/(?:s|season)\s?0?2|2x/i.test(vidName) && season === 2) return false;
                        }
                        if (info.s === 0) return season === 1 && info.e === episode; 
                        return info.s === season && info.e === episode;
                    });
                }

                let episodeStreams = [];
                // Process filtered videos
                const videoPromises = matchedVideos.map(async (vid) => {
                     try {
                        const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                        const sRes = await client.get(vidStreamUrl);
                        if (sRes.data && sRes.data.streams) {
                             return sRes.data.streams.map(s => {
                                 const streamTitle = s.title || s.name || "";
                                 if (useSmartRegex && targetEpisodeTitle) {
                                     const tr = createSmartRegex(targetEpisodeTitle);
                                     if (tr && !tr.test(streamTitle)) return null;
                                 } 
                                 else if (targetAbsoluteNumber) {
                                     const info = extractEpisodeInfo(streamTitle);
                                     if (info) { if (info.e !== targetAbsoluteNumber) return null; }
                                     else { if (!new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i').test(streamTitle)) return null; }
                                 }
                                 else if (isDemonSlayer) {
                                     const sName = streamTitle.toLowerCase();
                                     if (season === 1) {
                                         if (sName.includes("hashira") || sName.includes("geiko")) return null;
                                         if (!new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sName)) return null;
                                     } else if (season === 5) {
                                         if (!sName.includes("hashira") && !sName.includes("geiko")) return null;
                                         if (!new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sName)) return null;
                                     } else {
                                         const streamInfo = extractEpisodeInfo(streamTitle);
                                         if (!streamInfo || streamInfo.s !== season || streamInfo.e !== episode) return null;
                                     }
                                 }
                                 else {
                                     const streamInfo = extractEpisodeInfo(streamTitle);
                                     if (!streamInfo) return null;
                                     if (isRegularShow && season <= 2) {
                                        if (!new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(streamTitle)) return null;
                                     }
                                     if (streamInfo.s === 0) { if (season !== 1 || streamInfo.e !== episode) return null; }
                                     else { if (streamInfo.s !== season || streamInfo.e !== episode) return null; }
                                 }
                                 return {
                                    name: `Phim4K S${season}E${episode}`,
                                    title: (s.title || vid.title) + `\n[${match.name}]`,
                                    url: s.url,
                                    behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip", proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } }, headers: { "User-Agent": "KSPlayer/1.0" } }
                                 };
                             }).filter(Boolean);
                        }
                     } catch(e) { return []; }
                     return [];
                });

                const videosResults = await Promise.all(videoPromises);
                videosResults.forEach(v => episodeStreams = episodeStreams.concat(v));
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

    console.log(`[${Date.now() - t0}ms] Done. Found ${allStreams.length} streams.`);
    return { streams: allStreams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
