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
    name: "Phim4K VIP (Token Match)",
    description: "Fix From, Bet, Short Names using Token Logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN ÁNH XẠ KÉP (QUAN TRỌNG) ===
// Mẹo: Kết hợp cả Tiếng Việt + Tiếng Anh vào value để tìm chính xác
const TITLE_MAPPING = {
    "from": "bẫy from",  // Fix: Bẫy (2022) From
    "bet": "học viện đỏ đen bet", // Fix: Học viện đỏ đen (2025) Bet
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

    // Ưu tiên 1: Từ điển
    const lowerOriginal = originalName.toLowerCase();
    if (TITLE_MAPPING[lowerOriginal]) {
        queries.push(TITLE_MAPPING[lowerOriginal]);
    }

    // Ưu tiên 2: Tên gốc
    queries.push(originalName);

    // Ưu tiên 3: Tên sạch
    if (clean !== lowerOriginal) queries.push(clean);

    // Xử lý hậu tố
    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    // Xử lý dấu hai chấm (Dexter, F1)
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

// === 3. HÀM CHECK KHỚP TỪNG TỪ (TOKEN MATCH) ===
// Giúp tìm "Bẫy From" khớp với "Bẫy (2022) From"
function isTokenMatch(query, targetName) {
    const qTokens = normalizeTitle(query).split(" ");
    const tClean = normalizeTitle(targetName);
    // Tất cả các từ trong query phải xuất hiện trong targetName
    return qTokens.every(token => tClean.includes(token));
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
    
    // Check xem có dùng Mapping không
    const mappedTitle = TITLE_MAPPING[originalName.toLowerCase()];

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

                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // --- LOGIC SO KHỚP TÊN ---
                    let nameMatch = false;

                    // A. Nếu query này đến từ MAPPING (Ví dụ: "bẫy from")
                    if (mappedTitle && query === mappedTitle) {
                        // Dùng thuật toán Token Match: "bẫy from" khớp "bẫy (2022) from"
                        nameMatch = isTokenMatch(query, m.name);
                    }
                    // B. Nếu query quá ngắn (<4 ký tự) như "Bet", "F1"
                    else if (qClean.length < 4) {
                        // Phải bắt đầu chính xác hoặc bằng nhau
                        const strictStart = new RegExp(`^${qClean}(\\s|\\W|$)`, 'i').test(serverNameClean);
                        nameMatch = strictStart;
                    }
                    // C. Bình thường
                    else {
                        nameMatch = serverNameClean.includes(qClean) || qClean.includes(serverNameClean);
                    }

                    // --- LOGIC DEXTER FIX (Subtitle Conflict) ---
                    if (originalName.includes(":") && qClean.length < cleanOriginalName.length) {
                         const originalSuffix = cleanOriginalName.replace(qClean, "").trim();
                         // Nếu hậu tố đủ dài và server name KHÔNG chứa hậu tố đó -> Check kỹ năm
                         if (originalSuffix.length > 3 && !serverNameClean.includes(originalSuffix)) {
                             // Nếu sai số năm > 1 thì bỏ qua luôn (Tránh Original Sin lấy nhầm Resurrection)
                             if (Math.abs(parseInt(m.releaseInfo || "0") - year) > 1) return false;
                         }
                    }

                    // --- LOGIC SO KHỚP NĂM ---
                    let yearMatch = false;
                    if (!hasYear) {
                        yearMatch = true;
                    } else {
                        const yearMatches = m.name.match(/\d{4}/g);
                        if (yearMatches) {
                            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 2);
                        } else if (m.releaseInfo) {
                            yearMatch = m.releaseInfo.includes(year.toString()) 
                                     || m.releaseInfo.includes((year-1).toString()) 
                                     || m.releaseInfo.includes((year+1).toString());
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
