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
    id: "com.phim4k.vip.final.v35",
    version: "35.0.0",
    name: "Phim4K VIP (Regex & Strict)",
    description: "Fix Oppenheimer strict & Tom and Jerry Regex search",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING ===
const VIETNAMESE_MAPPING = {
    // --- FIX V35 (STRICT & REGEX) ---
    "oppenheimer": ["oppenheimer"], // Sẽ kích hoạt logic check năm nghiêm ngặt
    "tom and jerry": ["tom and jerry the golden era anthology"], // Map vào collection tổng

    // --- FIX PRIORITY (V33/34) ---
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

// Hàm tạo Regex quét tên tập phim (Tom and Jerry)
function createTitleRegex(title) {
    if (!title) return null;
    // Tách các từ, loại bỏ ký tự đặc biệt, nối lại bằng [\W_.]+ (khớp mọi ký tự không phải chữ/số hoặc dấu chấm/gạch)
    const cleanWords = title.toLowerCase()
        .replace(/['":\-.()\[\]?,!]/g, "") // Bỏ dấu câu trong tên gốc
        .split(/\s+/)
        .filter(w => w.length > 0);
    
    if (cleanWords.length === 0) return null;
    
    // Pattern: word1[\W_.]+word2[\W_.]+word3
    const pattern = cleanWords.join("[\\W_.]+");
    return new RegExp(pattern, 'i');
}

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    if (serverClean.includes("harry potter colection") && originalName.toLowerCase().includes("harry potter")) return true;

    // --- LOGIC ĐẶC BIỆT CHO OPPENHEIMER (V35) ---
    // Nếu phim là Oppenheimer, BẮT BUỘC server phải có năm 2023.
    // Loại bỏ các phim tài liệu (thường ko có năm hoặc sai năm)
    if (normalizeForSearch(originalName) === "oppenheimer") {
        const has2023 = serverName.includes("2023") || (candidate.releaseInfo && candidate.releaseInfo.includes("2023"));
        if (!has2023) return false; 
    }

    // Year Check Thường
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
    // Tom and Jerry: Bỏ qua check năm vì tên file loạn xạ (1940, 1941...)
    if (originalName.toLowerCase().includes("tom and jerry")) yearMatch = true;

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
    console.log(`\n=== Xử lý (v35): "${originalName}" (${year}) | Type: ${type} ===`);

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
    // --- CHECK TOM AND JERRY ---
    const isTomAndJerry = originalName.toLowerCase().includes("tom and jerry");

    // 1. Subtitle Check
    matchedCandidates = matchedCandidates.filter(m => passesSubtitleCheck(m.name, originalName, uniqueQueries));

    // 2. VIETNAMESE PRIORITY FILTER
    if (mappedVietnameseList.length > 0) {
        const strictVietnameseMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            return mappedVietnameseList.some(map => mClean.includes(normalizeForSearch(map)));
        });
        if (strictVietnameseMatches.length > 0) {
            console.log(`-> (v35) Priority: Filter theo mapping ưu tiên (Shadow, Flow, Oppenheimer, T&J...).`);
            matchedCandidates = strictVietnameseMatches;
        }
    }

    // 3. Golden Match & Fallback Year
    if (matchedCandidates.length > 1 && !isHarryPotter && !isTomAndJerry) {
        const oClean = normalizeForSearch(originalName);
        const goldenMatches = matchedCandidates.filter(m => {
            let mClean = normalizeForSearch(m.name);
            mClean = mClean.replace(year.toString(), "").trim();
            return mClean === oClean;
        });
        if (goldenMatches.length > 0 && matchedCandidates.length > goldenMatches.length) {
            // (Pass)
        }
    }
    if (hasYear && matchedCandidates.length > 1 && !isHarryPotter && !isTomAndJerry) {
        const exactMatches = matchedCandidates.filter(m => checkExactYear(m, year));
        if (exactMatches.length > 0) matchedCandidates = exactMatches;
    }

    // 4. Extended Isolation
    if (cleanName.length <= 9 && matchedCandidates.length > 0) {
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
                    if (isHarryPotter && hpKeywords) {
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

                // --- LOGIC TOM AND JERRY (V35) ---
                let targetEpisodeTitleRegex = null;
                if (isTomAndJerry) {
                    // 1. Tìm tập phim user đang request trong Metadata của Cinemeta
                    const targetVideo = metaRes.data.meta.videos.find(v => {
                        // Logic tìm video ID khớp với ID request (ví dụ: tt0033169:1940:1)
                        // Tuy nhiên meta.videos thường có format ID giống request
                        return v.id === id || (v.season === season && v.episode === episode);
                    });

                    if (targetVideo && (targetVideo.title || targetVideo.name)) {
                        const epTitle = targetVideo.title || targetVideo.name;
                        targetEpisodeTitleRegex = createTitleRegex(epTitle);
                        console.log(`[DEBUG T&J] Tìm pattern cho tập: "${epTitle}" -> Regex: ${targetEpisodeTitleRegex}`);
                    }
                }
                // ---------------------------------

                const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                    const info = extractEpisodeInfo(vid.title || vid.name || "");
                    if (!info) return false;
                    // FIX TAXI DRIVER
                    if (info.s === 0) return season === 1 && info.e === episode;
                    return info.s === season && info.e === episode;
                });

                let episodeStreams = [];
                // Nếu là Tom&Jerry, ta phải quét stream của chính Match này (Collection), chứ ko phải loop qua matchedVideos (thường ko khớp)
                // Tuy nhiên cấu trúc code hiện tại loop qua matchedVideos để lấy ID video con.
                // Với trường hợp collection lộn xộn, ta cần lấy stream của chính cái Series ID (match.id) nếu server hỗ trợ, 
                // hoặc lấy stream của tập đầu tiên tìm thấy để quét list?
                // Cách tốt nhất với Phim4K series: Thường họ trả về list tập trong stream của ID gốc hoặc các ID con.
                
                // VỚI TOM AND JERRY: Ta sẽ lấy danh sách stream của chính episode match (theo server)
                // Nhưng vì server lệch tập, ta sẽ thử lấy streams của tập 1 (hoặc bất kỳ tập nào) rồi lọc?
                // KHÔNG, Phim4K cấu trúc series là mỗi tập 1 ID.
                // Nếu map vào Collection, match.id là ID của collection.
                // Ta cần lấy danh sách episodes từ match.id (Metadata của Phim4K).
                
                // SỬA LOGIC LOOP:
                // Ta sẽ dùng danh sách videos từ Phim4K (đã lấy ở metaRes bên trên)
                // Loop qua videos của Phim4K, tìm file khớp Regex hoặc khớp S/E.

                const serverVideos = metaRes.data.meta.videos; // Videos từ Phim4K

                for (const sv of serverVideos) {
                    // Logic lọc video của Server
                    let isTargetVideo = false;

                    if (isTomAndJerry && targetEpisodeTitleRegex) {
                        // Nếu là Tom & Jerry, kiểm tra tên tập (Title của Server Video) có khớp Regex không
                        const svTitle = sv.title || sv.name || "";
                        if (targetEpisodeTitleRegex.test(svTitle)) {
                            isTargetVideo = true;
                            console.log(`[DEBUG T&J] MATCHED FILE: ${svTitle}`);
                        }
                    } else {
                        // Logic cũ (Taxi Driver, phim thường)
                        const info = extractEpisodeInfo(sv.title || sv.name || "");
                        if (info) {
                            if (info.s === 0) {
                                if (season === 1 && info.e === episode) isTargetVideo = true;
                            } else {
                                if (info.s === season && info.e === episode) isTargetVideo = true;
                            }
                        }
                    }

                    if (isTargetVideo) {
                        const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(sv.id)}.json`;
                        const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                        
                        if (sRes.data && sRes.data.streams) {
                            sRes.data.streams.forEach(s => {
                                console.log(`[DEBUG USER-AGENT] Injecting KSPlayer/1.0 for Series: ${s.title}`);
                                episodeStreams.push({
                                    name: isTomAndJerry ? "Phim4K VIP (T&J)" : `Phim4K S${season}E${episode}`,
                                    title: (s.title || sv.title) + `\n[${match.name}]`,
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
