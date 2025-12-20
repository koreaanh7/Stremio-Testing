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
    id: "com.phim4k.vip.final.v13",
    version: "13.0.0",
    name: "Phim4K VIP (Dict & Strict)",
    description: "Fix From, Lost, Ghibli, Dexter & Strict Filtering",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN ÁNH XẠ (Manual Mapping) ===
// Giúp tìm ngay các phim có tên tiếng Việt hoặc tên khó
const TITLE_MAPPING = {
    "from": "nguồn gốc",
    "lost": "mất tích",
    "dark": "đêm lặng",
    "howl's moving castle": "lâu đài bay của pháp sư howl",
    "the wind rises": "gió nổi",
    "spirited away": "vùng đất linh hồn",
    "princess mononoke": "công chúa mononoke",
    "my neighbor totoro": "hàng xóm của tôi là totoro",
    "grave of the fireflies": "mộ đom đóm",
    "ponyo": "cô bé người cá ponyo",
    "weathering with you": "đứa con của thời tiết",
    "your name": "tên cậu là gì"
};

// === 2. HÀM CHUẨN HÓA ===
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// === 3. TẠO TỪ KHÓA TÌM KIẾM ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [];

    // Ưu tiên 1: Kiểm tra trong từ điển MAPPING
    const lowerOriginal = originalName.toLowerCase();
    if (TITLE_MAPPING[lowerOriginal]) {
        queries.push(TITLE_MAPPING[lowerOriginal]); // Thêm tên tiếng Việt vào đầu danh sách
    }

    queries.push(originalName); // Tên gốc
    if (clean !== lowerOriginal) queries.push(clean); // Tên sạch

    // Xử lý hậu tố (F1: The Movie -> F1)
    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    // Xử lý dấu hai chấm (Chỉ dùng nếu tên dài, tránh cắt ngắn quá đà gây nhầm lẫn)
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        // Chỉ thêm tên ngắn nếu nó đủ dài (>3 ký tự) hoặc là F1
        if (splitName.length > 3 || splitName.toLowerCase() === 'f1') {
            queries.push(splitName);
        }
    }

    // Dính liền (10Dance)
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
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    const searchQueries = getSearchQueries(originalName);
    console.log(`\n=== Xử lý: "${originalName}" (${hasYear ? year : 'No Year'}) | Type: ${type} ===`);
    console.log(`-> Query list: ${JSON.stringify(searchQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    for (const query of searchQueries) {
        if (match) break; 

        const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`;
        try {
            const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 6000 });
            
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                
                match = res.data.metas.find(m => {
                    // 1. KIỂM TRA TYPE (Quan trọng: Lost series không được lấy Lost movie)
                    // Nếu server trả về type, hãy check. Nếu server 'mù' type, bỏ qua bước này.
                    if (m.type && m.type !== type) return false;

                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // 2. CHECK TÊN (STRICT MODE CHO TÊN NGẮN)
                    let nameMatch = false;
                    
                    // Nếu từ khóa tìm kiếm quá ngắn (< 4 ký tự) như "From", "Lost"
                    // Bắt buộc tên Server phải BẮT ĐẦU bằng từ đó, chứ không phải CHỨA nó ở giữa
                    if (qClean.length < 4) {
                        // Regex: Bắt đầu bằng tên phim + (kết thúc luôn HOẶC có dấu cách/kí tự lạ phía sau)
                        // Ví dụ: Query "From" -> Khớp "From", "From (2022)", "From - SS1"
                        // -> KHÔNG Khớp "Money Heist: From..."
                        const strictRegex = new RegExp(`^${qClean}$|^${qClean}\\s|^${qClean}\\W`, 'i');
                        nameMatch = strictRegex.test(serverNameClean);
                    } else {
                        // Tên dài thì dùng includes như bình thường
                        nameMatch = serverNameClean.includes(qClean) || qClean.includes(serverNameClean);
                    }

                    // 3. CHECK NĂM
                    let yearMatch = false;
                    if (!hasYear) {
                        yearMatch = true;
                    } else {
                        const yearMatches = m.name.match(/\d{4}/g);
                        if (yearMatches) {
                            // Sai số +/- 2 năm
                            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 2);
                        } else if (m.releaseInfo) {
                            yearMatch = m.releaseInfo.includes(year.toString()) 
                                     || m.releaseInfo.includes((year-1).toString()) 
                                     || m.releaseInfo.includes((year+1).toString());
                        } else {
                            yearMatch = true; 
                        }
                    }
                    
                    if (nameMatch && yearMatch) {
                        // 4. CHECK PHỤ ĐỀ (Fix Dexter)
                        // Nếu search "Dexter" (từ split) mà kết quả là "Dexter Resurrection", 
                        // trong khi phim gốc là "Dexter Original Sin" -> Cần cẩn thận.
                        // Tuy nhiên, check năm thường đã loại trừ được rồi (Original Sin 2024 vs Resurrection 2025).
                        // Code này dựa vào sai số năm <= 2, nên vẫn có rủi ro nhỏ. 
                        // Nhưng vì ta đã ưu tiên search tên gốc "Dexter Original Sin" trước, nên nếu server có phim đúng, nó sẽ khớp trước.
                        
                        console.log(`   -> KHỚP (${query}): ${m.name} [Type: ${m.type || 'N/A'}]`);
                        return true;
                    }
                    return false;
                });
            }
        } catch (e) {}
    }

    if (!match) return { streams: [] };

    const fullId = match.id;

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
