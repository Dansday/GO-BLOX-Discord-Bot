// Bot Token
export const TOKEN = "MTM3OTYxODk0MTY4NDY4Mjc2NA.GQbIIl.gucYwt8CHvhPiciAuCML5weuM6c2bTls3gDUKo";

// Logger Configuration
export const LOGGER = {
    CHANNELS: "1382897055034511431"
};

// Chatbot Configuration
export const CHATBOT = {
    API_KEY: "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",
    MODEL: "gpt-4.1-mini-2025-04-14",
    BASE_URL: "https://api.openai.com/v1",
    ALLOWED_SERVER: "1364374298307072010",
};

// Welcomer Configuration
export const WELCOMER = {
    FILES: {
        JSON: "welcomed.json"
    },
    CHANNELS: {
        "1364374298307072010": "1364374299359707212"
    },
    MESSAGES: [
        "Selamat datang, {user}! Semoga betah di sini ya 😄",
        "Halo {user}, senang banget kamu join! Jangan sungkan buat ngobrol 👋",
        "Yoo {user}! Selamat datang di server, semoga nyaman di sini 🚀",
        "Hai {user}, jangan lupa kenalan sama yang lain ya! 🎉",
        "Wah, ada {user} nih! Welcome welcome 🥳",
        "{user} baru aja masuk ke server, kasih sambutan dong! 🙌",
        "Selamat datang di komunitas kita, {user}! Ayo seru-seruan bareng 🔥",
        "{user}, akhirnya kamu datang juga! Yuk ngobrol-ngobrol 🗨️",
        "Haii {user}! Jangan lupa baca rules dan langsung nimbrung 😎",
        "Server jadi makin rame nih gara-gara {user} join 🤩"
    ]
};

// Forwarder Configuration
export const FORWARDER = {
    FILES: {
        JSON: "forwarded.json"
    },
    SOURCE_CHANNELS: {
        "834333621405220884": { group: "blair", type: "announcements", fetchHistory: true }, //announcements
        "834333647796174869": { group: "blair", type: "announcements", fetchHistory: true }, //development-announcements
        "835423033408618496": { group: "blair", type: "changelogs", fetchHistory: true }, //updates
        "834333659338244126": { group: "blair", type: "leaks", fetchHistory: true }, //sneak-peeks
        "856769231142780938": { group: "blair", type: "socialupdates", fetchHistory: true }, //social-announcements
        "1352059967896555631": { group: "evade", type: "announcements", fetchHistory: true }, //announcements
        "1352060296583184525": { group: "evade", type: "changelogs", fetchHistory: true }, //change-log
        "996516953206300693": { group: "evade", type: "leaks", fetchHistory: true }, //leaks
        "1209439201255362620": { group: "danskaraoke", type: "announcements", fetchHistory: true }, //announcements
        "1229797155607412806": { group: "danskaraoke", type: "leaks", fetchHistory: true }, //sneak-peeks
        "1242573606886834176": { group: "danskaraoke", type: "songupdates", fetchHistory: true }, //song-updates
        "1217763101135605791": { group: "danskaraoke", type: "songupdates", fetchHistory: true }, //song-logs
        "1332897953743900762": { group: "deadrails", type: "announcements", fetchHistory: true }, //announcements
        "1336200820366114908": { group: "deadrails", type: "changelogs", fetchHistory: true }, //updates
        "1339330781612609546": { group: "deadrails", type: "leaks", fetchHistory: true }, //sneak-peeks
        "1341590625212039209": { group: "dig", type: "announcements", fetchHistory: true }, //announcements
        "1341590626520666123": { group: "dig", type: "announcements", fetchHistory: true }, //sub-announcements
        "1341590627774759013": { group: "dig", type: "changelogs", fetchHistory: true }, //updates
        "1341590629171597396": { group: "dig", type: "leaks", fetchHistory: true }, //leaks
        "1254504608676581376": { group: "fisch", type: "announcements", fetchHistory: true }, //announcements
        "1254504632114352239": { group: "fisch", type: "changelogs", fetchHistory: true }, //updates
        "1303085564102312088": { group: "fisch", type: "leaks", fetchHistory: true }, //leaks
        "1392138180647714846": { group: "growagarden", type: "announcements", fetchHistory: true }, //GaG Trading | announcements
        "1373732475582546051": { group: "growagarden", type: "announcements", fetchHistory: true }, //Jandel Fan | announcements
        "1378015808428445777": { group: "growagarden", type: "announcements", fetchHistory: true }, //Ember Support | announcements
        "1378020774610206860": { group: "growagarden", type: "changelogs", fetchHistory: true }, //Ember Support | change-log
        "1398539523046117468": { group: "growagarden", type: "leaks", fetchHistory: true }, //Jandel Fan | leaks
        "1373698281984753714": { group: "growagarden", type: "seeds", fetchHistory: false }, //Jandel Fan | stock
        "1373218102313091072": { group: "growagarden", type: "eggs", fetchHistory: false }, //Gag Trading | egg-stock
        "1373698339509375018": { group: "growagarden", type: "weather", fetchHistory: false }, //Jandel Fan | weather
        "1376539587949887499": { group: "growagarden", type: "cosmetics", fetchHistory: false }, //Gag Trading | cosmetics-stock
        "1392876996861628466": { group: "growagarden", type: "merchants", fetchHistory: false }, //Jandel Fan | merchants
        "1394790732300161195": { group: "growagarden", type: "adminabuse", fetchHistory: true }, //Jandel Fan | admin-abuse
    },
    TARGET_CHANNELS: {
        "blair": {
            announcements: "1405133585555521556",
            changelogs: "1377053187131048056",
            leaks: "1405127044785897583",
            socialupdates: "1405128520459616337"
        },
        "evade": {
            announcements: "1405142615225274389",
            changelogs: "1405142642425073694",
            leaks: "1405142666546774108"
        },
        "danskaraoke": {
            announcements: "1383799987753844880",
            leaks: "1405129772538794095",
            songupdates: "1383804379546648596"
        },
        "deadrails": {
            announcements: "1405134978815234170",
            changelogs: "1376960664178000003",
            leaks: "1405130668148654140"
        },
        "dig": {
            announcements: "1405135451920007218",
            changelogs: "1396357493139181670",
            leaks: "1405131710684860516"
        },
        "fisch": {
            announcements: "1405135718904496168",
            changelogs: "1376159931442532463",
            leaks: "1405132325284483153"
        },
        "growagarden": {
            announcements: "1405136401304916009",
            changelogs: "1383561457832038501",
            leaks: "1405138081190903819",
            seeds: "1383553496409837728",
            eggs: "1383555174030901468",
            weather: "1383555288509972490",
            cosmetics: "1383555365970509945",
            merchants: "1383555456722800832",
            adminabuse: "1396359317635993665",
        },
    },
    ROLE_MENTIONS: {
        "blair": "<@&1377053308937834547>",
        "evade": "<@&1405142958361153638>",
        "danskaraoke": "<@&1383800439241179240>",
        "deadrails": "<@&1377005192792248350>",
        "dig": "<@&1396355600690184212>",
        "fisch": "<@&1377005118599467259>",
        "growagarden": "<@&1377005009304158421>"
    },
    EXCLUDED_USERS: [
        "678344927997853742",
        "628400349979344919"
    ]
};
