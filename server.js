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
    name: "Phim4K VIP (Vietnamese & Strict Fix)",
    description: "Fix From, Lost, Dexter, Dark, Howl's Moving Castle",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN TAY (MAPPING) ===
// Giúp tìm những phim server chỉ lưu tên Việt hoặc tên khác lạ
const TITLE_MAPPING = {
    "dark": ["đêm lặng", "dark"],
    "howl's moving castle": ["lâu đài bay của howl", "howl's moving castle"],
    "spirited away": ["vùng đất linh hồn"],
    "from": ["from", "nguồn gốc"], // From thường giữ nguyên hoặc dịch Nguồn Gốc
    "lost": ["lost", "mất tích"],
    "soul": ["cuộc sống nhiệm màu", "soul"],
    "up": ["vút bay", "up"],
    "f1": ["f1"] // Ép buộc tìm F1 ngắn gọn
};

// === 2. CHUẨN HÓA TÊN ===
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// === 3. TẠO TỪ KHÓA TÌM KIẾM (UPDATED) ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [originalName]; 

    // A. Check từ điển trước
    const lowerName = originalName.toLowerCase();
    if (TITLE_MAPPING[lowerName]) {
        return TITLE_MAPPING[lowerName]; // Nếu có trong từ điển, dùng ngay list này
    }

    // B. Logic tự động
    if (clean !== lowerName) queries.push(clean);

    // Bỏ hậu tố "The Movie"
    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    // Cắt dấu hai chấm (Dexter: Original Sin -> Dexter Original Sin)
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        queries.push(splitName); 
    }

    // Dính liền (10Dance)
    const noSpace = clean.replace(/\s/g, "");
    if (noSpace !== clean) queries.push(noSpace);

    return [...new Set(queries)].filter(q => q.length >= 2 || originalName.length <= 2);
}

// === 4. THUẬT TOÁN TÍNH ĐIỂM KHỚP (STRICT MATCHING) ===
// Khắc phục vụ Dexter Original Sin nhận nhầm Dexter Resurrection
function calculateMatchScore(queryClean, serverNameClean) {
    // Tách từ: "dexter original sin" -> ["dexter", "original", "sin"]
    const queryWords = queryClean.split(" ");
    const serverWords = serverNameClean.split(" ");

    let matches = 0;
    queryWords.forEach(w => {
        if (serverWords.includes(w)) matches++;
    });

    // Nếu tên query ngắn (1 từ) -> Phải khớp chính xác hoàn toàn
    if (queryWords.length === 1) {
        return (queryClean === serverNameClean || serverNameClean === queryClean) ? 100 : 0;
    }

    // Tính % số từ khớp
    return (matches / queryWords.length) * 100;
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
    const cleanName = normalizeTitle(originalName);
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    const searchQueries = getSearchQueries(originalName);
    console.log(`\n=== Xử lý: "${originalName}" (${hasYear ? year : 'NaN'}) ===`);
    console.log(`-> Keywords: ${JSON.stringify(searchQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    // === VÒNG LẶP TÌM KIẾM ===
    for (const query of searchQueries) {
        if (match) break; 

        const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`;
        try {
            const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 6000 });
            
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                
                // === BỘ LỌC THÔNG MINH (NÂNG CẤP) ===
                match = res.data.metas.find(m => {
                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // 1. Check Năm
                    let yearMatch = false;
                    if (!hasYear) yearMatch = true;
                    else {
                        const yearMatches = m.name.match(/\d{4}/g);
                        if (yearMatches) yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 2);
                        else if (m.releaseInfo) yearMatch = m.releaseInfo.includes(year.toString());
                        else yearMatch = true; 
                    }
                    if (!yearMatch) return false;

                    // 2. Check Tên (Dùng Score)
                    // Nếu dùng Từ điển Mapping (Dark -> Đêm lặng) -> Chấp nhận luôn nếu chuỗi khớp
                    if (TITLE_MAPPING[originalName.toLowerCase()]) {
                        if (serverNameClean.includes(qClean)) return true;
                    }

                    // Logic so sánh từ (Token Check) cho Dexter, From, Lost...
                    const score = calculateMatchScore(qClean, serverNameClean);
                    
                    // Nếu tên ngắn (From, Lost) -> Yêu cầu score tuyệt đối hoặc server name ngắn tương đương
                    if (qClean.length <= 4) {
                        // Tránh: search "From" ra "Money Heist"
                        // Server name phải rất ngắn hoặc chứa chính xác từ đó ở vị trí tách biệt
                        return score === 100 && Math.abs(serverNameClean.length - qClean.length) < 10;
                    }

                    // Với Dexter Original Sin: Cần score cao (chứa cả Original và Sin)
                    // Ngưỡng 66% nghĩa là 3 từ phải khớp ít nhất 2 từ quan trọng
                    return score >= 66; 
                });
            }
        } catch (e) {}
    }

    if (!match) {
        console.log("-> Không tìm thấy.");
        return { streams: [] };
    }

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
    } catch (err) {
        console.error(`Lỗi: ${err.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
