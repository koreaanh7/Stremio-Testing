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
    id: "com.phim4k.vip.final.v20",
    version: "20.0.0",
    name: "Phim4K VIP (Anime+)",
    description: "Fix Ghibli, Naruto, Sisu 2 & Chainsaw Man",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MỞ RỘNG (GHIBLI & ANIME & NEW MOVIES) ===
const VIETNAMESE_MAPPING = {
    // --- SPECIAL CASES ---
    "from": "bẫy",  
    "bet": "học viện đỏ đen", 
    "f1": "f1", // Giữ nguyên
    "sisu: road to revenge": "sisu 2", // Map thẳng sang Sisu 2
    "chainsaw man - the movie: reze arc": "chainsaw man movie", // Rút gọn để tìm dễ hơn
    
    // --- GHIBLI / ANIME MOVIES ---
    "the red turtle": "rùa đỏ",
    "from up on poppy hill": "ngọn đồi hoa hồng anh",
    "the secret world of arrietty": "thế giới bí mật của arrietty",
    "the cat returns": "loài mèo trả ơn",
    "princess mononoke": "công chúa mononoke",
    "ocean waves": "những con sóng đại dương",
    "only yesterday": "chỉ còn ngày hôm qua",
    "the wind rises": "gió vẫn thổi",
    "the boy and the heron": "thiếu niên và chim diệc",
    "howl's moving castle": "lâu đài bay của pháp sư howl",
    "spirited away": "vùng đất linh hồn",
    "my neighbor totoro": "hàng xóm của tôi là totoro",
    "grave of the fireflies": "mộ đom đóm",
    "ponyo": "cô bé người cá ponyo",
    "weathering with you": "đứa con của thời tiết",
    "your name": "tên cậu là gì",
    "suzume": "khóa chặt cửa nào suzume",
    "5 centimeters per second": "5 centimet trên giây",
    "whisper of the heart": "lời thì thầm của trái tim",
    "pom poko": "cuộc chiến gấu mèo",
    "porco rosso": "chú heo màu đỏ",
    "tales from earthsea": "huyền thoại đất liền và đại dương",
    "when marnie was there": "hồi ức về marnie",
    "the tale of the princess kaguya": "chuyện nàng công chúa kaguya",

    // --- SERIES ANIME ---
    "naruto": "naruto", // Để đảm bảo query đúng
    "10 dance": "10 dance",
    "sentimental value": "sentimental value"
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

// === CẬP NHẬT LOGIC TÁCH TẬP PHIM (CHO NARUTO/ANIME) ===
function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    
    // 1. Chuẩn SxxExx (Series Mỹ/Hàn)
    const matchSE = name.match(/(?:s|season)\s?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)\s?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };

    // 2. Kiểu 1x01
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };

    // 3. Kiểu Anime/TV Show: "Tập 01", "Ep 100", " - 05 " (Bỏ qua Season, gán s=0 hoặc s=1)
    // Regex này bắt: Chữ "tap/ep" + số, HOẶC dấu gạch ngang/cách + số ở cuối hoặc giữa
    const matchE = name.match(/(?:e|ep|episode|tap|#)\s?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };

    // 4. Trường hợp đặc biệt: Chỉ có số đứng riêng lẻ (nguy hiểm nhưng cần cho Anime cũ)
    // Ví dụ: "Naruto - 005.mp4"
    const matchSoloNumber = name.match(/[\s\-\.](\d{1,3})(?:[\s\.]|$)/);
    if (matchSoloNumber) return { s: 0, e: parseInt(matchSoloNumber[1]) };

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

    // === TẠO QUERY ===
    const queries = [];
    const lowerName = originalName.toLowerCase();
    const mappedVietnamese = VIETNAMESE_MAPPING[lowerName];

    // 1. Mapping (Tiếng Việt hoặc Alias đặc biệt như Sisu 2)
    if (mappedVietnamese) queries.push(mappedVietnamese); 
    
    // 2. Tên gốc
    queries.push(originalName);

    // 3. Tên sạch
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    // 4. Fix F1 / Tên ngắn
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') {
            queries.push(splitName);
        }
    }

    // 5. Fix "The Movie"
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
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === VERIFY LOGIC (VETO PROTOCOL) ===
    match = allCandidates.find(m => {
        if (m.type && m.type !== type) return false;
        const serverName = m.name; 
        const serverClean = normalizeForSearch(serverName);
        
        // 1. KIỂM TRA NĂM (Nới lỏng cho Anime)
        let yearMatch = false;
        if (!hasYear) yearMatch = true;
        else {
            const yearMatches = serverName.match(/\d{4}/g);
            if (yearMatches) {
                // Với Anime/Hoạt hình, nới lỏng sai số lên 2 năm
                // Ví dụ Naruto 2002 có thể bị ghi là 2000 hoặc 2004 trên server
                const tolerance = (type === 'series' || originalName.includes('Naruto')) ? 2 : 1;
                yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
            } else if (m.releaseInfo) {
                yearMatch = m.releaseInfo.includes(year.toString()) 
                         || m.releaseInfo.includes((year-1).toString()) 
                         || m.releaseInfo.includes((year+1).toString());
            } else yearMatch = true; 
        }
        if (!yearMatch) return false;

        // 2. LOGIC TIẾNG VIỆT (QUYỀN PHỦ QUYẾT)
        if (mappedVietnamese) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                // Nếu là Sisu 2 (Alias không dấu), bỏ qua check dấu
                if (mappedVietnamese === 'sisu 2') return true; 

                // Còn lại check dấu nghiêm ngặt (From -> bẫy)
                if (!containsWithAccent(serverName, mappedVietnamese)) return false; 
                return true;
            }
        }

        // 3. LOGIC TIẾNG ANH / TÊN NGẮN
        const qClean = normalizeForSearch(originalName);
        for (const query of uniqueQueries) {
            const qShort = normalizeForSearch(query);
            if (qShort.length < 4) {
                 const regex = new RegExp(`(^|\\s|\\(|\\-)${qShort}(\\s|\\)|\\:|$)`, 'i');
                 if (regex.test(serverClean)) return true;
            }
        }

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
                
                // LOGIC GHÉP TẬP ANIME (QUAN TRỌNG)
                // Nếu info.s = 0 (tức là chỉ tìm thấy Tập X), ta cho phép khớp với bất kỳ Season nào,
                // miễn là Episode khớp.
                // Vì Naruto trên server có thể là "Naruto" (ko chia season) hoặc "Naruto Season 1".
                if (info.s === 0) return info.e === episode;
                
                // Nếu tìm thấy Season rõ ràng (S01E05) thì bắt buộc khớp Season
                return info.s === season && info.e === episode;
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
