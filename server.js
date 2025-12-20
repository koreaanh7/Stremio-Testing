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
    id: "com.phim4k.vip.final.v21",
    version: "21.0.0",
    name: "Phim4K VIP (Ultra Aggregation)",
    description: "Fix Dark 4K, 10Dance, Multi-Alias Ghibli",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN ĐA BIẾN THỂ (ARRAY MAPPING) ===
// Cho phép một phim có nhiều tên tiếng Việt khác nhau để tăng khả năng trúng
const VIETNAMESE_MAPPING = {
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "f1": ["f1"],
    "sisu: road to revenge": ["sisu 2"],
    
    // Fix Chainsaw Man
    "chainsaw man - the movie: reze arc": ["chainsaw man movie", "reze arc"],

    // Fix 10 Dance (Xử lý dính liền)
    "10 dance": ["10dance", "10 dance"],
    "sentimental value": ["sentimental value"],

    // GHIBLI & ANIME (Thêm nhiều alias)
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

// === HÀM KIỂM TRA LOGIC MATCH (Tách riêng để tái sử dụng) ===
function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // 1. KIỂM TRA NĂM
    let yearMatch = false;
    if (!hasYear) yearMatch = true;
    else {
        const yearMatches = serverName.match(/\d{4}/g);
        if (yearMatches) {
            const tolerance = (type === 'series' || originalName.toLowerCase().includes('naruto')) ? 2 : 1;
            yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= tolerance);
        } else if (candidate.releaseInfo) {
            yearMatch = candidate.releaseInfo.includes(year.toString()) 
                     || candidate.releaseInfo.includes((year-1).toString()) 
                     || candidate.releaseInfo.includes((year+1).toString());
        } else yearMatch = true;
    }
    if (!yearMatch) return false;

    // 2. LOGIC TIẾNG VIỆT (Quyền phủ quyết)
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        // Duyệt qua TẤT CẢ alias tiếng Việt
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            
            if (serverClean.includes(mappedClean)) {
                // Ngoại lệ cho Sisu 2 / F1 / 10dance (không cần dấu)
                if (['sisu 2', 'f1', '10dance'].includes(mappedVietnamese)) return true;
                
                // Check dấu nghiêm ngặt
                if (containsWithAccent(serverName, mappedVietnamese)) return true;
                
                // Nếu clean khớp mà dấu không khớp -> Khả năng cao là phim khác (Bây/Bẫy)
                // Tuy nhiên, vì đây là vòng lặp, ta chưa return false vội, lỡ alias khác khớp thì sao?
                // Nhưng với logic Veto cũ: Nếu nó giống "Bây" mà mình tìm "Bẫy" -> Loại.
                // Để an toàn: Nếu chuỗi clean khớp, ta return kết quả của việc check dấu ngay.
                return containsWithAccent(serverName, mappedVietnamese);
            }
        }
    }

    // 3. LOGIC TIẾNG ANH / TÊN NGẮN
    const qClean = normalizeForSearch(originalName);
    
    // Check tên ngắn Strict
    for (const query of queries) {
        const qShort = normalizeForSearch(query);
        if (qShort.length < 4) {
             const regex = new RegExp(`(^|\\s|\\(|\\-)${qShort}(\\s|\\)|\\:|$)`, 'i');
             if (regex.test(serverClean)) return true;
        }
    }

    return serverClean.includes(qClean) || qClean.includes(serverClean);
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

    // === TẠO QUERIES ===
    const queries = [];
    const lowerName = originalName.toLowerCase();
    
    // Lấy mapping (có thể là String hoặc Array)
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerName];
    if (mappingRaw) {
        if (Array.isArray(mappingRaw)) mappedVietnameseList = mappingRaw;
        else mappedVietnameseList = [mappingRaw];
    }

    // 1. Thêm tất cả tên tiếng Việt vào queries
    mappedVietnameseList.forEach(name => queries.push(name));
    
    // 2. Tên gốc
    queries.push(originalName);

    // 3. Tên sạch
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    // 4. Fix F1, Dexter, 10 Dance
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') {
            queries.push(splitName);
        }
    }
    
    // Fix "10 Dance" -> "10Dance"
    // Nếu tên có số và khoảng trắng, thử phiên bản dính liền
    if (/\d/.test(cleanName) && cleanName.includes(" ")) {
        queries.push(cleanName.replace(/\s/g, ""));
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
    // Lọc trùng ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === AGGREGATION (GOM KẾT QUẢ) ===
    // Thay vì find() lấy 1 cái, ta dùng filter() lấy TẤT CẢ cái khớp
    const matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    if (matchedCandidates.length === 0) return { streams: [] };

    console.log(`-> TÌM THẤY ${matchedCandidates.length} KẾT QUẢ PHÙ HỢP:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name} | ID: ${m.id}`));

    // === LẤY STREAM TỪ TẤT CẢ KẾT QUẢ KHỚP ===
    // Điều này giải quyết vấn đề "Dark" (1 ID cho HD, 1 ID cho 4K)
    let allStreams = [];
    
    // Tạo list promises để fetch stream song song
    const streamPromises = matchedCandidates.map(async (match) => {
        const fullId = match.id;
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
                const sRes = await axios.get(streamUrl, { headers: HEADERS });
                if (sRes.data && sRes.data.streams) {
                    return sRes.data.streams.map(s => ({
                        name: "Phim4K VIP",
                        title: (s.title || s.name) + `\n[${match.name}]`, // Ghi chú nguồn
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
                    if (info.s === 0) return info.e === episode; // Anime logic
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
                                    title: (s.title || vid.title) + `\n[${match.name}]`,
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

    // Sắp xếp stream: Ưu tiên 4K > 1080p
    allStreams.sort((a, b) => {
        const qA = a.title.includes("4K") ? 3 : (a.title.includes("1080") ? 2 : 1);
        const qB = b.title.includes("4K") ? 3 : (b.title.includes("1080") ? 2 : 1);
        return qB - qA;
    });

    return { streams: allStreams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
