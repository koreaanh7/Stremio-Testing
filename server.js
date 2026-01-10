const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

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
    id: "com.phim4k.vip.final.v40",
    version: "40.0.0",
    name: "Phim4K VIP (MHA & Naruto Offset)",
    description: "Fixed My Hero Academia & Naruto Shippuden Absolute/Offset logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (CẬP NHẬT MỚI) ===
const VIETNAMESE_MAPPING = {
    // --- SPECIAL CASES ---
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    "demon slayer: kimetsu no yaiba": ["thanh gươm diệt quỷ", "kimetsu no yaiba"],
    "my hero academia": ["học viện anh hùng", "boku no hero academia"], // [NEW]
    "naruto shippuden": ["naruto shippuuden", "huyền thoại naruto"], // [NEW]
    
    // GAME OF THRONES
    "game of thrones": ["trò chơi vương quyền (uhd) game of thrones", "trò chơi vương quyền (2011) game of thrones"],
    "oppenheimer": ["oppenheimer 2023"],

    // --- MAPPINGS ---
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

    // --- GHIBLI & ANIME ---
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

// === 2. DATABASE OFFSET (QUẢN LÝ BÙ TRỪ) ===
const SERIES_OFFSET_DB = {
    "my hero academia": {
        // MHA: Giữ nguyên Season, chỉ đổi số tập
        // Cú pháp: Season: [Start Episode] (Nghĩa là tập 1 của mùa đó = số này)
        2: 15,  // S2E1 -> S02E15
        3: 41,  // S3E1 -> S03E41
        4: 66,  // S4E1 -> S04E66
        5: 93,  // S5E1 -> S05E93
        6: 120, // S6E1 -> S06E120
        7: 150  // S7E1 -> S07E150
    },
    "naruto shippuden": {
        // Naruto: Cộng dồn tập.
        // Tôi đã điền đủ các mùa dựa trên Wiki chuẩn + yêu cầu của bạn
        2: 33,   // S2E1 -> S02E33
        3: 54,   // (Wiki)
        4: 72,   // (Wiki)
        5: 89,   // (Wiki)
        6: 113,  // (Wiki)
        7: 144,  // (Wiki)
        8: 152,  // (Wiki)
        9: 176,  // (Wiki)
        10: 197, // (Wiki)
        11: 222, // (Wiki)
        12: 243, // (Wiki)
        13: 276, // (Wiki)
        14: 296, // (Wiki)
        15: 321, // (Wiki)
        16: 349, // (Wiki)
        17: 362, // (Wiki)
        18: 394, // [USER REQUEST] S18E1 -> 394
        19: 414, // (Estimated/Wiki)
        20: 432, // (Estimated/Wiki)
        // [USER REQUEST]: Season 22 map về S20, bắt đầu từ 459
        22: { mapToSeason: 20, startEp: 459 } 
    }
};

// --- UTILS ---
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

// Hàm tính toán Offset nâng cao (MHA / Naruto / AoT)
function getAdvancedOffset(name, season, episode) {
    const lowerName = name.toLowerCase();
    
    // 1. ATTACK ON TITAN (Logic cũ)
    if (lowerName.includes("attack on titan")) {
        if (season === 1) return null; // S1 dùng chuẩn
        if (season === 2) return { s: season, e: 25 + episode };
        if (season === 3) return { s: season, e: 37 + episode };
        if (season === 4) return { s: season, e: 59 + episode };
    }

    // 2. MY HERO ACADEMIA
    if (lowerName.includes("my hero academia") || lowerName.includes("boku no hero")) {
        const config = SERIES_OFFSET_DB["my hero academia"];
        if (config && config[season]) {
            // Công thức: StartEp + (EpisodeHienTai - 1)
            // Ví dụ: S2E1 -> config[2]=15 -> 15 + 0 = 15.
            const targetEp = config[season] + (episode - 1);
            return { s: season, e: targetEp };
        }
    }

    // 3. NARUTO SHIPPUDEN
    if (lowerName.includes("naruto shippuden") || lowerName.includes("naruto: shippuuden")) {
        const config = SERIES_OFFSET_DB["naruto shippuden"];
        if (config && config[season]) {
            const entry = config[season];
            let startEp = 0;
            let targetSeason = season;

            // Xử lý trường hợp object (như S22 map về S20)
            if (typeof entry === 'object') {
                targetSeason = entry.mapToSeason;
                startEp = entry.startEp;
            } else {
                startEp = entry;
            }

            const targetEp = startEp + (episode - 1);
            return { s: targetSeason, e: targetEp };
        }
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

    // Bypass check
    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;
    if (originalName.toLowerCase().includes("game of thrones") && serverClean.includes("game of thrones")) return true;
    if (originalName.toLowerCase().includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;
    // [NEW] Bypass for MHA & Naruto
    if (originalName.toLowerCase().includes("my hero academia") && (serverClean.includes("hoc vien anh hung") || serverClean.includes("my hero academia"))) return true;
    if (originalName.toLowerCase().includes("naruto shippuden") && (serverClean.includes("huyen thoai naruto") || serverClean.includes("naruto"))) return true;

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
    const isAoT = lowerOrig.includes("attack on titan");
    const isDemonSlayer = lowerOrig.includes("demon slayer") || lowerOrig.includes("kimetsu no yaiba");
    const isMHA = lowerOrig.includes("my hero academia") || lowerOrig.includes("boku no hero");
    const isNarutoShippuden = lowerOrig.includes("naruto shippuden");

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

    // [LOGIC 2] OFFSET SYSTEM (AoT, MHA, Naruto)
    // Trả về {s, e} mới nếu có mapping
    const offsetData = getAdvancedOffset(originalName, season, episode);

    const queries = [];
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerOrig];
    if (mappingRaw) mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];

    mappedVietnameseList.forEach(name => queries.push(name));
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
    console.log(`\n=== Xử lý (v40): "${originalName}" S${season}E${episode} ===`);
    if (offsetData) console.log(`[Special] Offset System Triggered: Looking for S${offsetData.s}E${offsetData.e}`);

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

    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName, uniqueQueries));
    
    if (mappedVietnameseList.length > 0) {
        const strictMatches = matchedCandidates.filter(m => 
             mappedVietnameseList.some(map => normalizeForSearch(m.name).includes(normalizeForSearch(map)))
        );
        if (strictMatches.length > 0) matchedCandidates = strictMatches;
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    console.log(`-> Tìm thấy ${matchedCandidates.length} phim phù hợp.`);

    let allStreams = [];
    const hpKeywords = getHPKeywords(originalName);

    const streamPromises = matchedCandidates.map(async (match) => {
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(match.id)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    let streams = sRes.data.streams;
                    // ... (Movie Filters kept same as v39)
                    if (useSmartRegex && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) streams = streams.filter(s => titleRegex.test(s.title || s.name || ""));
                    } else if (hpKeywords) {
                        streams = streams.filter(s => {
                            const sTitle = (s.title || s.name || "").toLowerCase();
                            const hasKeyword = hpKeywords.some(kw => sTitle.includes(kw));
                            if (hpKeywords.includes("part 1") && (sTitle.includes("part 2") || sTitle.includes("pt.2"))) return false;
                            return hasKeyword;
                        });
                    }
                    return streams.map(s => ({
                        name: "Phim4K VIP", title: s.title || s.name, url: s.url,
                        behaviorHints: { proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } } }
                    }));
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(match.id)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data?.meta?.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // --- (v40) PRE-FILTER WITH OFFSET LOGIC ---
                if (offsetData) {
                    // AoT, MHA, Naruto Logic
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        
                        // Nếu là AoT S2+ (chỉ check E)
                        if (isAoT) {
                             if (info && info.e === offsetData.e) return true;
                             if (vidName.includes(` ${offsetData.e} `) || vidName.includes(`E${offsetData.e}`)) return true;
                             return false;
                        }

                        // Nếu là MHA / Naruto (Check cả S và E vì file có SxxEyy)
                        if (isMHA || isNarutoShippuden) {
                            if (info) {
                                // Phải khớp Target Season (với Naruto S22->S20 thì target là 20)
                                // Và khớp Target Episode
                                return info.s === offsetData.s && info.e === offsetData.e;
                            }
                            return false;
                        }
                    });
                }
                else if (isDemonSlayer) {
                    // (Demon Slayer logic kept from v39)
                    if (season === 1) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (name.includes("hashira") || name.includes("geiko")) return false;
                            return new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                        });
                    } else if (season === 5) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (!name.includes("hashira") && !name.includes("geiko")) return false;
                            return new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`).test(name);
                        });
                    } else {
                        matchedVideos = matchedVideos.filter(vid => {
                            const info = extractEpisodeInfo(vid.title || vid.name || "");
                            return info && info.s === season && info.e === episode;
                        });
                    }
                } 
                else if (useSmartRegex && targetEpisodeTitle) {
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    matchedVideos = matchedVideos.filter(vid => titleRegex.test(vid.title || vid.name || ""));
                }
                else {
                    // Standard Logic
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        if (isRegularShow && season <= 2) {
                             if (!/(?:s|season)\s?0?${season}|${season}x/i.test(vid.title||"")) return false;
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
                            
                            // --- (v40) FINAL STRICT CHECK ---
                            if (offsetData) {
                                if (isAoT) {
                                    const info = extractEpisodeInfo(streamTitle);
                                    if (info && info.e !== offsetData.e) return;
                                    if (!info && !streamTitle.includes(`${offsetData.e}`)) return;
                                }
                                if (isMHA || isNarutoShippuden) {
                                    const info = extractEpisodeInfo(streamTitle);
                                    if (!info) return; // Bắt buộc phải parse được S/E
                                    if (info.s !== offsetData.s || info.e !== offsetData.e) return;
                                }
                            }
                            else if (isDemonSlayer) {
                                 // (Demon Slayer Final Check - same as v39)
                                 const sName = streamTitle.toLowerCase();
                                 const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                                 if (season === 1) {
                                     if (sName.includes("hashira") || sName.includes("geiko") || !epRegex.test(sName)) return;
                                 } else if (season === 5) {
                                     if ((!sName.includes("hashira") && !sName.includes("geiko")) || !epRegex.test(sName)) return;
                                 } else {
                                     const i = extractEpisodeInfo(streamTitle);
                                     if (!i || i.s !== season || i.e !== episode) return;
                                 }
                            }
                            else if (useSmartRegex && targetEpisodeTitle) {
                                const tr = createSmartRegex(targetEpisodeTitle);
                                if (tr && !tr.test(streamTitle)) return;
                            }
                            else {
                                const info = extractEpisodeInfo(streamTitle);
                                if (!info) return;
                                if (isRegularShow && season <= 2) {
                                    if (!/(?:s|season)\s?0?${season}|${season}x/i.test(streamTitle)) return;
                                }
                                if (info.s === 0 && (season !== 1 || info.e !== episode)) return;
                                if (info.s !== 0 && (info.s !== season || info.e !== episode)) return;
                            }

                            episodeStreams.push({
                                name: `Phim4K VIP`,
                                title: (s.title || vid.title) + `\n[${match.name}]`,
                                url: s.url,
                                behaviorHints: { 
                                    notWebReady: false, 
                                    proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } }
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
    allStreams.sort((a, b) => b.title.includes("4K") - a.title.includes("4K"));
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
