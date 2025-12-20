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
    id: "com.phim4k.vip.final.v15",
    version: "15.0.0",
    name: "Phim4K VIP (Accent Fix)",
    description: "Fix From (Bẫy/Bây), Bet, Kakegurui",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN (Cập nhật Bet & Kakegurui) ===
const TITLE_MAPPING = {
    "from": "bẫy",  // Sẽ dùng check có dấu
    "bet": "kakegurui", // Map Bet sang Kakegurui để tìm thử
    "the wind rises": "gió vẫn thổi",
    "the boy and the heron": "thiếu niên và chim diệc",
    "howl's moving castle": "lâu đài bay của pháp sư howl",
    "spirited away": "vùng đất linh hồn",
    "princess mononoke": "công chúa mononoke",
    "my neighbor totoro": "hàng xóm của tôi là totoro",
    "grave of the fireflies": "mộ đom đóm",
    "ponyo": "cô bé người cá ponyo",
    "weathering with you": "đứa con của thời tiết",
    "your name": "tên cậu là gì",
    "suzume": "khóa chặt cửa nào suzume",
    "5 centimeters per second": "5 centimet trên giây"
};

// Hàm bỏ dấu (dùng cho tiếng Anh hoặc search lỏng)
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// === 2. TẠO TỪ KHÓA ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [];

    const lowerOriginal = originalName.toLowerCase();
    
    // Mapping: Nếu có trong từ điển, đẩy lên đầu
    if (TITLE_MAPPING[lowerOriginal]) {
        queries.push(TITLE_MAPPING[lowerOriginal]);
    }

    // Nếu tên gốc là "Bet", thêm cả "kakegurui" vào để search (phòng hờ server chưa đổi tên)
    if (lowerOriginal === 'bet') {
        queries.push("kakegurui");
    }

    queries.push(originalName);
    if (clean !== lowerOriginal) queries.push(clean);

    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        if (splitName.length > 3 || splitName.toLowerCase() === 'f1') {
            queries.push(splitName);
        }
    }

    const noSpace = clean.replace(/\s/g, "");
    if (noSpace !== clean) queries.push(noSpace);

    return [...new Set(queries)];
}

async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    const matchSE = name.match(/(?:s|season)\s?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)\s?(\d{1,2})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    const matchX = name.match(/(\d{1,2})x(\d{1,2})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };
    const matchE = name.match(/(?:e|ep|episode|tap)\s?(\d{1,2})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };
    return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("tt")) return { streams: [] };

    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) return { streams: [] };

    const originalName = meta.name;
    const cleanOriginalName = normalizeTitle(originalName);
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    const searchQueries = getSearchQueries(originalName);
    // Lấy tên map gốc (có dấu) để check
    const mappedTitleRaw = TITLE_MAPPING[originalName.toLowerCase()]; 

    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(searchQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    for (const query of searchQueries) {
        if (match) break; 

        const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`;
        try {
            const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 6000 });
            
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                
                match = res.data.metas.find(m => {
                    if (m.type && m.type !== type) return false;

                    const rawServerName = m.name.toLowerCase(); // Tên có dấu của server
                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // --- CHECK 1: TÊN (NÂNG CẤP CHECK DẤU) ---
                    let nameMatch = false;

                    // A. Trường hợp đặc biệt: FROM (Bẫy)
                    // Nếu mapping là "bẫy", ta bắt buộc server name phải chứa chữ "bẫy" (có dấu)
                    // để tránh nhầm với "bây" (trong "bây giờ")
                    if (mappedTitleRaw && mappedTitleRaw === "bẫy") {
                         // Check chính xác từ "bẫy" hoặc "From" đứng một mình
                         const hasBay = rawServerName.includes("bẫy"); 
                         const hasExactFrom = /\bfrom\b/.test(rawServerName); // Regex: chữ From phải đứng riêng
                         
                         nameMatch = hasBay || hasExactFrom;
                    }
                    // B. Trường hợp dùng Mapping khác (Gió nổi,...) -> Check chứa (có dấu càng tốt)
                    else if (mappedTitleRaw && normalizeTitle(mappedTitleRaw) === qClean) {
                         nameMatch = rawServerName.includes(mappedTitleRaw) || serverNameClean.includes(qClean);
                    }
                    // C. Trường hợp tên ngắn (< 4 ký tự) như "Bet", "F1"
                    else if (qClean.length < 4) {
                        const strictStart = new RegExp(`^${qClean}(\\s|\\W|$)`, 'i').test(serverNameClean);
                        nameMatch = strictStart;
                    } 
                    // D. Tên thường
                    else {
                        nameMatch = serverNameClean.includes(qClean) || qClean.includes(serverNameClean);
                    }

                    if (!nameMatch) return false;

                    // --- CHECK 2: NĂM (NÂNG CẤP CHO KAKEGURUI) ---
                    let yearMatch = false;
                    if (!hasYear) {
                        yearMatch = true;
                    } else {
                        // Lấy tất cả năm trong tên server
                        const yearMatches = m.name.match(/\d{4}/g);
                        
                        // FIX KAKEGURUI: Nếu tên là "Kakegurui" (dễ trùng Anime/Live Action)
                        // Ta giảm sai số năm xuống 0 hoặc 1 (ngặt nghèo hơn) thay vì 2
                        const isRiskyTitle = qClean.includes("kakegurui") || qClean.includes("bet");
                        const tolerance = isRiskyTitle ? 1 : 2; 

                        if (yearMatches) {
                            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
                        } else if (m.releaseInfo) {
                            // Check release info
                            for (let i = 0; i <= tolerance; i++) {
                                if (m.releaseInfo.includes((year + i).toString()) || m.releaseInfo.includes((year - i).toString())) {
                                    yearMatch = true; break;
                                }
                            }
                        } else {
                            yearMatch = true; 
                        }
                    }
                    
                    return nameMatch && yearMatch;
                });
            }
        } catch (e) {}
    }

    if (!match) return { streams: [] };

    const fullId = match.id;
    console.log(`-> KHỚP: ${match.name} | ID: ${fullId}`);

    // === LẤY STREAM ===
    try {
        if (type === 'movie') {
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });
            if (streamRes.data && streamRes.data.streams) {
                return {
                    streams: streamRes.data.streams.map(s => ({
                        name: "Phim4K VIP",
                        title: s.title || s.name,
                        url: s.url,
                        behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                    }))
                };
            }
        } else if (type === 'series') {
            const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
            const metaRes = await axios.get(metaUrl, { headers: HEADERS });
            if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return { streams: [] };

            const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                const info = extractEpisodeInfo(vid.title || vid.name || "");
                if (!info) return false;
                if (info.s !== 0) return info.s === season && info.e === episode;
                if (info.s === 0) return info.e === episode;
                return false;
            });

            const streams = [];
            for (const vid of matchedVideos) {
                const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                try {
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            streams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: s.title || vid.title,
                                url: s.url,
                                behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                            });
                        });
                    }
                } catch (e) {}
            }
            return { streams: streams };
        }
    } catch (err) {}

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
