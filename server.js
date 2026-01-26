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
    name: "Phim4K VIP (Strict & Fast)",
    description: "TMDB Strict Mode + Single Source Performance Boost",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (Giữ lại các case đặc biệt khó) ===
const VIETNAMESE_MAPPING = {
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    "demon slayer: kimetsu no yaiba": ["thanh gươm diệt quỷ", "kimetsu no yaiba"],
    "shadow": ["vô ảnh"], 
    "boss": ["đại ca ha ha ha"], 
    "flow": ["lạc trôi", "straume"], 
    "taxi driver": ["tài xế ẩn danh", "taxi driver"],
    "9": ["chiến binh số 9", "9"], 
    "the neverending story": ["câu chuyện bất tận"],
    "from": ["bẫy"], 
    "dexter: original sin": ["dexter original sin", "dexter trọng tội"],
    "12 monkeys": ["12 con khỉ", "twelve monkeys"],
    "it": ["gã hề ma quái"],
    "up": ["vút bay"],
    "sisu: road to revenge": ["sisu 2"],
    "naruto": ["naruto"]
};

// === TMDB HELPER ===
async function getTmdbVietnameseTitle(imdbId, type) {
    if (!TMDB_TOKEN) return null;
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_TOKEN}&external_source=imdb_id&language=vi-VN`;
        const res = await axios.get(url, { timeout: 2500 });

        if (!res.data) return null;
        let results = type === 'movie' ? res.data.movie_results : res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            if (viTitle && viTitle.trim()) {
                console.log(`[TMDB] Found Vietnamese title for ${imdbId}: "${viTitle}"`);
                return viTitle;
            }
        }
    } catch (e) {
        console.error(`[TMDB Error] ${e.message}`);
    }
    return null;
}

// === CALCULATOR: ABSOLUTE NUMBERING LOGIC (Giữ nguyên) ===
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
        .replace(/['":\-.()\[\]?,!]/g, " ") 
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

// === STRICT MATCHING LOGIC ===
function isStrictMatch(candidate, originalName, tmdbTitle, mappedList, year, hasYear) {
    const serverName = normalizeForSearch(candidate.name);
    const origClean = normalizeForSearch(originalName);
    const tmdbClean = tmdbTitle ? normalizeForSearch(tmdbTitle) : null;
    
    // 1. Year Check (Rất quan trọng để loại bỏ phim cũ/mới cùng tên)
    let yearMatch = true;
    if (hasYear && candidate.name) {
        const yearMatches = candidate.name.match(/\d{4}/g);
        if (yearMatches) {
            // Cho phép sai số 1 năm
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) || 
                        candidate.releaseInfo.includes((year-1).toString()) || 
                        candidate.releaseInfo.includes((year+1).toString());
        }
    }
    if (!yearMatch) return false;

    // 2. Name Check (Strict)
    // Candidate M-U-S-T contain either the exact Original Name OR the Exact TMDB Name
    // Không chấp nhận việc Search "Prometheus" ra "Alien" (mặc dù Alien không chứa từ Prometheus)
    
    const containsOriginal = serverName.includes(origClean);
    let containsTmdb = false;
    if (tmdbClean) {
        containsTmdb = serverName.includes(tmdbClean);
    }

    let containsMapped = false;
    if (mappedList && mappedList.length > 0) {
        containsMapped = mappedList.some(m => serverName.includes(normalizeForSearch(m)));
    }

    return containsOriginal || containsTmdb || containsMapped;
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

    // Absolute Number Logic
    let targetAbsoluteNumber = null;
    if (season && episode && type === 'series') {
        targetAbsoluteNumber = getAbsoluteTarget(originalName, season, episode);
    }

    const queries = [];
    let mappedVietnameseList = [];

    // 1. TMDB (Ưu tiên số 1)
    const tmdbVietnamese = await getTmdbVietnameseTitle(imdbId, type);
    if (tmdbVietnamese) {
        queries.push(tmdbVietnamese);
    }

    // 2. Manual Mapping (Backup)
    const mappingRaw = VIETNAMESE_MAPPING[lowerOrig];
    if (mappingRaw) {
        const list = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
        mappedVietnameseList = list;
        list.forEach(l => queries.push(l));
    }

    // 3. Original Name
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerOrig) queries.push(cleanName);

    // Xử lý query đặc biệt (bỏ "the movie", bỏ dấu :)
    if (originalName.includes(":")) queries.push(originalName.split(":")[0].trim());
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý (v42): "${originalName}" (${year}) ===`);
    console.log(`[Queries] ${uniqueQueries.join(" | ")}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    
    // Thực hiện search
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 4000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    // Remove duplicates by ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // --- STRICT FILTERING ---
    let matchedCandidates = allCandidates.filter(m => 
        isStrictMatch(m, originalName, tmdbVietnamese, mappedVietnameseList, year, hasYear)
    );

    // Sắp xếp độ ưu tiên:
    // 1. Tên candidate == TMDB Title
    // 2. Tên candidate == Original Title
    // 3. Các trường hợp chứa (includes)
    matchedCandidates.sort((a, b) => {
        const aName = normalizeForSearch(a.name);
        const bName = normalizeForSearch(b.name);
        const tName = tmdbVietnamese ? normalizeForSearch(tmdbVietnamese) : "";
        const oName = normalizeForSearch(originalName);

        // Ưu tiên khớp chính xác tuyệt đối
        if (aName === tName || aName === oName) return -1;
        if (bName === tName || bName === oName) return 1;
        return 0;
    });

    // --- PERFORMANCE FIX: CHỈ LẤY 1 KẾT QUẢ TỐT NHẤT ---
    if (matchedCandidates.length > 0) {
        console.log(`[Filter] Tìm thấy ${matchedCandidates.length} kết quả phù hợp. Chỉ lấy kết quả tốt nhất: "${matchedCandidates[0].name}"`);
        matchedCandidates = [matchedCandidates[0]]; // Cắt lấy phần tử đầu tiên
    } else {
        console.log(`[Filter] Không tìm thấy kết quả phù hợp strict mode.`);
        return { streams: [] };
    }

    let allStreams = [];

    // Chỉ chạy vòng lặp 1 lần duy nhất (vì length = 1)
    const streamPromises = matchedCandidates.map(async (match) => {
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(match.id)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    return sRes.data.streams.map(s => ({
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
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(match.id)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // SERIES FILTERING
                if (targetAbsoluteNumber) {
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        if (info && info.e === targetAbsoluteNumber) return true;
                        const regexAbs = new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                        return regexAbs.test(vidName);
                    });
                } else {
                    // Standard S/E check
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        if (info.s === 0) return season === 1 && info.e === episode;
                        return info.s === season && info.e === episode;
                    });
                }

                let episodeStreams = [];
                // Vì đã filter metadata tốt nhất, việc fetch stream từng tập sẽ nhanh hơn
                for (const vid of matchedVideos) {
                    const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            const streamTitle = s.title || s.name || "";
                            
                            // Double check Absolute Number in final stream title
                            if (targetAbsoluteNumber) {
                                const info = extractEpisodeInfo(streamTitle);
                                if (info) { if (info.e !== targetAbsoluteNumber) return; }
                                else {
                                    const regexAbs = new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                                    if (!regexAbs.test(streamTitle)) return;
                                }
                            } else {
                                // Standard Check again for safety
                                const info = extractEpisodeInfo(streamTitle);
                                if (info) {
                                    if (info.s !== 0 && (info.s !== season || info.e !== episode)) return;
                                }
                            }

                            episodeStreams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: s.title || vid.title,
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
    
    // Sort Quality
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
