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
    name: "Phim4K VIP (Precision Fix)",
    description: "Fix Sentimental Value, Dark & Short Title Logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MỞ RỘNG (THÊM TIẾNG NA UY / PHÁP / NHẬT) ===
const VIETNAMESE_MAPPING = {
    // --- FIX CỤ THỂ CỦA BẠN ---
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"], // Fix phim Na Uy
    "dark": ["đêm lặng"], // Fix Dark Series

    // --- CÁC MAPPING KHÁC (GIỮ NGUYÊN) ---
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "f1": ["f1"],
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

// === HÀM MATCH VỚI LOGIC NGHIÊM NGẶT CHO TÊN NGẮN ===
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

    // 2. LOGIC TIẾNG VIỆT (Ưu tiên cao nhất)
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                // Với các từ khóa đặc biệt ngắn hoặc alias ngoại ngữ (Affeksjonsverdi), bỏ qua dấu
                if (['sisu 2', 'f1', '10dance', 'affeksjonsverdi'].includes(mappedVietnamese)) return true;
                return containsWithAccent(serverName, mappedVietnamese);
            }
        }
    }

    // 3. LOGIC TIẾNG ANH (CẢI TIẾN CHO TÊN NGẮN)
    const qClean = normalizeForSearch(originalName);
    
    // Nếu tên phim quá ngắn (<= 4 ký tự, VD: Dark, F1, From)
    if (qClean.length <= 4) {
        // Chỉ chấp nhận nếu tên trên server chứa từ đó DƯỚI DẠNG TỪ ĐƠN (Word Boundary)
        // Regex: Tìm chính xác từ đó, không nằm trong từ khác
        // VD: Tìm "Dark" -> Khớp "Dark", "Dark (2017)" -> KHÔNG khớp "Darkness", "Dark Crystal" (Do Dark Crystal là cụm từ ghép, ta sẽ lọc kỹ hơn ở bước sau)
        const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
        if (!strictRegex.test(serverClean)) return false;
        
        // Anti-False Positive cho "Dark":
        // Nếu tìm "Dark" mà server trả về "The Dark Crystal", độ dài chênh lệch quá lớn.
        // Heuristic: Nếu server name dài gấp 5 lần query name -> Nghi vấn (Trừ khi đã khớp Tiếng Việt)
        if (serverClean.length > qClean.length * 5) return false; 
        
        return true;
    }

    // Tên dài bình thường -> Check như cũ
    for (const query of queries) {
        const qShort = normalizeForSearch(query);
        if (qShort.length < 4) continue; // Đã check ở trên
        if (serverClean.includes(qShort)) return true;
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
    if (/\d/.test(cleanName) && cleanName.includes(" ")) queries.push(cleanName.replace(/\s/g, ""));
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

    // === BƯỚC LỌC CUỐI CÙNG: LOẠI BỎ "DARK CRYSTAL" KHỎI "DARK" ===
    // Nếu có nhiều kết quả, và tên phim gốc rất ngắn (Dark), hãy ưu tiên kết quả ngắn hơn.
    if (cleanName.length <= 5 && matchedCandidates.length > 1) {
        // Sắp xếp theo độ dài tên (ngắn nhất lên đầu)
        matchedCandidates.sort((a, b) => a.name.length - b.name.length);
        
        // Lấy độ dài ngắn nhất
        const minLen = matchedCandidates[0].name.length;
        
        // Chỉ giữ lại những phim có độ dài không quá chênh lệch so với phim ngắn nhất (Gấp 2 lần là tối đa)
        // Ví dụ: Dark (len 4) vs Dark Crystal (len 20). 20 > 4*3 -> Loại.
        matchedCandidates = matchedCandidates.filter(m => m.name.length <= minLen * 3);
        console.log("-> Đã lọc bớt các tên quá dài so với phim gốc (Logic Short Title).");
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
