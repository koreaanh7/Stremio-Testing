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
    id: "com.phim4k.vip.final.v11",
    version: "11.0.0",
    name: "Phim4K VIP (Ultra Search)",
    description: "Fix lỗi tìm kiếm nâng cao (Fallback & NaN Year)",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. HÀM CHUẨN HÓA MẠNH MẼ ===
function normalizeTitle(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/^(the|a|an)\s+/, "")
        .replace(/['":\-.]/g, " ") // Thay dấu câu bằng khoảng trắng
        .replace(/\s+/g, " ")
        .trim();
}

// === 2. TẠO DANH SÁCH TỪ KHÓA TÌM KIẾM ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [originalName]; // Ưu tiên 1: Tên gốc

    // Ưu tiên 2: Tên đã làm sạch (bỏ The, dấu câu)
    if (clean !== originalName.toLowerCase()) queries.push(clean);

    // Ưu tiên 3: Nếu có dấu hai chấm (F1: The Movie), thử tìm phần trước dấu hai chấm (F1)
    if (originalName.includes(":")) {
        queries.push(originalName.split(":")[0].trim());
    }

    // Ưu tiên 4: Thử bỏ hết khoảng trắng (Dành cho 10 Dance -> 10dance)
    const noSpace = clean.replace(/\s/g, "");
    if (noSpace !== clean) queries.push(noSpace);

    return [...new Set(queries)]; // Loại bỏ trùng lặp
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
    
    // FIX QUAN TRỌNG: Kiểm tra xem có năm hay không (tránh NaN)
    let year = parseInt(meta.year);
    const hasYear = !isNaN(year); 

    // Tạo danh sách các từ khóa để thử tìm
    const searchQueries = getSearchQueries(originalName);
    console.log(`\n=== Xử lý: "${originalName}" (${hasYear ? year : 'No Year'}) ===`);
    console.log(`-> Các từ khóa sẽ thử: ${JSON.stringify(searchQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    // === VÒNG LẶP TÌM KIẾM (FALLBACK) ===
    for (const query of searchQueries) {
        if (match) break; // Nếu đã tìm thấy thì dừng

        const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`;
        try {
            // console.log(`-> Đang thử tìm: "${query}"...`);
            const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 5000 }); // Giảm timeout cho nhanh
            
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                
                // Lọc kết quả trả về
                match = res.data.metas.find(m => {
                    const serverNameClean = normalizeTitle(m.name);
                    
                    // 1. So sánh tên (Linh hoạt hơn)
                    const nameMatch = serverNameClean.includes(cleanName) 
                                   || cleanName.includes(serverNameClean)
                                   || serverNameClean.replace(/\s/g, "") === cleanName.replace(/\s/g, ""); // Check 10dance

                    // 2. So sánh năm (FIXED NaN)
                    let yearMatch = false;
                    if (!hasYear) {
                        // Nếu Stremio không có năm, ta BỎ QUA check năm -> Auto True
                        yearMatch = true;
                    } else {
                        // Nếu có năm, so sánh như cũ
                        const yearMatches = m.name.match(/\d{4}/g);
                        if (yearMatches) {
                            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 2);
                        } else if (m.releaseInfo) {
                            yearMatch = m.releaseInfo.includes(year.toString()) 
                                     || m.releaseInfo.includes((year-1).toString()) 
                                     || m.releaseInfo.includes((year+1).toString());
                        } else {
                            // Server không ghi năm -> Chấp nhận nếu tên khớp
                            yearMatch = true;
                        }
                    }

                    return nameMatch && yearMatch;
                });
            }
        } catch (e) {
            // Lỗi mạng hoặc timeout thì thử từ khóa tiếp theo
        }
    }

    if (!match) {
        console.log("-> Thất bại: Không tìm thấy phim nào khớp.");
        return { streams: [] };
    }

    const fullId = match.id;
    console.log(`-> ĐÃ KHỚP: ${match.name} | ID: ${fullId}`);

    // === PHẦN LẤY LINK STREAM (Giữ nguyên) ===
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
