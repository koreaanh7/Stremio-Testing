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
    id: "com.phim4k.vip.final.v37",
    version: "37.0.0",
    name: "Phim4K VIP (AoT & RegShow Fix)",
    description: "Added Absolute Numbering for AoT, Regular Show S3+ Fix, Strict Oppenheimer",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING ===
const VIETNAMESE_MAPPING = {
    // --- SPECIAL CASES ---
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    "regular show": ["regular show"], // Để đảm bảo tìm ra series
    "attack on titan": ["attack on titan", "shingeki no kyojin"],
    
    // --- STRICT FIX (User Request) ---
    "oppenheimer": ["oppenheimer 2023"], // Map cứng vào 2023

    // --- FIX PRIORITY (v33) ---
    "shadow": ["vô ảnh"], 
    "boss": ["đại ca ha ha ha"], 
    "flow": ["lạc trôi", "straume"], 
    "taxi driver": ["tài xế ẩn danh", "taxi driver"],

    // --- CÁC FIX KHÁC ---
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

// === SMART REGEX (Regular Show + T&J) ===
// Loại bỏ ' ! ? . , : trước khi tạo Regex
function createSmartRegex(episodeName) {
    if (!episodeName) return null;
    // Thêm việc loại bỏ dấu hai chấm (:) theo yêu cầu Regular Show
    let cleanName = episodeName.replace(/['"!?,.:]/g, ""); 
    cleanName = cleanName.trim();
    if (cleanName.length === 0) return null;
    const words = cleanName.split(/\s+/).map(w => w.replace(/[.*+^${}()|[\]\\]/g, '\\$&'));
    const pattern = words.join("[\\W_]+");
    return new RegExp(pattern, 'i');
}

// === ATTACK ON TITAN CALCULATOR ===
function getAoTAbsoluteEpisode(season, episode) {
    // S1: 25 Eps (1-25)
    // S2: 12 Eps (Start 26)
    // S3: 22 Eps (Start 38) -> Part 1(12) + Part 2(10)
    // S4: Start 60
    let offset = 0;
    if (season === 1) offset = 0;
    else if (season === 2) offset = 25;
    else if (season === 3) offset = 37; // 25 + 12
    else if (season === 4) offset = 59; // 37 + 22
    return offset + episode;
}

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;
    if (originalName.toLowerCase().includes("tom and jerry") && serverClean.includes("tom and jerry")) return true;
    if (originalName.toLowerCase().includes("regular show") && serverClean.includes("regular show")) return true;

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
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    // === PHÂN LOẠI PHIM ĐẶC BIỆT ===
    const lowerName = originalName.toLowerCase();
    const isTomAndJerry = lowerName.includes("tom and jerry");
    const isRegularShow = lowerName.includes("regular show");
    const isAoT = lowerName.includes("attack on titan") || lowerName.includes("shingeki no kyojin");
    const isOppenheimer = lowerName.includes("oppenheimer");

    // Lấy tên tập phim từ Meta (dùng cho T&J và Regular Show)
    let targetEpisodeTitle = null;
    if (meta.videos && season !== null && episode !== null) {
        const currentVideo = meta.videos.find(v => v.season === season && v.episode === episode);
        if (currentVideo) {
            targetEpisodeTitle = currentVideo.name || currentVideo.title;
        }
    }

    // Quyết định có dùng chế độ "Tìm theo tên Regex" không
    // 1. T&J: Luôn dùng
    // 2. Regular Show: Chỉ dùng nếu Season >= 3
    let useTitleRegexMode = isTomAndJerry || (isRegularShow && season >= 3);

    const queries = [];
    
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerName];
    if (mappingRaw) mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];

    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') queries.push(splitName);
    }
    if (/\d/.test(cleanName) && cleanName.includes(" ")) queries.push(cleanName.replace(/\s/g, ""));
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý (v37): "${originalName}" (${year}) | Type: ${type} ===`);

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

    const isHarryPotter = lowerName.includes("harry potter");

    // 1. Subtitle Check
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName, uniqueQueries));

    // 2. VIETNAMESE PRIORITY & STRICT OPPENHEIMER
    if (mappedVietnameseList.length > 0) {
        const strictVietnameseMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        
        // --- LOGIC OPPENHEIMER: KHÔNG ĐƯỢC LẤY KHÁC ---
        if (isOppenheimer && strictVietnameseMatches.length > 0) {
            // Chỉ giữ lại cái nào có '2023' trong tên hoặc releaseInfo nếu đã tìm thấy match ưu tiên
            // Ở đây strictVietnameseMatches đã là những cái khớp "oppenheimer 2023" rồi.
            console.log(`-> (v37) Strict Filter: Oppenheimer (Only 2023 allowed).`);
            matchedCandidates = strictVietnameseMatches; 
        } else if (strictVietnameseMatches.length > 0) {
            console.log(`-> (v37) Priority: Tìm thấy tên tiếng Việt ưu tiên.`);
            matchedCandidates = strictVietnameseMatches;
        }
    }

    // 3. Golden Match
    if (matchedCandidates.length > 1 && !isHarryPotter && !isTomAndJerry && !isRegularShow) {
        const oClean = normalizeForSearch(originalName);
        const goldenMatches = matchedCandidates.filter(m => {
            let mClean = normalizeForSearch(m.name);
            mClean = mClean.replace(year.toString(), "").trim();
            return mClean === oClean;
        });
        if (goldenMatches.length > 0 && matchedCandidates.length > goldenMatches.length) {
             // Priority logic
        }
    }
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter && !isTomAndJerry && !isRegularShow) {
        const exactMatches = matchedCandidates.filter(m => checkExactYear(m, year));
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    // 4. Extended Isolation (Skip for special cases)
    if (cleanName.length <= 9 && matchedCandidates.length > 0 && !isTomAndJerry && !isRegularShow) {
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
                    
                    // --- TOM & JERRY SMART FILTER ---
                    if (useTitleRegexMode && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) {
                            streams = streams.filter(s => titleRegex.test(s.title || s.name || ""));
                        }
                    } 
                    // --- HARRY POTTER FILTER ---
                    else if (isHarryPotter && hpKeywords) {
                        streams = streams.filter(s => {
                            const sTitle = (s.title || s.name || "").toLowerCase();
                            const hasKeyword = hpKeywords.some(kw => sTitle.includes(kw));
                            if (hpKeywords.includes("part 1") && (sTitle.includes("part 2") || sTitle.includes("pt.2"))) return false;
                            return hasKeyword;
                        });
                    }

                    return streams.map(s => {
                        console.log(`[DEBUG USER-AGENT] Injecting KSPlayer/1.0 for Movie: ${s.title || s.name}`);
                        return {
                            name: "Phim4K VIP", 
                            title: s.title || s.name,
                            url: s.url,
                            behaviorHints: { 
                                notWebReady: false, 
                                bingeGroup: "phim4k-vip",
                                proxyHeaders: { request: { "User-Agent": "KSPlayer/1.0" } },
                                headers: { "User-Agent": "KSPlayer/1.0" }
                            }
                        };
                    });
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                let matchedVideos = metaRes.data.meta.videos;

                // --- (v37) LOGIC LỌC VIDEO (Optimized) ---
                if (useTitleRegexMode && targetEpisodeTitle) {
                    // 1. Logic T&J hoặc Regular Show S3+: Lọc theo Regex Tên
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    if (titleRegex) {
                        matchedVideos = matchedVideos.filter(vid => titleRegex.test(vid.title || vid.name || ""));
                    }
                } else if (isAoT) {
                    // 2. Logic Attack on Titan: Bypass luôn việc lọc ID trong Meta, lấy tất cả để check Absolute
                    // Vì AoT trên Phim4K thường gom 1 cục, hoặc chia S1, S2 nhưng tập S2 lại đánh số 26
                    // Ta sẽ lọc kỹ ở bước Stream bên dưới. Ở đây ta giữ lại tất cả video của season tương ứng (nếu có chia)
                    // Hoặc đơn giản là lấy tất cả nếu server gom cục.
                    // Để an toàn và nhanh, ta chỉ lọc sơ:
                    // Attack on Titan thường không cần lọc Meta Videos quá gắt, quan trọng là Link Stream.
                } else {
                    // 3. Logic Thông thường (S/E)
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        if (info.s === 0) return season === 1 && info.e === episode; // Fix Taxi Driver
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
                            
                            // --- FINAL FILTERING TRÊN STREAM TITLE ---

                            if (useTitleRegexMode && targetEpisodeTitle) {
                                // Logic 1: Regex Title Check (T&J, Regular Show S3+)
                                const titleRegex = createSmartRegex(targetEpisodeTitle);
                                if (titleRegex && !titleRegex.test(streamTitle)) return;

                            } else if (isAoT) {
                                // Logic 2: Attack on Titan Absolute Numbering
                                const absEpisode = getAoTAbsoluteEpisode(season, episode);
                                const info = extractEpisodeInfo(streamTitle);
                                
                                // Kiểm tra:
                                // a. Nếu info.e khớp absEpisode (ví dụ file ghi E26, ta cần tập 26) -> OK
                                // b. Nếu file ghi đúng chuẩn S2E1? (hiếm với nguồn này nhưng cứ check) -> OK
                                let isMatchAoT = false;
                                if (info) {
                                    if (info.e === absEpisode) isMatchAoT = true; // Khớp số tập tuyệt đối (E26)
                                    else if (info.s === season && info.e === episode) isMatchAoT = true; // Khớp chuẩn (S2E1)
                                }
                                if (!isMatchAoT) return; // Không khớp thì bỏ qua

                            } else {
                                // Logic 3: Standard Check
                                const streamInfo = extractEpisodeInfo(streamTitle);
                                if (streamInfo) {
                                    if (streamInfo.s === 0) { if (season !== 1) return; } 
                                    else { if (streamInfo.s !== season) return; }
                                    if (streamInfo.e !== episode) return;
                                }
                            }

                            console.log(`[DEBUG USER-AGENT] Injecting KSPlayer/1.0 for Series: ${s.title}`);
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
