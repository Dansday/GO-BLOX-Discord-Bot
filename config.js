// Shared Configuration for both Self-Bot and Official Bot

// Environment Configuration
export const ENV = {
    PRODUCTION: true // Set to true for production, false for testing
};

// Self-Bot Token (for monitoring source servers)
export const SELF_BOT_TOKEN = "MTM3OTYxODk0MTY4NDY4Mjc2NA.GQbIIl.gucYwt8CHvhPiciAuCML5weuM6c2bTls3gDUKo";

// Official Bot Token (for forwarding to target servers)
export const OFFICIAL_BOT_TOKEN = "MTQxNzQ4NzIyOTg4MTgxNTA4MA.GuC-RQ.NHRya3Ryny-oecpXQ8dmRHjvt8gz7qns7hzs98";

// Official Bot Application ID
export const OFFICIAL_BOT_APPLICATION_ID = "1417487229881815080";

// Communication Configuration
export const COMMUNICATION = {
    // Webhook URL for self-bot to send data to official bot (local webhook server)
    WEBHOOK_URL: "http://localhost:7777",
    // Secret key for webhook authentication
    SECRET_KEY: "OwnerDansdayGOBLOX2025",
    // Port for webhook server
    PORT: 7777
};

// Embed Configuration
export const EMBED = {
    // Color for forwarded message embeds (red)
    COLOR: 0xff0000
};

// Logger Configuration
export const LOGGER = {
    CHANNELS: "1382897055034511431"
};

// Welcomer Configuration
export const WELCOMER = {
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

// Booster Configuration
export const BOOSTER = {
    CHANNELS: {
        "1364374298307072010": "1364374299359707212"
    },
    MESSAGES: [
        "Terima kasih banyak, {user}! Server boost kamu sangat berarti untuk kami! 💎",
        "Wah, {user} baru boost server nih! Terima kasih ya, kalian luar biasa! 🚀",
        "Makasih banget {user} udah boost server! Komunitas kita jadi lebih keren nih! ✨",
        "Yoo {user}! Terima kasih untuk boost-nya, kalian amazing! 💫",
        "{user} baru boost server, thank you so much! 🙏",
        "Terima kasih {user} udah support server dengan boost! Kalian the best! 🔥",
        "{user} boost server nih! Thank you untuk dukungannya! 🌟",
        "Keren banget {user}! Terima kasih udah boost server, sangat membantu! 💪",
        "Wah {user} boost server! Makasih banyak, kalian spesial! 🎉",
        "{user} baru boost nih! Terima kasih, kalian membuat server ini lebih baik! ❤️"
    ]
};

// Forwarder Configuration
export const FORWARDER = {
    // Production source channels (all channels)
    PRODUCTION_SOURCE_CHANNELS: {
        "834333621405220884": { group: "blair", type: "announcements" }, //announcements
        "834333647796174869": { group: "blair", type: "announcements" }, //development-announcements
        "835423033408618496": { group: "blair", type: "changelogs" }, //updates
        "834333659338244126": { group: "blair", type: "leaks" }, //sneak-peeks
        "856769231142780938": { group: "blair", type: "socialupdates" }, //social-announcements
        "1352059967896555631": { group: "evade", type: "announcements" }, //announcements
        "1352060296583184525": { group: "evade", type: "changelogs" }, //change-log
        "996516953206300693": { group: "evade", type: "leaks" }, //leaks
        "1209439201255362620": { group: "danskaraoke", type: "announcements" }, //announcements
        "1229797155607412806": { group: "danskaraoke", type: "leaks" }, //sneak-peeks
        "1242573606886834176": { group: "danskaraoke", type: "songupdates" }, //song-updates
        "1217763101135605791": { group: "danskaraoke", type: "songupdates" }, //song-logs
        "1332897953743900762": { group: "deadrails", type: "announcements" }, //announcements
        "1336200820366114908": { group: "deadrails", type: "changelogs" }, //updates
        "1339330781612609546": { group: "deadrails", type: "leaks" }, //sneak-peeks
        "1341590625212039209": { group: "dig", type: "announcements" }, //announcements
        "1341590626520666123": { group: "dig", type: "announcements" }, //sub-announcements
        "1341590627774759013": { group: "dig", type: "changelogs" }, //updates
        "1341590629171597396": { group: "dig", type: "leaks" }, //leaks
        "1254504608676581376": { group: "fisch", type: "announcements" }, //announcements
        "1254504632114352239": { group: "fisch", type: "changelogs" }, //updates
        "1303085564102312088": { group: "fisch", type: "leaks" }, //leaks
        "1392138180647714846": { group: "growagarden", type: "announcements" }, //GaG Trading | announcements
        "1373732475582546051": { group: "growagarden", type: "announcements" }, //Jandel Fan | announcements
        "1378015808428445777": { group: "growagarden", type: "announcements" }, //Ember Support | announcements
        "1378020774610206860": { group: "growagarden", type: "changelogs" }, //Ember Support | change-log
        "1398539523046117468": { group: "growagarden", type: "leaks" }, //Jandel Fan | leaks
        "1427507516614381588": { group: "growagarden", type: "stocks" }, //Jandel Fan | stock
        "1408932641859829852": { group: "growagarden", type: "weather" }, //Jandel Fan | weather
        "1408933312596279377": { group: "growagarden", type: "merchants" }, //Jandel Fan | merchants
        "1394790732300161195": { group: "growagarden", type: "adminabuse" }, //Jandel Fan | admin-abuse
    },
    // Test source channels (limited for testing)
    TEST_SOURCE_CHANNELS: {
        "1428373619490160650": { group: "botaccess", type: "receivemessage" }, //for testing purposes
    },
    // Get source channels based on environment
    get SOURCE_CHANNELS() {
        return ENV.PRODUCTION ? this.PRODUCTION_SOURCE_CHANNELS : this.TEST_SOURCE_CHANNELS;
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
            stocks: "1383553496409837728",
            weather: "1383555288509972490",
            merchants: "1383555456722800832",
            adminabuse: "1396359317635993665",
        },

        //for testing purposes
        "botaccess": {
            receivemessage: "1428373710838169743"
        }
    },
    ROLE_MENTIONS: {
        "blair": "<@&1377053308937834547>",
        "evade": "<@&1405142958361153638>",
        "danskaraoke": "<@&1383800439241179240>",
        "deadrails": "<@&1377005192792248350>",
        "dig": "<@&1396355600690184212>",
        "fisch": "<@&1377005118599467259>",
        "growagarden": "<@&1377005009304158421>",
    },
    EXCLUDED_USERS: [
        "678344927997853742",
        "628400349979344919"
    ]
};
