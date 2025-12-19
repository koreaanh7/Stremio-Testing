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
    id: "com.phim4k.vip.final.v12",
    version: "12.0.0",
    name: "Phim4K VIP (Master Fix)",
    description: "Fix F1, The Movie suffix, Short names",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. CHUẨN HÓA CƠ BẢN ===
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// === 2. TẠO TỪ KHÓA THÔNG MINH (UPDATED) ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [originalName]; 

    // Query 1: Tên sạch
    if (clean !== originalName.toLowerCase()) queries.push(clean);

    // Query 2: Bỏ hậu tố "The Movie" (Quan trọng cho F1)
    // Ví dụ: "F1: The Movie" -> "F1"
    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    // Query 3: Cắt bỏ phần sau dấu hai chấm (Nếu chưa có)
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        queries.push(splitName); // F1
        queries.push(normalizeTitle(splitName)); // f1
    }

    // Query 4: Dính liền (cho 10Dance)
    const noSpace = clean.replace(/\s/g, "");
    if (noSpace !== clean) queries.push(noSpace);

    // Lọc trùng và loại bỏ từ khóa quá ngắn (trừ khi tên gốc ngắn)
    return [...new Set(queries)].filter(q => q.length >= 2 || originalName.length <= 2);
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
    
    // Xử lý năm (NaN proof)
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    const searchQueries = getSearchQueries(originalName);
    console.log(`\n=== Xử lý: "${originalName}" (${hasYear ? year : 'No Year'}) ===`);
    console.log(`-> Thử các từ khóa: ${JSON.stringify(searchQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    // === VÒNG LẶP TÌM KIẾM (FALLBACK) ===
    for (const query of searchQueries) {
        if (match) break; 

        const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`;
        try {
            const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 6000 });
            
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                
                // Logic so sánh (Tối ưu cho tên ngắn như F1)
                match = res.data.metas.find(m => {
                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // 1. So sánh Tên
                    let nameMatch = false;
                    // Nếu tên quá ngắn (<=3 ký tự) -> Bắt buộc phải khớp chính xác hoặc bắt đầu bằng
                    if (qClean.length <= 3) {
                         nameMatch = serverNameClean === qClean || serverNameClean.startsWith(qClean + " ");
                    } else {
                        // Tên dài thì dùng includes như cũ
                        nameMatch = serverNameClean.includes(qClean) || qClean.includes(serverNameClean) || serverNameClean.replace(/\s/g, "") === qClean.replace(/\s/g, "");
                    }

                    // 2. So sánh Năm
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
                    
                    if (nameMatch && yearMatch) {
                        console.log(`   -> Khớp tại từ khóa "${query}": ${m.name}`);
                        return true;
                    }
                    return false;
                });
            }
        } catch (e) {
            console.log(`   -> Lỗi khi tìm "${query}": ${e.message}`);
        }
    }

    if (!match) {
        console.log("-> Thất bại: Không tìm thấy phim nào.");
        return { streams: [] };
    }

    const fullId = match.id;

    // === PHẦN LẤY LINK STREAM ===
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
        console.error(`Lỗi lấy stream: ${err.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
