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
    name: "Phim4K VIP (MHA & Naruto Fix)",
    description: "Added Custom Absolute Numbering for My Hero Academia & Naruto Shippuden",
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
    
    // [NEW] ANIME MAPPING
    "my hero academia": ["học viện siêu anh hùng", "boku no hero academia"],
    "naruto shippuden": ["naruto shippuuden", "naruto phần 2"],
    
    // GAME OF THRONES
    "game of thrones": ["trò chơi vương quyền (uhd) game of thrones", "trò chơi vương quyền (2011) game of thrones"],
    // OPPENHEIMER
    "oppenheimer": ["oppenheimer 2023"],

    // --- OTHERS ---
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

// --- UTILS ---

// 1. CALCULATOR: My Hero Academia
function getMHA_Offset(season) {
    // S1: Standard (1-13) -> Return NULL to use standard check
    if (season === 1) return null;
    // S2 start 15 -> Offset 14
    if (season === 2) return 14; 
    // S3 start 41 -> Offset 40
    if (season === 3) return 40;
    // S4 start 66 -> Offset 65
    if (season === 4) return 65;
    // S5 start 93 -> Offset 92
    if (season === 5) return 92;
    // S6 start 120 -> Offset 119
    if (season === 6) return 119;
    // S7 start 150 -> Offset 149
    if (season === 7) return 149;
    
    return null;
}

// 2. CALCULATOR: Naruto Shippuden
function getNarutoShippuden_Offset(season) {
    // Note: Return 0 means "Absolute Mode enabled but start at 1" (Tap 01)
    // Return NULL means "Standard S01E01 Mode"
    
    if (season === 1) return 0;   // 1-32
    if (season === 2) return 32;  // Starts 33
    if (season === 3) return 53;  // Starts 54
    if (season === 4) return 71;  // Starts 72
    if (season === 5) return 88;  // Starts 89
    if (season === 6) return 112; // Starts 113
    if (season === 7) return 143; // Starts 144
    if (season === 8) return 151; // Starts 152
    if (season === 9) return 175; // Starts 176
    if (season === 10) return 196; // Starts 197
    if (season === 11) return 221; // Starts 222
    if (season === 12) return 242; // Starts 243
    if (season === 13) return 275; // Starts 276
    if (season === 14) return 295; // Starts 296
    if (season === 15) return 320; // Starts 321
    if (season === 16) return 348; // Starts 349
    if (season === 17) return 361; // Starts 362
    if (season === 18) return 372; // Starts 373
    if (season === 19) return 393; // Starts 394
    if (season === 20) return 413; // Starts 414
    if (season === 21) return 458; // Placeholder gap (Standard S21 often starts late)
    
    // User Specified: S22 starts 459 -> Offset 458
    if (season >= 22) return 458 + ((season - 22) * 20); // Rough estimate for >22 if any

    return 458; // Fallback for S22
}

// 3. CALCULATOR: Attack on Titan
function getAoT_Offset(season) {
    if (season === 1) return null; // Standard
    if (season === 2) return 25;
    if (season === 3) return 37;
    if (season === 4) return 59;
    return null;
}

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

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;
    if (originalName.toLowerCase().includes("game of thrones") && serverClean.includes("game of thrones")) return true;
    if (originalName.toLowerCase().includes("demon slayer") && (serverClean.includes("thanh guom diet quy") || serverClean.includes("kimetsu"))) return true;
    if (originalName.toLowerCase().includes("my hero academia") && (serverClean.includes("hoc vien sieu anh hung") || serverClean.includes("hero academia"))) return true;
    if (originalName.toLowerCase().includes("naruto shippuden") && (serverClean.includes("naruto"))) return true;

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
    const isMHA = lowerOrig.includes("my hero academia");
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

    // [LOGIC 2] Absolute Numbering (Calculator)
    let targetAbsoluteOffset = null;
    let targetAbsoluteNumber = null;

    if (season && episode) {
        if (isAoT) targetAbsoluteOffset = getAoT_Offset(season);
        else if (isMHA) targetAbsoluteOffset = getMHA_Offset(season);
        else if (isNarutoShippuden) targetAbsoluteOffset = getNarutoShippuden_Offset(season);

        if (targetAbsoluteOffset !== null) {
            targetAbsoluteNumber = targetAbsoluteOffset + episode;
        }
    }

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
    console.log(`\n=== Xử lý (v40): "${originalName}" (${year}) | S${season}E${episode} ===`);
    if (isDemonSlayer) console.log(`[Special] Demon Slayer Logic: Season ${season}`);
    if (targetAbsoluteNumber) console.log(`[Special] Absolute Mode: Seeking Episode #${targetAbsoluteNumber} (Offset: ${targetAbsoluteOffset})`);

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

    // Extended Isolation
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
                        if (titleRegex) streams = streams.filter(s => titleRegex.test(s.title||s.name||""));
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

                // --- RAM PRE-FILTER (v40) ---
                if (useSmartRegex && targetEpisodeTitle) {
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    if (titleRegex) matchedVideos = matchedVideos.filter(vid => titleRegex.test(vid.title || vid.name || ""));
                } 
                else if (targetAbsoluteNumber !== null) {
                    // [ABSOLUTE MODE] (AoT, MHA S2+, Naruto)
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        const info = extractEpisodeInfo(vidName);
                        // Case 1: Detect explicit "Episode X" where X matches target
                        if (info && info.e === targetAbsoluteNumber) return true;
                        // Case 2: No structure, just finding the number (Risky but necessary for simple "Tap 459")
                        // Ensure number is isolated (not part of 1080p, 2023, etc)
                        const regexAbs = new RegExp(`(?:^|\\s|e|tap|#)0?${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                        return regexAbs.test(vidName);
                    });
                }
                else if (isDemonSlayer) {
                    if (season === 1) {
                        matchedVideos = matchedVideos.filter(vid => {
                            const name = (vid.title || vid.name || "").toLowerCase();
                            if (name.includes("hashira") || name.includes("geiko") || name.includes("mugen")) return false;
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
                            return info && info.s === season && info.e === episode;
                        });
                    }
                }
                else {
                    // Standard Logic
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
                            
                            // --- FINAL STRICT CHECK (v40) ---
                            
                            if (useSmartRegex && targetEpisodeTitle) {
                                const titleRegex = createSmartRegex(targetEpisodeTitle);
                                if (titleRegex && !titleRegex.test(streamTitle)) return;
                            } 
                            else if (targetAbsoluteNumber !== null) {
                                // Absolute Check
                                const info = extractEpisodeInfo(streamTitle);
                                const regexAbs = new RegExp(`(?:^|\\s|e|tap|#)0?${targetAbsoluteNumber}(?:\\s|$|\\.)`, 'i');
                                
                                if (info && info.e === targetAbsoluteNumber) { /* OK */ }
                                else if (regexAbs.test(streamTitle)) { /* OK */ }
                                else return;
                            }
                            else if (isDemonSlayer) {
                                // Re-apply DS logic
                                const sName = streamTitle.toLowerCase();
                                const epRegex = new RegExp(`(?:^|\\s)0?${episode}(?:\\.|\\s|$)`);
                                if (season === 1 && (sName.includes("hashira") || !epRegex.test(sName))) return;
                                if (season === 5 && (!sName.includes("hashira") || !epRegex.test(sName))) return;
                                if ((season !== 1 && season !== 5)) {
                                    const i = extractEpisodeInfo(streamTitle);
                                    if (!i || i.s !== season || i.e !== episode) return;
                                }
                            }
                            else {
                                // Standard Check
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
