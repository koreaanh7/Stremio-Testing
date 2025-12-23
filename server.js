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
    id: "com.phim4k.vip.final.v28",
    version: "28.0.0",
    name: "Phim4K VIP (Absolute Purist)",
    description: "Fix Oppenheimer Documentary, Dexter, From/Baymax",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING ===
const VIETNAMESE_MAPPING = {
    "from": ["bẫy"], 
    "dexter: original sin": ["dexter original sin", "dexter trọng tội", "dexter sát thủ"],
    "oppenheimer": ["oppenheimer"], 
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

// --- HELPER FUNCTIONS ---

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
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// === HÀM MỚI: LÀM SẠCH TUYỆT ĐỐI ĐỂ SO SÁNH (v28) ===
function cleanNameStrict(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/\(\d{4}\)/g, "") // Xóa (2023)
        .replace(/\d{4}/g, "")      // Xóa 2023
        .replace(/[^a-z0-9]/g, ""); // Chỉ giữ lại chữ và số
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

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;

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

    // Fix "Bẫy" vs "Baymax" bằng Regex Boundary
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
        if (qClean.length <= 4) {
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) {
                if (serverClean.length <= qClean.length * 7) return true;
            }
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

// Fix Dexter Subtitle
function passesSubtitleCheck(candidateName, originalName) {
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

    const queries = [];
    const lowerName = originalName.toLowerCase();
    
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
    console.log(`\n=== Xử lý (v28): "${originalName}" (${year}) | Type: ${type} ===`);

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

    const isHarryPotter = originalName.toLowerCase().includes("harry potter");
    
    // 1. Check Subtitle (Dexter)
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName));

    // 2. ABSOLUTE PURIST FILTER (Fix Oppenheimer)
    // Nếu tìm thấy phim khớp tên tuyệt đối (sau khi xóa năm), chỉ giữ lại nó.
    // NHƯNG: Vẫn giữ lại các phim khớp Mapping tiếng Việt (để không mất "Up" - "Vút Bay")
    if (matchedCandidates.length > 1 && !isHarryPotter) {
        const strictOriginal = cleanNameStrict(originalName);
        
        const exactMatches = matchedCandidates.filter(m => {
            const strictCandidate = cleanNameStrict(m.name);
            return strictCandidate === strictOriginal;
        });

        if (exactMatches.length > 0) {
            console.log(`-> (v28) Đã kích hoạt bộ lọc tuyệt đối cho "${originalName}"`);
            
            // Giữ lại Exact Match VÀ các phim nằm trong Mapping (để bảo vệ tên tiếng Việt khác hoàn toàn)
            matchedCandidates = matchedCandidates.filter(m => {
                // Giữ nếu là Exact Match
                if (cleanNameStrict(m.name) === strictOriginal) return true;
                
                // Giữ nếu khớp Mapping Tiếng Việt (Bảo vệ "Vút Bay" khi tìm "Up")
                const mClean = normalizeForSearch(m.name);
                if (mappedVietnameseList.length > 0) {
                    return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
                }
                return false;
            });
        }
    }

    // 3. Exact Year Check (Fallback)
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter) {
        const exactMatches = matchedCandidates.filter(m => checkExactYear(m, year));
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    // 4. Short Title Cleanup (Whitelist Protected)
    if (cleanName.length <= 5 && matchedCandidates.length > 1) {
        matchedCandidates.sort((a, b) => a.name.length - b.name.length);
        const minLen = matchedCandidates[0].name.length;
        matchedCandidates = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            if (mappedVietnameseList.length > 0) {
                const isMapped = mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
                if (isMapped) return true;
            }
            return m.name.length <= minLen * 4;
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
                    if (isHarryPotter && hpKeywords) {
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
                        behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                    }));
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];
                const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                    const info = extractEpisodeInfo(vid.title || vid.name || "");
                    if (!info) return false;
                    if (info.s === 0) return info.e === episode; 
                    return info.s === season && info.e === episode;
                });
                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            const streamTitle = s.title || s.name || "";
                            const streamInfo = extractEpisodeInfo(streamTitle);
                            if (streamInfo && streamInfo.s !== 0) {
                                if (streamInfo.s !== season || streamInfo.e !== episode) return;
                            }
                            episodeStreams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: (s.title || vid.title) + `\n[${match.name}]`,
                                url: s.url,
                                behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
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
