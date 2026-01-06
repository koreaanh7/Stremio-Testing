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
    id: "com.phim4k.vip.final.v38",
    version: "38.0.0",
    name: "Phim4K VIP (Strict Modes)",
    description: "Fixed AoT S1, Regular Show S1/2, T&J 1950",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING ===
const VIETNAMESE_MAPPING = {
    "tom and jerry": ["tom and jerry the golden era anthology", "tom and jerry 1990"],
    "oppenheimer": ["oppenheimer 2023"], // Strict mapping

    // Fix Priority
    "shadow": ["vô ảnh"], 
    "boss": ["đại ca ha ha ha"], 
    "flow": ["lạc trôi", "straume"], 
    "taxi driver": ["tài xế ẩn danh", "taxi driver"],
    "9": ["chiến binh số 9", "9"], 
    "the neverending story": ["câu chuyện bất tận"],
    "o brother, where art thou?": ["3 kẻ trốn tù"],
    "brother": ["brother", "lão đại", "người anh em"],
    "dexter: original sin": ["dexter original sin", "dexter trọng tội"],
    "12 monkeys": ["12 con khỉ"],
    "it": ["gã hề ma quái"],
    "up": ["vút bay"],
    "ted": ["chú gấu ted"],
    "rio": ["chú vẹt đuôi dài"],
    "cars": ["vương quốc xe hơi"],
    "coco": ["coco hội ngộ diệu kì"],
    "elio": ["elio cậu bé đến từ trái đất"],
    "elf": ["chàng tiên giáng trần"],
    "f1": ["f1"],
    "f1: the movie": ["f1"],
    "sentimental value": ["giá trị tình cảm"],
    "dark": ["đêm lặng"],
    "el camino: a breaking bad movie": ["el camino"],

    // Harry Potter
    "harry potter and the sorcerer's stone": ["harry potter colection"],
    "harry potter and the philosopher's stone": ["harry potter colection"],
    "harry potter and the chamber of secrets": ["harry potter colection"],
    "harry potter and the prisoner of azkaban": ["harry potter colection"],
    "harry potter and the goblet of fire": ["harry potter colection"],
    "harry potter and the order of the phoenix": ["harry potter colection"],
    "harry potter and the half-blood prince": ["harry potter colection"],
    "harry potter and the deathly hallows: part 1": ["harry potter colection"],
    "harry potter and the deathly hallows: part 2": ["harry potter colection"],

    // Anime / Ghibli
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
    "chainsaw man - the movie: reze arc": ["chainsaw man movie"],
    "princess mononoke": ["công chúa mononoke"],
    "spirited away": ["vùng đất linh hồn"],
    "howl's moving castle": ["lâu đài bay của pháp sư howl"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "grave of the fireflies": ["mộ đom đóm"],
    "your name": ["tên cậu là gì"],
    "weathering with you": ["đứa con của thời tiết"],
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

// AoT Absolute Logic (Chỉ dùng cho S2+)
function getAoTAbsoluteNumber(season, episode) {
    if (season === 2) return 25 + episode;
    if (season === 3) return 37 + episode;
    if (season === 4) return 59 + episode;
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
    // Ưu tiên SxxEyy
    const matchSE = name.match(/(?:s|season)[\s\.]?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)[\s\.]?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    
    // Support "2x26"
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };
    
    // Support Episode 26 (Weak check, mainly for Absolute mode)
    const matchE = name.match(/(?:e|ep|episode|tap|#)[\s\.]?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };
    
    return null;
}

// === SMART REGEX (Cho T&J và RegShow S3+) ===
function createSmartRegex(episodeName) {
    if (!episodeName) return null;
    // Xóa hết ký tự đặc biệt, chỉ giữ chữ và số
    let cleanName = episodeName.replace(/[^a-zA-Z0-9\s]/g, ""); 
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

    // Bypass
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
            yearMatch = candidate.releaseInfo.includes(year.toString());
        } else yearMatch = true;
    }
    if (serverClean.includes("harry potter colection")) yearMatch = true;
    if (!yearMatch) return false;

    // Mapping Check
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) return true;
        }
    }

    // Queries Check
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        if (serverClean.includes(qClean)) return true;
    }
    return false;
}

function passesSubtitleCheck(candidateName, originalName) {
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

    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) return { streams: [] };

    const originalName = meta.name;
    const lowerOrig = originalName.toLowerCase();
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    // === XÁC ĐỊNH MODE QUÉT (STRICT MODES) ===
    let SCAN_MODE = 'STANDARD'; // Mặc định: STANDARD
    let targetEpisodeTitle = null;
    let targetAoTAbsolute = null;

    const isTomAndJerry = lowerOrig.includes("tom and jerry");
    const isRegularShow = lowerOrig.includes("regular show");
    const isAoT = lowerOrig.includes("attack on titan");
    const isHarryPotter = lowerOrig.includes("harry potter");

    // 1. Setup Mode
    if (isTomAndJerry) {
        SCAN_MODE = 'REGEX';
    } else if (isRegularShow) {
        if (season >= 3) SCAN_MODE = 'REGEX';
        else SCAN_MODE = 'STANDARD'; // S1, S2 dùng chuẩn S/E
    } else if (isAoT) {
        if (season >= 2) SCAN_MODE = 'ABSOLUTE';
        else SCAN_MODE = 'STANDARD'; // S1 dùng chuẩn S/E
    }

    // 2. Prepare Data for Mode
    if (SCAN_MODE === 'REGEX') {
        if (meta.videos && season !== null && episode !== null) {
            const currentVideo = meta.videos.find(v => v.season === season && v.episode === episode);
            if (currentVideo) {
                targetEpisodeTitle = currentVideo.name || currentVideo.title;
            }
        }
    } else if (SCAN_MODE === 'ABSOLUTE') {
        targetAoTAbsolute = getAoTAbsoluteNumber(season, episode);
    }

    // Logging setup
    const queries = [];
    let mappedVietnameseList = VIETNAMESE_MAPPING[lowerOrig];
    if (mappedVietnameseList && !Array.isArray(mappedVietnameseList)) mappedVietnameseList = [mappedVietnameseList];
    if (!mappedVietnameseList) mappedVietnameseList = [];

    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerOrig) queries.push(cleanName);
    
    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý (v38): "${originalName}" S${season}E${episode} | Mode: ${SCAN_MODE} ===`);
    if (SCAN_MODE === 'REGEX') console.log(`   + Target Title: "${targetEpisodeTitle}"`);
    if (SCAN_MODE === 'ABSOLUTE') console.log(`   + Target Absolute: ${targetAoTAbsolute}`);

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
    // Remove duplicates
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    // Subtitle check
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName));

    // Priority Check (Oppenheimer Strict)
    if (mappedVietnameseList.length > 0) {
        const strictMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        if (strictMatches.length > 0) matchedCandidates = strictMatches;
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    
    // In danh sách candidate tìm được
    matchedCandidates.forEach(m => console.log(`   > Found collection: ${m.name}`));

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
                    
                    // --- MOVIE FILTERS ---
                    if (SCAN_MODE === 'REGEX' && targetEpisodeTitle) {
                        const titleRegex = createSmartRegex(targetEpisodeTitle);
                        if (titleRegex) {
                            streams = streams.filter(s => titleRegex.test(s.title || s.name || ""));
                        }
                    } else if (isHarryPotter && hpKeywords) {
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

                // --- SERIES FILTERS (CORE LOGIC) ---
                
                if (SCAN_MODE === 'REGEX' && targetEpisodeTitle) {
                    const titleRegex = createSmartRegex(targetEpisodeTitle);
                    if (titleRegex) {
                        matchedVideos = matchedVideos.filter(vid => {
                            return titleRegex.test(vid.title || vid.name || "");
                        });
                    }
                } 
                else if (SCAN_MODE === 'ABSOLUTE' && targetAoTAbsolute) {
                    matchedVideos = matchedVideos.filter(vid => {
                        const vidName = vid.title || vid.name || "";
                        // Tìm số tuyệt đối
                        if (vidName.includes(` ${targetAoTAbsolute} `) || vidName.includes(`E${targetAoTAbsolute}`)) return true;
                        const info = extractEpisodeInfo(vidName);
                        return (info && info.e === targetAoTAbsolute);
                    });
                } 
                else {
                    // === MODE STANDARD (AoT S1, RegShow S1/2) ===
                    // BẮT BUỘC PHẢI KHỚP S/E CHUẨN
                    matchedVideos = matchedVideos.filter(vid => {
                        const info = extractEpisodeInfo(vid.title || vid.name || "");
                        if (!info) return false;
                        
                        // Fix Taxi Driver (S0) -> Mặc định S1
                        if (info.s === 0 && season === 1) return info.e === episode;
                        
                        // Chuẩn: Season phải khớp, Episode phải khớp
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
                            
                            // DOUBLE CHECK TRƯỚC KHI ADD
                            let isValid = false;

                            if (SCAN_MODE === 'REGEX' && targetEpisodeTitle) {
                                const titleRegex = createSmartRegex(targetEpisodeTitle);
                                if (titleRegex && titleRegex.test(streamTitle)) isValid = true;
                            } 
                            else if (SCAN_MODE === 'ABSOLUTE' && targetAoTAbsolute) {
                                if (streamTitle.includes(`${targetAoTAbsolute}`)) isValid = true;
                            } 
                            else {
                                // MODE STANDARD CHECK
                                const info = extractEpisodeInfo(streamTitle);
                                if (info) {
                                    // Fix S0
                                    if (info.s === 0 && season === 1) {
                                        if (info.e === episode) isValid = true;
                                    } else {
                                        if (info.s === season && info.e === episode) isValid = true;
                                    }
                                }
                            }

                            if (isValid) {
                                console.log(`[OK] Added stream: ${streamTitle}`);
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
                            }
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
