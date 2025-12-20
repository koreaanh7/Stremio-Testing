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
    id: "com.phim4k.vip.final.v17",
    version: "17.0.0",
    name: "Phim4K VIP (Precision)",
    description: "Fix From/Bet/Ghibli with Accent Check & Year Enforce",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// === 1. TỪ ĐIỂN (GIỮ NGUYÊN DẤU TIẾNG VIỆT) ===
const VIETNAMESE_MAPPING = {
    "from": "bẫy",  // CHÚ Ý: Code sẽ check có dấu "bẫy" hay không
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

// Hàm chuẩn hóa cơ bản (vẫn dùng để search query)
function normalizeForSearch(title) {
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Xóa dấu
        .replace(/['":\-.]/g, " ") 
        .replace(/\s+/g, " ")
        .trim();
}

// Hàm so sánh chuỗi CÓ DẤU (Quan trọng cho From/Bẫy)
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

    // === TẠO DANH SÁCH TỪ KHÓA ===
    const queries = [];
    const mappedVietnamese = VIETNAMESE_MAPPING[originalName.toLowerCase()];

    // 1. Nếu có tên tiếng Việt, search tên tiếng Việt trước (Độ chính xác cao nhất)
    if (mappedVietnamese) {
        queries.push(mappedVietnamese); 
    }
    
    // 2. Search tên gốc (English)
    queries.push(originalName);

    // 3. Search tên sạch (nếu khác tên gốc)
    const cleanName = normalizeForSearch(originalName);
    if (cleanName !== originalName.toLowerCase()) queries.push(cleanName);

    // 4. Fix Dexter (Tách dấu :)
    if (originalName.includes(":")) {
        const splitName = originalName.split(":")[0].trim();
        if (splitName.length > 3) queries.push(splitName);
    }

    const uniqueQueries = [...new Set(queries)];
    console.log(`\n=== Xử lý: "${originalName}" (${year}) | Type: ${type} ===`);
    console.log(`-> Queries: ${JSON.stringify(uniqueQueries)}`);

    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    let match = null;

    // === SEARCH SONG SONG (Tăng tốc độ) ===
    // Thay vì await từng cái, ta bắn tất cả request cùng lúc
    const searchPromises = uniqueQueries.map(q => 
        axios.get(`${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(q)}.json`, 
            { headers: HEADERS, timeout: 5000 }).catch(() => null)
    );

    const responses = await Promise.all(searchPromises);

    // Gộp tất cả kết quả lại thành một mảng duy nhất để lọc
    let allCandidates = [];
    responses.forEach(res => {
        if (res && res.data && res.data.metas) {
            allCandidates = allCandidates.concat(res.data.metas);
        }
    });

    // Lọc trùng lặp ID
    allCandidates = allCandidates.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

    // === LOGIC LỌC "THẦN THÁNH" (Verify) ===
    match = allCandidates.find(m => {
        if (m.type && m.type !== type) return false;

        const serverName = m.name; // Tên gốc trên server (có dấu)
        
        // --- BƯỚC 1: KIỂM TRA NĂM (BẮT BUỘC) ---
        // Không bao giờ được bỏ qua bước này để tránh vụ Bet (2025) vs Kakegurui (2017)
        let yearMatch = false;
        if (!hasYear) {
            yearMatch = true;
        } else {
            // Lấy tất cả số năm trong tên phim
            const yearMatches = serverName.match(/\d{4}/g);
            if (yearMatches) {
                // Sai số +/- 1 năm (Khắt khe hơn v16)
                yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
            } else if (m.releaseInfo) {
                yearMatch = m.releaseInfo.includes(year.toString()) 
                         || m.releaseInfo.includes((year-1).toString()) 
                         || m.releaseInfo.includes((year+1).toString());
            } else {
                // Nếu server không ghi năm, đành chấp nhận rủi ro thấp
                yearMatch = true; 
            }
        }

        if (!yearMatch) return false; // Sai năm -> LOẠI NGAY

        // --- BƯỚC 2: KIỂM TRA TÊN ---
        
        // A. NẾU CÓ MAPPING TIẾNG VIỆT
        if (mappedVietnamese) {
            // Kiểm tra CÓ DẤU.
            // Ví dụ: mappedVietnamese = "bẫy"
            // serverName = "Bảy thế giới" -> Chứa "bẫy"? KHÔNG -> Loại.
            // serverName = "Bẫy (2022) From" -> Chứa "bẫy"? CÓ -> Nhận.
            if (containsWithAccent(serverName, mappedVietnamese)) {
                return true;
            }
            // Nếu không chứa tên tiếng Việt đúng dấu, thì kiểm tra xem nó có chứa tên Tiếng Anh gốc không?
            // (Phòng trường hợp server đổi tên tiếng Việt khác mapping của ta)
        }

        // B. KIỂM TRA TÊN TIẾNG ANH (LOGIC PHỤ TRỢ)
        const qClean = normalizeForSearch(originalName);
        const serverClean = normalizeForSearch(serverName);

        // Nếu từ khóa ngắn (From, Bet)
        if (qClean.length < 4) {
            // Phải bắt đầu bằng tên đó
            // Ví dụ: "From" -> OK "From (2022)"
            // Ví dụ: "From" -> OK "Bẫy (2022) From" (Nếu server lưu kiểu này thì logic contains ở trên đã bắt rồi, nếu chưa bắt thì check tiếng Anh)
            // Regex: Tìm chữ "From" ở đầu string, HOẶC sau dấu cách/dấu ngoặc
            const regex = new RegExp(`(^|\\s|\\(|\\-)${qClean}(\\s|\\)|\\:|$)`, 'i');
            return regex.test(serverClean);
        }

        // Tên dài bình thường
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
