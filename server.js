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
    id: "com.phim4k.vip.final.v14",
    version: "14.0.0",
    name: "Phim4K VIP (Precision Fix)",
    description: "Fix From, Dexter OS, Ghibli Names",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN ÁNH XẠ (Đã cập nhật chuẩn Ghibli) ===
const TITLE_MAPPING = {
    "from": "nguồn gốc",
    "lost": "mất tích",
    "dark": "đêm lặng",
    "howl's moving castle": "lâu đài bay của pháp sư howl",
    "the wind rises": "gió vẫn thổi", // Đã sửa theo feedback
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

// === 3. TẠO TỪ KHÓA TÌM KIẾM (An toàn hơn) ===
function getSearchQueries(originalName) {
    const clean = normalizeTitle(originalName);
    const queries = [];

    // Ưu tiên 1: Kiểm tra từ điển
    const lowerOriginal = originalName.toLowerCase();
    if (TITLE_MAPPING[lowerOriginal]) {
        queries.push(TITLE_MAPPING[lowerOriginal]);
    }

    queries.push(originalName); // Tên gốc
    if (clean !== lowerOriginal) queries.push(clean); // Tên sạch

    // Xử lý hậu tố "The Movie" (Giữ lại cái này cho F1)
    const removeTheMovie = clean.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== clean) queries.push(removeTheMovie);

    // FIX QUAN TRỌNG CHO DEXTER: 
    // Bỏ logic cắt dấu ":" (split colon). 
    // "Dexter: Original Sin" sẽ KHÔNG bị biến thành "Dexter" nữa.
    // Trừ trường hợp đặc biệt: "F1:..."
    if (clean.startsWith("f1 ")) {
        queries.push("f1");
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
    console.log(`\n=== Xử lý: "${originalName}" | Type: ${type} ===`);
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
                    // 1. CHECK TYPE
                    if (m.type && m.type !== type) return false;

                    const serverNameClean = normalizeTitle(m.name);
                    const qClean = normalizeTitle(query);

                    // 2. CHECK TÊN (FIXED FROM/LOST)
                    let nameMatch = false;
                    
                    // Nâng ngưỡng strict mode lên 5 ký tự (để bao gồm cả từ 4 ký tự như "From")
                    if (qClean.length <= 5) {
                        // Regex: Bắt buộc Tên Server phải BẮT ĐẦU bằng từ khóa
                        // "From" sẽ khớp "From (2022)"
                        // "From" sẽ KHÔNG khớp "Money Heist: From..." (vì bắt đầu bằng M)
                        const strictRegex = new RegExp(`^${qClean}$|^${qClean}\\s|^${qClean}\\W`, 'i');
                        nameMatch = strictRegex.test(serverNameClean);
                    } else {
                        // Logic cũ cho tên dài
                        nameMatch = serverNameClean.includes(qClean) || qClean.includes(serverNameClean);
                    }

                    // 3. CHECK NĂM
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
                        console.log(`   -> KHỚP (${query}): ${m.name}`);
                        return true;
                    }
                    return false;
                });
            }
        } catch (e) {}
    }

    if (!match) {
        console.log("-> Không tìm thấy phim phù hợp.");
        return { streams: [] };
    }

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
