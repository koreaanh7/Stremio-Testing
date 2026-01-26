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
    name: "Phim4K VIP (Strict TMDB)",
    description: "Strict TMDB Mapping + Fixed Alien/Prometheus Issue",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. DANH SÁCH NGOẠI LỆ (GIỮ NGUYÊN) ===
// Những phim này tên file/web đặt rất dị, cần xử lý riêng (Loose Logic)
const SPECIAL_MAPPING = {
    // --- SPECIAL CASES ---
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    
    // --- FIX PRIORITY ---
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
    "coco": ["coco hội ngộ diệu kì", "coco hoi ngo dieu ki"],
    "elio": ["elio cậu bé đến từ trái đất", "elio cau be den tu trai dat"],
    "elf": ["chàng tiên giáng trần", "elf"],
    "f1": ["f1"],
    "f1: the movie": ["f1"],
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"],
    "dark": ["đêm lặng"],
    "el camino: a breaking bad movie": ["el camino", "tập làm người xấu movie"],
    
    // --- HARRY POTTER ---
    "harry potter and the sorcerer's stone": ["harry potter colection"],
    "harry potter and the philosopher's stone": ["harry potter colection"],
    "harry potter and the chamber of secrets": ["harry potter colection"],
    "harry potter and the prisoner of azkaban": ["harry potter colection"],
    "harry potter and the goblet of fire": ["harry potter colection"],
    "harry potter and the order of the phoenix": ["harry potter colection"],
    "harry potter and the half-blood prince": ["harry potter colection"],
    "harry potter and the deathly hallows: part 1": ["harry potter colection"],
    "harry potter and the deathly hallows: part 2": ["harry potter colection"],

    // --- GHIBLI & OTHERS ---
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
    "chainsaw man - the movie: reze arc": ["chainsaw man movie", "reze arc"],
    "10 dance": ["10dance", "10 dance"],
    "princess mononoke": ["công chúa mononoke", "mononoke hime"],
    "ocean waves": ["những con sóng đại dương", "sóng đại dương"],
    "the red turtle": ["rùa đỏ"],
    "from up on poppy hill": ["ngọn đồi hoa hồng anh"],
    "the secret world of arrietty": ["thế giới bí mật của arrietty"],
    "the cat returns": ["loài mèo trả ơn"],
    "only yesterday": ["chỉ còn ngày hôm qua"],
    "the wind rises": ["gió vẫn thổi", "gió nổi"],
    "the boy and the heron": ["thiếu niên và chim diệc"],
    "howl's moving castle": ["lâu đài bay của pháp sư howl"],
    "spirited away": ["vùng đất linh hồn"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "grave of the fireflies": ["mộ đom đóm"],
    "ponyo": ["cô bé người cá ponyo"],
    "weathering with you": ["đứa con của thời tiết"],
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
        const res = await axios.get(url, { timeout: 3000 }); 

        if (!res.data) return null;

        let results = [];
        if (type === 'movie') results = res.data.movie_results;
        else if (type === 'series') results = res.data.tv_results;

        if (results && results.length > 0) {
            const item = results[0];
            const viTitle = type === 'movie' ? item.title : item.name;
            const originalTitle = type === 'movie' ? item.original_title : item.original_name;
            
            // Trả về nếu có tên Việt khác tên gốc
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

// === ABSOLUTE NUMBERING (MHA, NARUTO) ===
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
    return new RegExp(words.join("[\\W_]+"), 'i');
}

// === NEW: STRICT MATCHING LOGIC ===
function isStrictMatch(candidate, type, originalName, tmdbVietnamese, year, hasYear, isSpecialCase) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);
    const originClean = normalizeForSearch(originalName);
    const tmdbClean = tmdbVietnamese ? normalizeForSearch(tmdbVietnamese) : null;

    // 1. YEAR CHECK (First Gate)
    let yearMatch = false;
    if (!hasYear) {
        yearMatch = true;
    } else {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            // Nếu là Strict Mode (có TMDB), year phải chính xác hoặc +/- 1
            // Nếu là Special Case (Naruto), nới lỏng ra
            const tolerance = isSpecialCase ? 2 : 1; 
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) 
                     || candidate.releaseInfo.includes((year-1).toString()) 
                     || candidate.releaseInfo.includes((year+1).toString());
        } else {
            // Nếu không tìm thấy năm trên server, tạm chấp nhận nếu tên khớp cực chuẩn
            yearMatch = true; 
        }
    }

    // Bypass cho Harry Potter collection
    if (serverClean.includes("harry potter colection")) yearMatch = true;
    if (!yearMatch) return false; // Sai năm -> Loại ngay (Fix Prometheus vs Alien)

    // 2. NAME CHECK
    // 2.1. Special Cases (Dùng logic cũ - Loose)
    if (isSpecialCase) {
        const mapping = SPECIAL_MAPPING[originClean] || [];
        for (const m of mapping) {
            const mClean = normalizeForSearch(m);
            if (serverClean.includes(mClean)) return true;
        }
        if (serverClean.includes(originClean)) return true;
        return false;
    }

    // 2.2. TMDB Strict Mode (Logic mới)
    // Nếu có tên tiếng Việt từ TMDB, bắt buộc kết quả phải chứa tên đó 
    // HOẶC chứa tên gốc chính xác. Không chấp nhận map lỏng lẻo.
    if (tmdbClean) {
        // Case A: Server chứa tên tiếng Việt (Ưu tiên số 1)
        if (serverClean.includes(tmdbClean)) return true;

        // Case B: Server chứa tên gốc (Prometheus)
        // Nhưng phải kiểm tra kỹ: "Alien" không chứa "Prometheus" -> False.
        if (serverClean.includes(originClean)) return true;

        return false; // Có tên TMDB mà không khớp cái nào -> Loại
    }

    // 2.3. Fallback (Không có TMDB, không Special) -> Check tên gốc
    if (serverClean.includes(originClean)) return true;

    return false;
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
    const isSpecialCase = !!SPECIAL_MAPPING[lowerOrig];
    const isTomAndJerry = lowerOrig.includes("tom and jerry");
    const isRegularShow = lowerOrig.includes("regular show");
    const isDemonSlayer = lowerOrig.includes("demon slayer") || lowerOrig.includes("kimetsu no yaiba");

    // [LOGIC] Smart Regex / Absolute
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

    // === QUERY BUILDER ===
    const queries = [];
    
    // 1. Manual Mapping (Priority)
    let mappedVietnameseList = [];
    if (isSpecialCase) {
        const mappingRaw = SPECIAL_MAPPING[lowerOrig];
        mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
        mappedVietnameseList.forEach(name => queries.push(name));
    }

    // 2. TMDB Mapping (Strict Source)
    let tmdbVietnamese = null;
    if (!isSpecialCase) {
        tmdbVietnamese = await getTmdbVietnameseTitle(imdbId, type);
        if (tmdbVietnamese) {
            queries.push(tmdbVietnamese);
        }
    }

    // 3. Original Name
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerOrig) queries.push(cleanName);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') queries.push(splitName);
    }

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý (v42): "${originalName}" (${year}) ===`);
    console.log(`[Queries] ${uniqueQueries.join(" | ")}`);
    if (tmdbVietnamese) console.log(`[Mode] STRICT TMDB: "${tmdbVietnamese}"`);
    else if (isSpecialCase) console.log(`[Mode] SPECIAL CASE`);
    else console.log(`[Mode] STANDARD`);

    // === SEARCH ===
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
    // Deduplicate
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === FILTERING (THE CORE FIX) ===
    let matchedCandidates = allCandidates.filter(m => 
        isStrictMatch(m, type, originalName, tmdbVietnamese, year, hasYear, isSpecialCase)
    );

    // Filter subtitle noise
    const isHarryPotter = lowerOrig.includes("harry potter");
    matchedCandidates = matchedCandidates.filter(m => {
         const cleanCand = normalizeForSearch(m.name);
         if (originalName.includes(":") && !isSpecialCase) {
            const parts = originalName.split(":");
            if (parts.length >= 2) {
                const subtitle = normalizeForSearch(parts[1]);
                if (subtitle.length > 3 && cleanName.includes("original sin") && !cleanCand.includes("original sin")) return false;
            }
         }
         return true;
    });

    if (matchedCandidates.length === 0) {
        console.log("-> KHÔNG TÌM THẤY KẾT QUẢ KHỚP.");
        return { streams: [] };
    }

    console.log(`-> KẾT QUẢ CUỐI CÙNG:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name} (${m.releaseInfo || 'N/A'})`));

    // === STREAM EXTRACTION ===
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
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // PRE-FILTER VIDEOS
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
                            if (name.includes("hashira") || name.includes("geiko")) return false;
                            return new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                        });
                    } else if (season === 5) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            return (name.includes("hashira") || name.includes("geiko")) && new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                        });
                    } else {
                        matchedVideos = matchedVideos.filter(vid => {
                            const info = extractEpisodeInfo(vid.title || vid.name || "");
                            return info && info.s === season && info.e === episode;
                        });
                    }
                }
                else {
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        if (!info) return false;
                        if (isRegularShow && season <= 2) {
                             if (!new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(vidName)) return false;
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
                            
                            // FINAL FILTER
                            if (useSmartRegex && targetEpisodeTitle) {
                                const tr = createSmartRegex(targetEpisodeTitle);
                                if (tr && !tr.test(streamTitle)) return;
                            } 
                            else if (targetAbsoluteNumber) {
                                const info = extractEpisodeInfo(streamTitle);
                                if (info) { if (info.e !== targetAbsoluteNumber) return; } 
                                else { if (!new RegExp(`(?:^|\\s|e|ep|#)${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i').test(streamTitle)) return; }
                            }
                            else if (isDemonSlayer) {
                                const sName = streamTitle.toLowerCase();
                                if (season === 1) {
                                     if (sName.includes("hashira") || sName.includes("geiko") || !new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sName)) return;
                                } else if (season === 5) {
                                    if ((!sName.includes("hashira") && !sName.includes("geiko")) || !new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(sName)) return;
                                } else {
                                    const info = extractEpisodeInfo(streamTitle);
                                    if (!info || info.s !== season || info.e !== episode) return;
                                }
                            }
                            else {
                                const info = extractEpisodeInfo(streamTitle);
                                if (!info) return;
                                if (isRegularShow && season <= 2 && !new RegExp(`(?:s|season)\\s?0?${season}|${season}x`, 'i').test(streamTitle)) return;
                                if (info.s === 0) { if (season !== 1 || info.e !== episode) return; } 
                                else { if (info.s !== season || info.e !== episode) return; }
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
