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
    id: "com.phim4k.vip.final.v23",
    version: "2.0.0",
    name: "Phim4K VIP (Short-Name Architect)",
    description: "Fix F1, Elf, Short Queries Logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MỞ RỘNG ===
const VIETNAMESE_MAPPING = {
    // --- FIX CỤ THỂ CỦA BẠN ---
    "elf": ["chàng tiên giáng trần", "elf"], // Fix Elf
    "f1": ["f1"],
    "f1: the movie": ["f1"], // Map thẳng về F1
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"],
    "dark": ["đêm lặng"], 

    // --- CÁC MAPPING KHÁC ---
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
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

// === HÀM MATCH VỚI LOGIC LINH HOẠT HƠN (V23) ===
function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // 1. KIỂM TRA NĂM (Bắt buộc)
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

    // 2. ƯU TIÊN: LOGIC TIẾNG VIỆT
    // Nếu khớp alias tiếng Việt thì LẤY NGAY (Bỏ qua logic check độ dài)
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                if (['sisu 2', 'f1', '10dance', 'affeksjonsverdi', 'elf'].includes(mappedVietnamese)) return true;
                return containsWithAccent(serverName, mappedVietnamese);
            }
        }
    }

    // 3. LOGIC TIẾNG ANH (DUYỆT TỪNG QUERY)
    // Thay vì check originalName, ta check từng query trong danh sách queries
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        
        // --- CASE 1: Query Quá Ngắn (<= 4 ký tự) VD: "F1", "Elf", "Dark" ---
        if (qClean.length <= 4) {
            // Regex: Phải là từ đơn (Word Boundary)
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) {
                // Heuristic độ dài: 
                // Nếu tìm "Elf" (3 chars) mà ra tên quá dài -> Nghi ngờ.
                // Nhưng nới lỏng hơn v22: Cho phép dài gấp 7 lần (thay vì 5) để bắt được tên server có kèm tiếng Việt
                if (serverClean.length <= qClean.length * 7) {
                    return true;
                }
            }
        } 
        // --- CASE 2: Query Bình Thường ---
        else {
            if (serverClean.includes(qClean)) return true;
        }
    }

    return false;
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
    
    // Mapping
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerName];
    if (mappingRaw) {
        mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
    }

    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    // Fix F1, Dexter, 10 Dance
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') queries.push(splitName);
    }
    // Fix "10 Dance"
    if (/\d/.test(cleanName) && cleanName.includes(" ")) queries.push(cleanName.replace(/\s/g, ""));
    // Fix "The Movie"
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(uniqueQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';

    // SEARCH
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // FILTER
    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    // === BƯỚC LỌC CUỐI CÙNG: SHORT TITLE CLEANUP ===
    // Chỉ áp dụng lọc bớt nếu tìm kiếm từ khóa cực ngắn (<= 5) VÀ có nhiều kết quả
    // Để loại bỏ các kết quả "dài loằng ngoằng" không liên quan (như vụ Dark Crystal)
    // Nhưng phải cẩn thận không loại bỏ tên tiếng Việt dài của chính phim đó.
    if (cleanName.length <= 5 && matchedCandidates.length > 1) {
        matchedCandidates.sort((a, b) => a.name.length - b.name.length);
        const minLen = matchedCandidates[0].name.length;
        // Logic mới: Chỉ lọc nếu độ dài chênh lệch quá 4 lần so với kết quả ngắn nhất tìm thấy
        matchedCandidates = matchedCandidates.filter(m => m.name.length <= minLen * 4);
    }

    if (matchedCandidates.length === 0) return { streams: [] };

    console.log(`-> TÌM THẤY ${matchedCandidates.length} KẾT QUẢ:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name} | ID: ${m.id}`));

    // GET STREAMS
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
                }
                return episodeStreams;
            }
        } catch (e) { return []; }
        return [];
    });

    const results = await Promise.all(streamPromises);
    results.forEach(streams => allStreams = allStreams.concat(streams));

    allStreams.sort((a, b) => {
        const qA = a.title.includes("4K") ? 3 : (a.title.includes("1080") ? 2 : 1);
        const qB = b.title.includes("4K") ? 3 : (b.title.includes("1080") ? 2 : 1);
        return qB - qA;
    });

    return { streams: allStreams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
