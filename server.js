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
    id: "com.phim4k.vip.final.v19",
    version: "19.0.0",
    name: "Phim4K VIP (Strict Veto)",
    description: "Fix From/Bet/F1 with Veto Logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN ===
const VIETNAMESE_MAPPING = {
    "from": "bẫy",  
    "bet": "học viện đỏ đen", 
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

function normalizeForSearch(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") 
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

function containsWithAccent(fullString, subString) {
    return fullString.toLowerCase().includes(subString.toLowerCase());
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

    // === TẠO QUERY (Có fix F1) ===
    const queries = [];
    const lowerName = originalName.toLowerCase();
    const mappedVietnamese = VIETNAMESE_MAPPING[lowerName];

    if (mappedVietnamese) queries.push(mappedVietnamese); 
    queries.push(originalName);

    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        // Fix F1: Chấp nhận tên ngắn nếu là f1
        if (splitClean.length > 3 || splitClean === 'f1') {
            queries.push(splitName);
        }
    }

    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) {
        queries.push(removeTheMovie);
    }

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(uniqueQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    // === SEARCH SONG SONG ===
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) {
            allCandidates = allCandidates.concat(res.data.metas);
        }
    });

    // Lọc trùng
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === VERIFY LOGIC (VETO PROTOCOL) ===
    match = allCandidates.find(m => {
        if (m.type && m.type !== type) return false;
        const serverName = m.name; 
        const serverClean = normalizeForSearch(serverName);
        
        // 1. KIỂM TRA NĂM (BẮT BUỘC)
        let yearMatch = false;
        if (!hasYear) yearMatch = true;
        else {
            const yearMatches = serverName.match(/\d{4}/g);
            if (yearMatches) yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
            else if (m.releaseInfo) yearMatch = m.releaseInfo.includes(year.toString()) || m.releaseInfo.includes((year-1).toString()) || m.releaseInfo.includes((year+1).toString());
            else yearMatch = true; 
        }
        if (!yearMatch) return false;

        // 2. LOGIC TÊN TIẾNG VIỆT (QUYỀN PHỦ QUYẾT)
        // Nếu phim có Mapping Tiếng Việt
        if (mappedVietnamese) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            
            // Nếu tên Server CÓ CHỨA từ khóa tiếng Việt (dù có dấu hay không)
            // Ví dụ: server "Bây giờ" (clean: bay gio), mapping "bẫy" (clean: bay)
            // -> Điều kiện này True
            if (serverClean.includes(mappedClean)) {
                
                // THÌ BẮT BUỘC PHẢI KHỚP DẤU
                // "Bây giờ" KHÔNG chứa "bẫy" -> False -> RETURN FALSE NGAY (Không check tiếp logic dưới)
                if (!containsWithAccent(serverName, mappedVietnamese)) {
                    return false; // CHẶN ĐỨNG SAI SÓT
                }
                
                // Nếu khớp dấu -> LẤY LUÔN
                return true;
            }
            // Nếu server hoàn toàn không chứa từ khóa Việt (ví dụ tên server là "From (2022)"),
            // thì bỏ qua block này, chạy tiếp xuống logic tiếng Anh.
        }

        // 3. LOGIC TIẾNG ANH / TÊN NGẮN
        const qClean = normalizeForSearch(originalName);
        
        // Logic cho từ khóa ngắn (F1, Bet, From)
        for (const query of uniqueQueries) {
            const qShort = normalizeForSearch(query);
            if (qShort.length < 4) {
                 // Phải bắt đầu bằng từ khóa đó
                 const regex = new RegExp(`(^|\\s|\\(|\\-)${qShort}(\\s|\\)|\\:|$)`, 'i');
                 if (regex.test(serverClean)) return true;
            }
        }

        // Logic match thường cho tên dài
        return serverClean.includes(qClean) || qClean.includes(serverClean);
    });

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
