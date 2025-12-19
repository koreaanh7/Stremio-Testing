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
    id: "com.phim4k.vip.final.v10",
    version: "10.0.0",
    name: "Phim4K VIP (Smart Search)",
    description: "Fix lỗi tìm kiếm tên phim & Series",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === HÀM CHUẨN HÓA TÊN THÔNG MINH ===
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Bỏ dấu tiếng Việt/Pháp...
        .replace(/^(the|a|an)\s+/, "")     // Bỏ mạo từ đầu câu (The Great Flood -> Great Flood)
        .replace(/['":\-.]/g, "")          // Bỏ dấu câu đặc biệt
        .replace(/\s+/g, " ")              // Gộp nhiều khoảng trắng thành 1
        .trim();
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

    // Tách ID cho Series
    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) return { streams: [] };

    // CHUẨN HÓA TÊN GỐC
    const originalName = meta.name;
    const cleanName = normalizeTitle(originalName); // Tên sạch (bỏ The, bỏ dấu)
    const year = parseInt(meta.year);

    console.log(`\n=== Tìm: "${originalName}" -> Clean: "${cleanName}" (${year}) ===`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    // Mẹo: Search tên gốc, nhưng so sánh bằng tên sạch
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(originalName)}.json`;

    try {
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            console.log("-> Server không trả về kết quả nào.");
            return { streams: [] };
        }

        // === LOGIC KHỚP PHIM (NÂNG CẤP) ===
        const match = res.data.metas.find(m => {
            const serverNameClean = normalizeTitle(m.name);
            
            // 1. So sánh tên (Chứa nhau)
            // Stremio: "great flood" vs Server: "great flood" -> OK
            // Stremio: "10dance" vs Server: "10 dance" (đã normalize hết dấu cách) -> OK
            // Stremio: "f1" vs Server: "f1 the movie" -> OK
            const nameMatch = serverNameClean.includes(cleanName) || cleanName.includes(serverNameClean);

            // 2. So sánh năm (Nới rộng lên +/- 2 năm)
            // F1 (2025) có thể server ghi 2024 hoặc 2026
            let yearMatch = false;
            const yearMatches = m.name.match(/\d{4}/g);
            if (yearMatches) {
                yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 2);
            } else if (m.releaseInfo) {
                yearMatch = m.releaseInfo.includes(year.toString()) 
                         || m.releaseInfo.includes((year-1).toString()) 
                         || m.releaseInfo.includes((year+1).toString());
            } else {
                // Nếu server không ghi năm, nhưng tên khớp cực chuẩn -> Tạm chấp nhận
                if (serverNameClean === cleanName) yearMatch = true; 
            }

            return nameMatch && yearMatch;
        });

        if (!match) {
            console.log("-> Có kết quả nhưng không khớp tên/năm.");
            return { streams: [] };
        }

        const fullId = match.id;
        console.log(`-> Đã khớp: ${match.name} | ID: ${fullId}`);

        // === XỬ LÝ STREAM (Giữ nguyên logic v9) ===
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
        }

        if (type === 'series') {
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

    } catch (error) {
        console.error(`Lỗi: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
