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
    name: "Phim4K VIP (Strict TMDB & Speed)",
    description: "Strict Search Matching, Prometheus/Alien Fix, Faster GoT Loading",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (Giữ lại SPECIAL CASES & FIX PRIORITY như yêu cầu) ===
const VIETNAMESE_MAPPING = {
    // --- SPECIAL CASES (Giữ nguyên logic logic nhảy tập/collection) ---
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    
    // --- FIX PRIORITY (Những phim TMDB có thể dịch sai hoặc web lậu đặt tên dị) ---
    "shadow": ["vô ảnh"], 
    "boss": ["đại ca ha ha ha"], 
    "flow": ["lạc trôi", "straume"], 
    "taxi driver": ["tài xế ẩn danh", "taxi driver"],
    "9": ["chiến binh số 9", "9"], 
    "the neverending story": ["câu chuyện bất tận"],
    "o brother, where art thou?": ["3 kẻ trốn tù", "ba kẻ trốn tù"],
    "brother": ["brother", "lão đại", "người anh em"],
    "from": ["bẫy"], 
    "dexter: original sin": ["dexter original sin", "dexter trọng tội", "dexter sát thủ"],
    "12 monkeys": ["12 con khỉ", "twelve monkeys"],
    "it": ["gã hề ma quái"],
    "up": ["vút bay"],
    "ted": ["chú gấu ted"],
    "rio": ["chú vẹt đuôi dài"],
    "cars": ["vương quốc xe hơi"],
    "coco": ["coco hội ngộ diệu kì"],
    "elio": ["elio cậu bé đến từ trái đất"],
    "elf": ["chàng tiên giáng trần", "elf"],
    "f1": ["f1"],
    "f1: the movie": ["f1"],
    "sentimental value": ["giá trị tình cảm"],
    "dark": ["đêm lặng"],
    "el camino: a breaking bad movie": ["el camino", "tập làm người xấu movie"],
    
    // --- HARRY POTTER (Logic Collection) ---
    "harry potter and the sorcerer's stone": ["harry potter colection"],
    "harry potter and the philosopher's stone": ["harry potter colection"],
    "harry potter and the chamber of secrets": ["harry potter colection"],
    "harry potter and the prisoner of azkaban": ["harry potter colection"],
    "harry potter and the goblet of fire": ["harry potter colection"],
    "harry potter and the order of the phoenix": ["harry potter colection"],
    "harry potter and the half-blood prince": ["harry potter colection"],
    "harry potter and the deathly hallows: part 1": ["harry potter colection"],
    "harry potter and the deathly hallows: part 2": ["harry potter colection"],

    // --- ANIME SPECIALS ---
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
    "princess mononoke": ["công chúa mononoke", "mononoke hime"],
    "spirited away": ["vùng đất linh hồn"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "grave of the fireflies": ["mộ đom đóm"],
    "your name": ["tên cậu là gì"],
    "suzume": ["khóa chặt cửa nào suzume"],
    "5 centimeters per second": ["5 centimet trên giây"],
    "naruto": ["naruto"]
};

// === TMDB HELPER ===
async function getTmdbVietnameseTitle(imdbId, type) {
    if (!TMDB_TOKEN) return null;
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_TOKEN}&external_source=imdb_id&language=vi-VN`;
        const res = await axios.get(url, { timeout: 2500 }); 

        if (!res.data) return null;

        let results = [];
        if (type === 'movie') results = res.data.movie_results;
        else if (type === 'series') results = res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            if (viTitle && viTitle.trim().length > 0) {
                console.log(`[TMDB] Found Vietnamese title for ${imdbId}: "${viTitle}"`);
                return viTitle;
            }
        }
    } catch (e) {
        console.error(`[TMDB Error] ${e.message}`);
    }
    return null;
}

// === LOGIC HELPERS ===
function normalizeForSearch(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") 
        .replace(/['":\-.()\[\]?,]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// Calculator Logic (Naruto/MHA/AoT) - Giữ nguyên vì bạn cần
function getAbsoluteTarget(title, season, episode) {
    const lowerTitle = title.toLowerCase();
    
    // Attack on Titan
    if (lowerTitle.includes("attack on titan")) {
        if (season === 1) return null;
        if (season === 2) return 25 + episode;
        if (season === 3) return 37 + episode;
        if (season === 4) return 59 + episode;
    }
    // MHA
    if (lowerTitle.includes("my hero academia") || lowerTitle.includes("boku no hero")) {
        if (season === 1) return null;
        // Simple offset map
        const offsets = {2: 14, 3: 40, 4: 65, 5: 92, 6: 119, 7: 149, 8: 170};
        return (offsets[season] || 0) + episode;
    }
    // Naruto Shippuden
    if (lowerTitle.includes("naruto shippuden") || lowerTitle.includes("naruto: shippuden")) {
        if (season === 1) return null;
        const offsets = {
            2: 32, 3: 53, 4: 71, 5: 88, 6: 112, 7: 143, 8: 151, 9: 175, 10: 196,
            11: 222, 12: 242, 13: 260, 14: 295, 15: 320, 16: 348, 17: 361,
            18: 393, 19: 413, 20: 431, 21: 450, 22: 458
        };
        return (offsets[season] || 0) + episode;
    }
    return null;
}

function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    const matchSE = name.match(/(?:s|season)[\s\.]?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)[\s\.]?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    const matchE = name.match(/(?:e|ep|episode|tap|#)[\s\.]?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };
    return null;
}

function createSmartRegex(episodeName) {
    if (!episodeName) return null;
    let cleanName = episodeName.replace(/['"!?,.]/g, "").trim();
    if (!cleanName) return null;
    const words = cleanName.split(/\s+/).map(w => w.replace(/[.*+^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(words.join("[\\W_]+"), 'i');
}

// === STRICT MATCH CHECKER (V42) ===
function isStrictMatch(candidate, type, originalName, year, hasYear, queries) {
    if (candidate.type && candidate.type !== type) return false;
    
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);
    const origClean = normalizeForSearch(originalName);

    // 1. Bypass Logic (Harry Potter, Tom & Jerry...)
    if (serverClean.includes("harry potter colection") && origClean.includes("harry potter")) return true;
    if (origClean.includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (origClean.includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;

    // 2. YEAR CHECK (Bắt buộc nếu có info)
    let yearMatch = true;
    if (hasYear && !serverClean.includes("harry potter colection")) {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            const tolerance = (type === 'series') ? 2 : 1;
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
             yearMatch = candidate.releaseInfo.includes(year.toString());
        }
    }
    if (!yearMatch) return false;

    // 3. PROMETHEUS / ALIEN FIX (STRICT FRANCHISE GUARD)
    // Nếu phim là "Prometheus" thì cấm tuyệt đối chữ "Alien" trong tên kết quả
    if (origClean.includes("prometheus") && !origClean.includes("alien")) {
        if (serverClean.includes("alien") && !serverClean.includes("prometheus")) {
            return false; // Loại ngay lập tức Alien 1, 2, 3, Covenant
        }
    }

    // 4. CHECK QUERY INCLUSION (Nghiêm ngặt)
    // Kết quả serverClean BẮT BUỘC phải chứa một trong các query
    let isNameMatch = false;
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        // Logic kiểm tra chứa:
        // Nếu query ngắn (<=3 ký tự) phải khớp đúng từ (regex boundary)
        // Nếu query dài, chỉ cần includes
        if (qClean.length <= 3) {
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) { isNameMatch = true; break; }
        } else {
            if (serverClean.includes(qClean)) { isNameMatch = true; break; }
        }
    }
    
    return isNameMatch;
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

    // === QUERIES GENERATION (V42: CLEAN & STRICT) ===
    const queries = [];
    
    // Ưu tiên 1: Mapping thủ công (Special Cases)
    let manualMapped = VIETNAMESE_MAPPING[lowerOrig];
    if (manualMapped) {
        if (!Array.isArray(manualMapped)) manualMapped = [manualMapped];
        queries.push(...manualMapped);
    }

    // Ưu tiên 2: TMDB (The source of truth)
    const tmdbVietnamese = await getTmdbVietnameseTitle(imdbId, type);
    if (tmdbVietnamese) {
        queries.push(tmdbVietnamese);
    }

    // Ưu tiên 3: Tên gốc
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerOrig) queries.push(cleanName);

    // Xử lý phụ (Bỏ "the movie", bỏ dấu câu...)
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)]; // Lọc trùng
    console.log(`\n=== v42 Scan: "${originalName}" (${year}) ===`);
    console.log(`   Queries: [${uniqueQueries.join(" | ")}]`);

    // === SEARCH REQUEST ===
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    // Chỉ search tối đa 3 query đầu tiên để tối ưu tốc độ (Thường TMDB + Tên gốc là đủ)
    const activeQueries = uniqueQueries.slice(0, 3);
    
    const searchPromises = activeQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    // Remove duplicates by ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === STRICT FILTERING ===
    let matchedCandidates = allCandidates.filter(m => 
        isStrictMatch(m, type, originalName, year, hasYear, uniqueQueries)
    );

    // Subtitle Check (e.g., Dexter: Original Sin)
    matchedCandidates = matchedCandidates.filter(m => {
        const mClean = normalizeForSearch(m.name);
        const oClean = normalizeForSearch(originalName);
        if (oClean.includes("original sin") && !mClean.includes("original sin")) return false;
        return true;
    });

    // === PERFORMANCE BOOST (GOT FIX) ===
    // Nếu có quá nhiều kết quả (VD search GoT ra cả chục cái Making of), 
    // ta chỉ lấy tối đa 2-3 kết quả tốt nhất để fetch metadata.
    if (matchedCandidates.length > 3) {
        console.log(`[Perf] Truncating candidates from ${matchedCandidates.length} to 3`);
        // Ưu tiên kết quả nào khớp chính xác tên TMDB hoặc tên gốc nhất
        matchedCandidates.sort((a, b) => {
            const nameA = normalizeForSearch(a.name);
            const nameB = normalizeForSearch(b.name);
            const tmdbClean = tmdbVietnamese ? normalizeForSearch(tmdbVietnamese) : "";
            const origClean = normalizeForSearch(originalName);

            // Điểm cao nếu khớp chính xác
            const scoreA = (nameA === tmdbClean || nameA === origClean) ? 10 : 0;
            const scoreB = (nameB === tmdbClean || nameB === origClean) ? 10 : 0;
            return scoreB - scoreA;
        });
        matchedCandidates = matchedCandidates.slice(0, 3);
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    console.log(`-> MATCHED: ${matchedCandidates.map(m => m.name).join(", ")}`);

    // === PREPARE SPECIAL LOGIC VARS ===
    const isTomAndJerry = lowerOrig.includes("tom and jerry");
    const isRegularShow = lowerOrig.includes("regular show");
    const isDemonSlayer = lowerOrig.includes("demon slayer") || lowerOrig.includes("kimetsu no yaiba");
    let useSmartRegex = false;
    let targetEpisodeTitle = null;

    if (isTomAndJerry || (isRegularShow && season >= 3)) {
        useSmartRegex = true;
        const vVid = meta.videos ? meta.videos.find(v => v.season === season && v.episode === episode) : null;
        if (vVid) targetEpisodeTitle = vVid.name || vVid.title;
    }

    let targetAbsoluteNumber = null;
    if (season && episode && type === 'series') {
        targetAbsoluteNumber = getAbsoluteTarget(originalName, season, episode);
    }
    
    // === FETCH STREAMS ===
    let allStreams = [];
    const hpKeywords = getHPKeywords(originalName); // Vẫn dùng cho HP

    const streamPromises = matchedCandidates.map(async (match) => {
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(match.id)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    let streams = sRes.data.streams;
                    // Harry Potter Filter
                    if (lowerOrig.includes("harry potter") && hpKeywords) {
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
                            bingeGroup: "phim4k-vip",
                            headers: { "User-Agent": "KSPlayer/1.0" }
                        }
                    }));
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(match.id)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // --- FILTER VIDEOS ---
                if (useSmartRegex && targetEpisodeTitle) {
                    const tr = createSmartRegex(targetEpisodeTitle);
                    if (tr) matchedVideos = matchedVideos.filter(v => tr.test(v.title || v.name || ""));
                } 
                else if (targetAbsoluteNumber) {
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (info && info.e === targetAbsoluteNumber) return true;
                        const regexAbs = new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                        return regexAbs.test(vid.title || vid.name || "");
                    });
                }
                else if (isDemonSlayer) {
                    // Logic Demon Slayer giữ nguyên
                     if (season === 1) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const n = (vid.title||vid.name||"").toLowerCase();
                            return !n.includes("hashira") && !n.includes("geiko") && new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(n);
                        });
                    } else if (season === 5) {
                         matchedVideos = matchedVideos.filter(vid => {
                            const n = (vid.title||vid.name||"").toLowerCase();
                            return (n.includes("hashira") || n.includes("geiko")) && new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(n);
                        });
                    } else {
                        matchedVideos = matchedVideos.filter(v => {
                            const i = extractEpisodeInfo(v.title||v.name||"");
                            return i && i.s === season && i.e === episode;
                        });
                    }
                }
                else {
                    // Standard Logic
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        if (isRegularShow && season <= 2) {
                             if (!new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(vid.title||vid.name)) return false;
                        }
                        if (info.s === 0) return season === 1 && info.e === episode;
                        return info.s === season && info.e === episode;
                    });
                }

                // --- FETCH EPISODE STREAMS ---
                // Game of Thrones Speed Fix: matchedVideos sau khi filter thường chỉ còn 1-2 video.
                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const vidUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    const sRes = await axios.get(vidUrl, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            // Final strict filter for streams
                            const sTitle = s.title || vid.title || "";
                            if (targetAbsoluteNumber) {
                                const i = extractEpisodeInfo(sTitle);
                                if (i && i.e !== targetAbsoluteNumber) return;
                            }
                            episodeStreams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: sTitle + `\n[${match.name}]`,
                                url: s.url,
                                behaviorHints: { 
                                    bingeGroup: "phim4k-vip",
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
    
    // Sort quality
    allStreams.sort((a, b) => {
        const qA = a.title.includes("4K") ? 3 : (a.title.includes("1080") ? 2 : 1);
        const qB = b.title.includes("4K") ? 3 : (b.title.includes("1080") ? 2 : 1);
        return qB - qA;
    });

    return { streams: allStreams };
});

// Helper cũ giữ nguyên cho HP Logic
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

async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
