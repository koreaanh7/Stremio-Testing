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
    id: "com.phim4k.vip.final.v42",
    version: "42.0.0",
    name: "Phim4K VIP (TMDB Lean)",
    description: "TMDB Auto-Translate + Strict Logic for Special Cases Only",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (RÚT GỌN - CHỈ GIỮ CA KHÓ/ĐẶC BIỆT) ===
const VIETNAMESE_MAPPING = {

    // --- HARRY POTTER COLLECTION (Giữ nguyên vì server gộp) ---
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

// === TMDB HELPER ===
async function getTmdbVietnameseTitle(imdbId, type) {
    if (!TMDB_TOKEN) return null;
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_TOKEN}&external_source=imdb_id&language=vi-VN`;
        const res = await axios.get(url, { timeout: 3000 }); 

        if (!res.data) return null;

        let results = [];
        if (type === 'movie') results = res.data.movie_results;
        else if (type === 'series') results = res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            if (viTitle && viTitle.toLowerCase() !== originalTitle.toLowerCase()) {
                console.log(`[TMDB] Found Vietnamese title for ${imdbId}: "${viTitle}"`);
                return viTitle;
            }
        }
    } catch (e) {
        console.error(`[TMDB Error] Could not fetch for ${imdbId}: ${e.message}`);
    }
    return null;
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

// === CALCULATOR: ABSOLUTE NUMBERING LOGIC ===
function getMHAOffset(season) {
    switch (season) {
        case 2: return 14;
        case 3: return 40;
        case 4: return 65;
        case 5: return 92;
        case 6: return 119;
        case 7: return 149;
        case 8: return 170;
        default: return 0;
    }
}

function getNarutoShippudenOffset(season) {
    switch (season) {
        case 2: return 32;
        case 3: return 53;
        case 4: return 71;
        case 5: return 88;
        case 6: return 112;
        case 7: return 143;
        case 8: return 151;
        case 9: return 175;
        case 10: return 196;
        case 11: return 222;
        case 12: return 242;
        case 13: return 260;
        case 14: return 295;
        case 15: return 320;
        case 16: return 348;
        case 17: return 361;
        case 18: return 393;
        case 19: return 413;
        case 20: return 431;
        case 21: return 450;
        case 22: return 458;
        default: return 0;
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
        const offset = getMHAOffset(season);
        return offset + episode;
    }

    if (lowerTitle.includes("naruto shippuden") || lowerTitle.includes("naruto: shippuden")) {
        if (season === 1) return null;
        const offset = getNarutoShippudenOffset(season);
        return offset + episode;
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
    let cleanName = episodeName.replace(/['"!?,.]/g, ""); 
    cleanName = cleanName.trim();
    if (cleanName.length === 0) return null;
    const words = cleanName.split(/\s+/).map(w => w.replace(/[.*+^${}()|[\]\\]/g, '\\$&'));
    const pattern = words.join("[\\W_]+");
    return new RegExp(pattern, 'i');
}

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // Bypass check for Special Cases
    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;
    if (originalName.toLowerCase().includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;
    
    // Year Check
    let yearMatch = false;
    if (!hasYear) yearMatch = true;
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
    if (serverClean.includes("harry potter colection")) yearMatch = true;
    if (!yearMatch) return false;

    // Check Mapping
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

    // Check Queries
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
                if (cleanOrig.includes("original sin") && !cleanCand.includes("original sin")) {
                    return false; 
                }
            }
        }
    }
    return true;
}

builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("tt")) return { streams: [] };

    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) return { streams: [] };

    const originalName = meta.name;
    const lowerOrig = originalName.toLowerCase();
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    // === SPECIAL DETECTION ===
    const isTomAndJerry = lowerOrig.includes("tom and jerry");
    const isRegularShow = lowerOrig.includes("regular show");
    const isDemonSlayer = lowerOrig.includes("demon slayer") || lowerOrig.includes("kimetsu no yaiba");
    const isOppenheimer = lowerOrig === "oppenheimer";

    // [LOGIC 1] Smart Regex
    let useSmartRegex = false;
    let targetEpisodeTitle = null;
    if (isTomAndJerry || (isRegularShow && season >= 3)) {
        useSmartRegex = true;
        if (meta.videos && season !== null && episode !== null) {
            const currentVideo = meta.videos.find(v => v.season === season && v.episode === episode);
            if (currentVideo) targetEpisodeTitle = currentVideo.name || currentVideo.title;
        }
    }

    // [LOGIC 2] ABSOLUTE NUMBERING CALCULATOR
    let targetAbsoluteNumber = null;
    if (season && episode && type === 'series') {
        targetAbsoluteNumber = getAbsoluteTarget(originalName, season, episode);
    }

    const queries = [];
    
    // --- STEP 1: LOAD MANUAL MAPPING (PRIORITY/FIXES) ---
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerOrig];
    if (mappingRaw) mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
    mappedVietnameseList.forEach(name => queries.push(name));

    // --- STEP 2: LOAD TMDB MAPPING (AUTO-TRANSLATE) ---
    const tmdbVietnamese = await getTmdbVietnameseTitle(imdbId, type);
    if (tmdbVietnamese) {
        queries.push(tmdbVietnamese);
        mappedVietnameseList.push(tmdbVietnamese); 
    }

    // --- STEP 3: LOAD STANDARD QUERIES ---
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
    console.log(`\n=== Xử lý (v42): "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`[Queries] ${uniqueQueries.join(" | ")}`);

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

    const isHarryPotter = lowerOrig.includes("harry potter");
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName, uniqueQueries));

    if (mappedVietnameseList.length > 0) {
        const strictVietnameseMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        if (strictVietnameseMatches.length > 0) matchedCandidates = strictVietnameseMatches; 
    }

    if (matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !lowerOrig.includes("game of thrones") && !isDemonSlayer) {
        const oClean = normalizeForSearch(originalName);
        const goldenMatches = matchedCandidates.filter(m => {
            let mClean = normalizeForSearch(m.name);
            mClean = mClean.replace(year.toString(), "").trim();
            return mClean === oClean;
        });
        if (goldenMatches.length > 0 && matchedCandidates.length > goldenMatches.length) { }
    }
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter && !useSmartRegex && !targetAbsoluteNumber && !lowerOrig.includes("game of thrones") && !isDemonSlayer) {
        const exactMatches = matchedCandidates.filter(m => checkExactYear(m, year));
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    // Extended Isolation Check (for short titles like "It", "Up", "From")
    if (cleanName.length <= 9 && matchedCandidates.length > 0 && !useSmartRegex) {
        matchedCandidates = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            const qClean = normalizeForSearch(originalName);
            if (mappedVietnameseList.length > 0) {
                const matchesMap = mappedVietnameseList.some(map => {
                    const mapClean = normalizeForSearch(map);
                    return mClean.includes(mapClean);
                });
                if (matchesMap) return true;
            }
            const endsWithExact = new RegExp(`[\\s]${qClean}$`, 'i').test(mClean);
            const isExact = mClean === qClean || mClean === `${qClean} ${year}`;
            const startsWithExact = new RegExp(`^${qClean}[\\s]`, 'i').test(mClean);
            return endsWithExact || isExact || startsWithExact;
        });
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    console.log(`-> KẾT QUẢ CUỐI CÙNG:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name}`));

    let allStreams = [];
    const hpKeywords = getHPKeywords(originalName);

    const streamPromises = matchedCandidates.map(async (match) => {
        const fullId = match.id;
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                
                if (sRes.data && sRes.data.streams) {
                    let streams = sRes.data.streams;
                    if (useSmartRegex && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) {
                            streams = streams.filter(s => {
                                const sName = s.title || s.name || "";
                                return titleRegex.test(sName);
                            });
                        }
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
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // --- RAM PRE-FILTER ---
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
                        if (regexAbs.test(vidName)) return true;
                        return false;
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
                    } 
                    else if (season === 5) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (!name.includes("hashira") && !name.includes("geiko")) return false;
                            const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                            return epRegex.test(name);
                        });
                    }
                    else {
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
                            const strictSeasonRegex = new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i');
                            if (!strictSeasonRegex.test(vidName)) return false;
                        }
                        if (info.s === 0) return season === 1 && info.e === episode; 
                        return info.s === season && info.e === episode;
                    });
                }

                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            const streamTitle = s.title || s.name || "";
                            
                            // --- FINAL STRICT FILTER ---
                            if (useSmartRegex && targetEpisodeTitle) {
                                const titleRegex = createSmartRegex(targetEpisodeTitle);
                                if (titleRegex && !titleRegex.test(streamTitle)) return;
                            } 
                            else if (targetAbsoluteNumber) {
                                const info = extractEpisodeInfo(streamTitle);
                                if (info) {
                                    if (info.e !== targetAbsoluteNumber) return;
                                } else {
                                    const regexAbs = new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                                    if (!regexAbs.test(streamTitle)) return;
                                }
                            }
                            else if (isDemonSlayer) {
                                const sName = streamTitle.toLowerCase();
                                if (season === 1) {
                                     if (sName.includes("hashira") || sName.includes("geiko")) return;
                                     const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                                     if (!epRegex.test(sName)) return;
                                }
                                else if (season === 5) {
                                    if (!sName.includes("hashira") && !sName.includes("geiko")) return;
                                    const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                                    if (!epRegex.test(sName)) return;
                                }
                                else {
                                    const streamInfo = extractEpisodeInfo(streamTitle);
                                    if (!streamInfo || streamInfo.s !== season || streamInfo.e !== episode) return;
                                }
                            }
                            else {
                                const streamInfo = extractEpisodeInfo(streamTitle);
                                if (!streamInfo) return; 
                                if (isRegularShow && season <= 2) {
                                    const strictSeasonRegex = new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i');
                                    if (!strictSeasonRegex.test(streamTitle)) return;
                                }
                                if (streamInfo.s === 0) { 
                                    if (season !== 1) return;
                                    if (streamInfo.e !== episode) return;
                                } else {
                                    if (streamInfo.s !== season || streamInfo.e !== episode) return;
                                }
                            }

                            episodeStreams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: (s.title || vid.title) + `\n[${match.name}]`,
                                url: s.url,
                                behaviorHints: { 
                                    notWebReady: false, 
                                    bingeGroup: "phim4k-vip",
                                    proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } },
                                    headers: { "User-Agent": "KSPlayer/1.0" }
                                }
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

async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });





