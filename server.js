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
    id: "com.phim4k.vip.final.v24",
    version: "24.0.0",
    name: "Phim4K VIP (Precision Update)",
    description: "Fix BB Season Mix, El Camino, Naruto Logic",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MỞ RỘNG ===
const VIETNAMESE_MAPPING = {
    // --- FIX CỤ THỂ ---
    "elf": ["chàng tiên giáng trần", "elf"],
    "f1": ["f1"],
    "f1: the movie": ["f1"],
    "el camino": ["el camino a breaking bad movie", "tập làm người xấu movie"], // Fix El Camino
    "el camino: a breaking bad movie": ["el camino a breaking bad movie"],
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"],
    "dark": ["đêm lặng"], 
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
    
    // GHIBLI & ANIME
    "princess mononoke": ["công chúa mononoke", "mononoke hime"],
    "spirited away": ["vùng đất linh hồn"],
    "howl's moving castle": ["lâu đài bay của pháp sư howl", "lâu đài di động của howl"],
    "grave of the fireflies": ["mộ đom đóm"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "naruto": ["naruto"],
    "naruto shippuden": ["naruto shippuden"]
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

// === 2. LOGIC TÁCH TÊN FILE (NÂNG CẤP) ===
function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    // Case 1: S01E01, Season 1 Episode 1
    const matchSE = name.match(/(?:s|season|mua)\s?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)\s?(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };
    
    // Case 2: 1x01
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };
    
    // Case 3: Absolute (Ep 100, Tap 100, #100)
    const matchE = name.match(/(?:e|ep|episode|tap|#)\s?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) }; // s:0 means "Unknown Season" or "Absolute"
    
    // Case 4: Solo Number (ít tin cậy nhất, nhưng cần cho anime cũ)
    // Chỉ bắt nếu nó nằm sau dấu - hoặc khoảng trắng, tránh nhầm năm
    const matchSoloNumber = name.match(/[\s\-\.](\d{1,3})(?:[\s\.]|$)/);
    if (matchSoloNumber) {
        // Loại trừ nếu số đó giống năm (19xx, 20xx)
        const num = parseInt(matchSoloNumber[1]);
        if (num > 1900 && num < 2100) return null; 
        return { s: 0, e: num };
    }
    return null;
}

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // 1. Check NĂM
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

    // 2. Check Tiếng Việt
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                // Mapping cứng -> Chấp nhận luôn
                if (['f1', '10dance', 'affeksjonsverdi', 'elf', 'sisu 2'].includes(mappedVietnamese)) return true;
                if (mappedVietnamese.includes("el camino")) return true; 
                return containsWithAccent(serverName, mappedVietnamese);
            }
        }
    }

    // 3. Check Queries
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        
        // Case tên quá ngắn
        if (qClean.length <= 4) {
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) {
                if (serverClean.length <= qClean.length * 7) return true;
            }
        } 
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

    // --- SETUP QUERIES ---
    const queries = [];
    const lowerName = originalName.toLowerCase();
    
    let mappedVietnameseList = [];
    const mappingRaw = VIETNAMESE_MAPPING[lowerName];
    if (mappingRaw) {
        mappedVietnameseList = Array.isArray(mappingRaw) ? mappingRaw : [mappingRaw];
    }
    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);
    
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        const splitClean = normalizeForSearch(splitName);
        if (splitClean.length > 3 || splitClean === 'f1') queries.push(splitName);
    }
    
    const removeTheMovie = cleanName.replace(/\s+the movie$/, "").trim();
    if (removeTheMovie !== cleanName && removeTheMovie.length > 0) queries.push(removeTheMovie);

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(uniqueQueries)}`);

    // --- SEARCH ---
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) allCandidates = allCandidates.concat(res.data.metas);
    });
    // Remove duplicates by ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // --- FILTER ---
    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    // --- SMART CLEANUP (Fix El Camino vs Xico) ---
    // Nếu tìm thấy kết quả khớp chính xác hoặc gần chính xác, loại bỏ các kết quả "ăn theo" có tên quá dài khác biệt
    if (matchedCandidates.length > 1) {
        // Tìm độ dài ngắn nhất trong các kết quả
        matchedCandidates.sort((a, b) => a.name.length - b.name.length);
        const bestCandidate = matchedCandidates[0];
        const minLen = bestCandidate.name.length;
        
        // Nếu tên ngắn nhất khớp tốt với query, siết chặt bộ lọc độ dài
        // Cho phép dài gấp 3 lần thôi (để chặn 'El camino de Xico...' nếu 'El Camino' đã match)
        matchedCandidates = matchedCandidates.filter(m => m.name.length <= minLen * 3);
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    console.log(`-> TÌM THẤY ${matchedCandidates.length} KẾT QUẢ HỢP LỆ:`);
    matchedCandidates.forEach(m => console.log(`   + ${m.name} | ID: ${m.id}`));

    // --- GET STREAMS & STRICT VALIDATION ---
    let allStreams = [];
    const streamPromises = matchedCandidates.map(async (match) => {
        try {
            if (type === 'movie') {
                const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(match.id)}.json`;
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
                const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(match.id)}.json`;
                const metaRes = await axios.get(metaUrl, { headers: HEADERS });
                if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) return [];

                // Lọc video từ meta (của server upstream)
                const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                    const info = extractEpisodeInfo(vid.title || vid.name || "");
                    if (!info) return false;
                    // FIX NARUTO: Nếu tìm Season > 1 mà file là s:0 (absolute ep 1,2,3...), bỏ qua
                    // Vì 'Episode 1' thường là tập 1 của toàn bộ series, không phải tập 1 của Season 2
                    if (season > 1 && info.s === 0) return false;
                    
                    if (info.s === 0) return info.e === episode; 
                    return info.s === season && info.e === episode;
                });

                let episodeStreams = [];
                for (const vid of matchedVideos) {
                    const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            // === FINAL BARRIER: VALIDATE STREAM TITLE ===
                            // Đây là chốt chặn cuối cùng (Fix Breaking Bad)
                            const streamTitle = s.title || vid.title || "";
                            const sInfo = extractEpisodeInfo(streamTitle);
                            
                            let isValid = true;
                            if (sInfo) {
                                // Nếu file ghi rõ ràng S01 mà mình đang tìm S04 -> SAI -> BỎ
                                if (sInfo.s !== 0 && sInfo.s !== season) isValid = false;
                                
                                // Nếu file ghi rõ ràng E05 mà mình đang tìm E01 -> SAI -> BỎ
                                if (sInfo.e !== episode) isValid = false;
                                
                                // Fix Anime Again: Tìm S2 mà file là S0 (Ep 1) -> BỎ
                                if (season > 1 && sInfo.s === 0) isValid = false;
                            }

                            if (isValid) {
                                episodeStreams.push({
                                    name: `Phim4K S${season}E${episode}`,
                                    title: streamTitle + `\n[${match.name}]`,
                                    url: s.url,
                                    behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                                });
                            }
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
