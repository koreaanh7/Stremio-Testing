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
    name: "Phim4K VIP (Regex Master)",
    description: "Fix Series Filtering (Breaking Bad) & Strict Title Match",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN MAPPING (Cập nhật El Camino) ===
const VIETNAMESE_MAPPING = {
    "elf": ["chàng tiên giáng trần", "elf"],
    "f1": ["f1"],
    "f1: the movie": ["f1"],
    "el camino": ["el camino a breaking bad movie"], // Fix El Camino
    "breaking bad": ["tập làm người xấu", "breaking bad"], // Fix Breaking Bad tên Việt
    "sentimental value": ["giá trị tình cảm", "affeksjonsverdi"],
    "dark": ["đêm lặng"],
    "from": ["bẫy"],
    "bet": ["học viện đỏ đen"],
    "sisu: road to revenge": ["sisu 2"],
    "chainsaw man - the movie: reze arc": ["chainsaw man movie", "reze arc"],
    "10 dance": ["10dance", "10 dance"],
    "princess mononoke": ["công chúa mononoke", "mononoke hime"],
    "spirited away": ["vùng đất linh hồn"],
    "howl's moving castle": ["lâu đài bay của pháp sư howl"],
    "grave of the fireflies": ["mộ đom đóm"],
    "my neighbor totoro": ["hàng xóm của tôi là totoro"],
    "the boy and the heron": ["thiếu niên và chim diệc"],
    "weathering with you": ["đứa con của thời tiết"],
    "your name": ["tên cậu là gì"],
    "suzume": ["khóa chặt cửa nào suzume"],
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

// === 2. BỘ XỬ LÝ REGEX MỚI (FIX BREAKING BAD) ===
function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    
    // Regex 1: Chuẩn mực (S01E01, Season 1 Episode 1, Season.1.Episode.1)
    // Thêm [\s.]* để bắt dấu chấm sau chữ Season (Fix Breaking Bad)
    const matchSE = name.match(/(?:s|season|tap)[\s.]*(\d{1,2})[\s.xe-]*\s?(?:e|ep|episode|tap|x)[\s.]*(\d{1,3})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };

    // Regex 2: Dạng rút gọn (1x01)
    const matchX = name.match(/(\d{1,2})x(\d{1,3})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };

    // Regex 3: Chỉ có Episode (E01, Ep 01, #01)
    const matchE = name.match(/(?:e|ep|episode|tap|#)[\s.]?(\d{1,4})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };

    // Regex 4: Số đứng một mình (Nguy hiểm, chỉ dùng fallback)
    // Tránh bắt nhầm năm (19xx, 20xx) hoặc độ phân giải (1080)
    const matchSoloNumber = name.match(/[\s\-\.](\d{1,3})(?:[\s\.]|$)/);
    if (matchSoloNumber) {
        const num = parseInt(matchSoloNumber[1]);
        if (num < 1900 && num !== 1080 && num !== 720 && num !== 480) {
            return { s: 0, e: num };
        }
    }
    return null;
}

function isMatch(candidate, type, originalName, year, hasYear, mappedVietnameseList, queries) {
    if (candidate.type && candidate.type !== type) return false;
    const serverName = candidate.name;
    const serverClean = normalizeForSearch(serverName);

    // Check Năm
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

    // Check Tiếng Việt (Ưu tiên tuyệt đối)
    if (mappedVietnameseList && mappedVietnameseList.length > 0) {
        for (const mappedVietnamese of mappedVietnameseList) {
            const mappedClean = normalizeForSearch(mappedVietnamese);
            if (serverClean.includes(mappedClean)) {
                // Fix El Camino vs Xico: Nếu mapping dài (có thêm từ khóa phụ), bắt buộc server phải khớp đủ
                if (mappedVietnamese.length > originalName.length + 5 && !serverClean.includes(mappedClean)) return false; 
                return true;
            }
        }
    }

    // Check Tiếng Anh
    for (const query of queries) {
        const qClean = normalizeForSearch(query);
        if (qClean.length <= 4) {
             // Logic tên ngắn (F1, Elf)
            const strictRegex = new RegExp(`(^|\\s|\\W)${qClean}($|\\s|\\W)`, 'i');
            if (strictRegex.test(serverClean)) {
                if (serverClean.length <= qClean.length * 7) return true;
            }
        } else {
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
    
    // Mapping Logic
    let mappedVietnameseList = [];
    // Thử map cả tên gốc và tên đã clean để bắt "el camino"
    const keysToCheck = [lowerName, normalizeForSearch(lowerName)];
    
    for (const k of keysToCheck) {
        if (VIETNAMESE_MAPPING[k]) {
            const val = VIETNAMESE_MAPPING[k];
            mappedVietnameseList = Array.isArray(val) ? val : [val];
            break; 
        }
    }

    mappedVietnameseList.forEach(name => queries.push(name));
    queries.push(originalName);
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== lowerName) queries.push(cleanName);

    // Heuristics bổ sung
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
    // Deduplicate
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    let matchedCandidates = allCandidates.filter(m => 
        isMatch(m, type, originalName, year, hasYear, mappedVietnameseList, uniqueQueries)
    );

    // === FIX 2: STRICT CLEANUP (Trị El Camino de Xico) ===
    // Nếu tìm thấy một kết quả có tên "chứa trọn" query nhưng quá dài so với query (do khác phim), lọc bỏ.
    if (matchedCandidates.length > 1) {
        // Tìm xem có ứng viên nào khớp tên "xịn" (khớp mapping hoặc khớp tên gốc)
        const strictMatches = matchedCandidates.filter(m => {
            const mClean = normalizeForSearch(m.name);
            // Check xem có khớp hoàn toàn với một trong các query (ưu tiên query dài) không
            return uniqueQueries.some(q => {
                const qClean = normalizeForSearch(q);
                return mClean === qClean || (mClean.includes(qClean) && mClean.length < qClean.length + 10);
            });
        });

        if (strictMatches.length > 0) {
            // Nếu có ứng viên "xịn", chỉ lấy ứng viên xịn. Bỏ qua các ứng viên "ăn theo" (như Xico)
            matchedCandidates = strictMatches;
        }
    }

    if (matchedCandidates.length === 0) return { streams: [] };
    console.log(`-> KẾT QUẢ CUỐI:`);
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

                // === FIX 1: FILTER STRICT MODE (Trị Breaking Bad Season.1) ===
                const matchedVideos = metaRes.data.meta.videos.filter(vid => {
                    const info = extractEpisodeInfo(vid.title || vid.name || "");
                    if (!info) return false;
                    
                    // Nếu request có Season (S > 0)
                    if (season > 0) {
                        // Nếu file tìm thấy có S > 0, phải khớp chính xác
                        if (info.s > 0) return info.s === season && info.e === episode;
                        // Nếu file tìm thấy là S=0 (chỉ có tập), chấp nhận rủi ro (cho Anime/Show lẻ)
                        // NHƯNG nếu server có nhiều file S>0, file S=0 này có thể là rác của Season 1
                        return info.e === episode; 
                    } 
                    // Nếu request là S0 (Miniseries/Anime không chia season)
                    else {
                        return info.e === episode;
                    }
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
