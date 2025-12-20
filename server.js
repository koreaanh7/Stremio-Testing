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
    id: "com.phim4k.vip.final.v22",
    version: "22.0.0",
    name: "Phim4K VIP (Strict & Fixes)",
    description: "Fix Sentimental Value, Dark vs Dark Crystal",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MỞ RỘNG (V22) ===
const VIETNAMESE_MAPPING = {
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "f1": ["f1"],
    "sisu: road to revenge": ["sisu 2"],
    
    // Fix Sentimental Value (Na Uy)
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"],

    "chainsaw man - the movie: reze arc": ["chainsaw man movie", "reze arc"],
    "10 dance": ["10dance", "10 dance"],

    // GHIBLI & ANIME
    "princess mononoke": ["công chúa mononoke", "công chúa sói", "mononoke hime"],
    "ocean waves": ["những con sóng đại dương", "sóng đại dương", "ai cũng có thể nghe thấy sóng biển"],
    "the red turtle": ["rùa đỏ"],
    "from up on poppy hill": ["ngọn đồi hoa hồng anh", "từ ngọn đồi hoa hồng anh"],
    "the secret world of arrietty": ["thế giới bí mật của arrietty", "cô bé tí hon arrietty"],
    "the cat returns": ["loài mèo trả ơn", "sự trả ơn của bầy mèo"],
    "only yesterday": ["chỉ còn ngày hôm qua"],
    "the wind rises": ["gió vẫn thổi", "gió nổi"],
    "the boy and the heron": ["thiếu niên và chim diệc"],
    "howl's moving castle": ["lâu đài bay của pháp sư howl", "lâu đài di động của howl"],
    "spirited away": ["vùng đất linh hồn"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "grave of the fireflies": ["mộ đom đóm"],
    "ponyo": ["cô bé người cá ponyo"],
    "weathering with you": ["đứa con của thời tiết"],
    "your name": ["tên cậu là gì"],
    "suzume": ["khóa chặt cửa nào suzume"],
    "5 centimeters per second": ["5 centimet trên giây"],
    "naruto": ["naruto"]
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
    const matchSE = name.match(/(?:s|season)\s?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)\s?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };
    const matchE = name.match(/(?:e|ep|episode|tap|#)\s?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };
    const matchSoloNumber = name.match(/[\s\-\.](\d{1,3})(?:[\s\.]|$)/);
    if (matchSoloNumber) return { s: 0, e: parseInt(matchSoloNumber[1]) };
    return null;
}

// === LOGIC MATCH NGHIÊM NGẶT HƠN (V22) ===
function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // 1. KIỂM TRA NĂM (Siết chặt cho Series)
    let yearMatch = false;
    if (!hasYear) yearMatch = true;
    else {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            // Chỉ nới lỏng 2 năm nếu tên có chữ 'naruto' hoặc là Anime
            // Còn lại Series thường chỉ cho phép lệch 1 năm để tránh 'Dark' (2017) ăn vào 2019
            const isAnimeLoose = originalName.toLowerCase().includes('naruto'); 
            const tolerance = isAnimeLoose ? 2 : 1;
            
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) 
                     || candidate.releaseInfo.includes((year-1).toString()) 
                     || candidate.releaseInfo.includes((year+1).toString());
        } else yearMatch = true;
    }
    if (!yearMatch) return false;

    // 2. LOGIC TIẾNG VIỆT (Ưu tiên cao nhất)
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                if (['sisu 2', 'f1', '10dance'].includes(mappedVietnamese)) return true;
                return containsWithAccent(serverName, mappedVietnamese);
            }
        }
    }

    // 3. LOGIC TIẾNG ANH (STRICT MODE CHO TÊN NGẮN)
    const qClean = normalizeForSearch(originalName);
    
    // Nếu tìm thấy query trong server name
    if (serverClean.includes(qClean)) {
        // Nếu tên phim gốc quá ngắn (ví dụ "Dark", "See", "From" - dưới 5 ký tự)
        if (qClean.length < 5) {
            // Bắt buộc Server Name phải BẮT ĐẦU bằng từ đó (tránh "The Dark Crystal")
            // Hoặc là khớp hoàn toàn
            if (serverClean === qClean) return true;
            if (serverClean.startsWith(qClean + " ")) return true;
            if (serverClean.startsWith(qClean + ":")) return true;
            
            // Nếu Server Name là "The Dark Crystal" (bắt đầu bằng "the") -> Loại
            return false; 
        }
        return true;
    }
    
    // Check tên ngắn trong queries (cho các case đặc biệt)
    for (const query of queries) {
        const qShort = normalizeForSearch(query);
        // Logic biên từ (Word Boundary) cho tên ngắn
        if (qShort.length < 4) {
             const regex = new RegExp(`(^|\\s|\\(|\\-)${qShort}(\\s|\\)|\\:|$)`, 'i');
             if (regex.test(serverClean)) return true;
        }
    }

    return qClean.includes(serverClean);
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

    const queries = [];
    const lowerName = originalName.toLowerCase();
    
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerName];
    if (mappingRaw) {
        if (Array.isArray(mappingRaw)) mappedVietnameseList = mappingRaw;
        else mappedVietnameseList = [mappingRaw];
    }

    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);

    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') {
            queries.push(splitName);
        }
    }
    
    if (/\d/.test(cleanName) && cleanName.includes(" ")) {
        queries.push(cleanName.replace(/\s/g, ""));
    }

    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) {
        queries.push(removeTheMovie);
    }

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(uniqueQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';

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

    // === AGGREGATION & FILTER ===
    const matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    if (matchedCandidates.length === 0) return { streams: [] };

    console.log(`-> TÌM THẤY ${matchedCandidates.length} KẾT QUẢ PHÙ HỢP:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name} | ID: ${m.id}`));

    let allStreams = [];
    const streamPromises = matchedCandidates.map(async (match) => {
        const fullId = match.id;
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    return sRes.data.streams.map(s => ({
                        name: "Phim4K VIP",
                        title: s.title || s.name, 
                        url: s.url,
                        behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                    }));
                }
            } else if (type === 'series') {
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                    const info = extractEpisodeInfo(vid.title || vid.name || "");
                    if (!info) return false;
                    if (info.s === 0) return info.e === episode; 
                    return info.s === season && info.e === episode;
                });

                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    try {
                        const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                        if (sRes.data && sRes.data.streams) {
                            sRes.data.streams.forEach(s => {
                                episodeStreams.push({
                                    name: `Phim4K S${season}E${episode}`,
                                    title: s.title || vid.title,
                                    url: s.url,
                                    behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                                });
                            });
                        }
                    } catch (e) {}
                }
                return episodeStreams;
            }
        } catch (e) { return []; }
        return [];
    });

    const results = await Promise.all(streamPromises);
    results.forEach(streams => {
        allStreams = allStreams.concat(streams);
    });

    // Sắp xếp ưu tiên 4K > 1080p > Thuyết minh
    allStreams.sort((a, b) => {
        const getScore = (title) => {
            let score = 0;
            if (title.includes("4K") || title.includes("2160p")) score += 3;
            if (title.includes("1080p")) score += 2;
            if (title.toLowerCase().includes("thuyết minh") || title.toLowerCase().includes("vietsub")) score += 1;
            return score;
        };
        return getScore(b.title) - getScore(a.title);
    });

    return { streams: allStreams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
