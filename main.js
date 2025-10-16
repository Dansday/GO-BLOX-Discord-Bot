import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const mode = args[0] || "both";

function startBot(botType) {
    const botPath = join(__dirname, botType);
    const child = spawn("node", ["main.js"], {
        cwd: botPath,
        stdio: "inherit",
        shell: true
    });

    child.on("error", (err) => {
        console.error(`Failed to start ${botType}:`, err);
    });

    child.on("exit", (code) => {
        console.log(`${botType} exited with code ${code}`);
    });

    return child;
}

console.log("🚀 Starting Goblox Bot System...");

if (mode === "selfbot") {
    console.log("📡 Starting Self-Bot only...");
    startBot("self-bot");
} else if (mode === "official") {
    console.log("🤖 Starting Official Bot only...");
    startBot("official-bot");
} else {
    console.log("🔄 Starting both Self-Bot and Official Bot...");
    const selfBot = startBot("self-bot");
    const officialBot = startBot("official-bot");

    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n🛑 Shutting down bots...");
        selfBot.kill("SIGINT");
        officialBot.kill("SIGINT");
        process.exit(0);
    });
}
