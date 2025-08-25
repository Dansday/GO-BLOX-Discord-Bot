import OpenAI from 'openai';
import { CHATBOT } from './config.js';
import logger from './logger.js';

const client = new OpenAI({
    baseURL: CHATBOT.BASE_URL,
    apiKey: CHATBOT.API_KEY,
});

const RESPONSE_TIMEOUT = 30000;
const DISCORD_MAX_LENGTH = 4000;

function cleanMessage(content, botId) {
    return content
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .trim();
}

function truncateResponse(response) {
    if (response.length <= DISCORD_MAX_LENGTH) return response;

    const truncated = response.substring(0, DISCORD_MAX_LENGTH - 100);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const breakPoint = Math.max(lastPeriod, lastNewline);

    if (breakPoint > 0) {
        return truncated.substring(0, breakPoint + 1) + '\n\n[Pesan dipotong karena terlalu panjang]';
    }

    return truncated + '...\n\n[Pesan dipotong karena terlalu panjang]';
}

export async function handleChatbot(message) {
    const startTime = Date.now();
    try {
        if (message.guildId !== CHATBOT.ALLOWED_SERVER) return;

        const content = cleanMessage(message.content, message.client.user.id);
        if (!content) return;

        const searchPrompt = `Search on Fandom.com and answer this question: ${content}`;

        let response;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('API request timed out')), RESPONSE_TIMEOUT);
            });

            response = await Promise.race([
                client.responses.create({
                    model: CHATBOT.MODEL,
                    tools: [{ type: "web_search_preview" }],
                    tool_choice: { type: "web_search_preview" },
                    input: searchPrompt
                }),
                timeoutPromise
            ]);

            const botResponse = response.output_text;
            const responseTime = Date.now() - startTime;

            const cleanResponse = cleanMessage(botResponse, message.client.user.id);
            const truncatedResponse = truncateResponse(cleanResponse);

            await message.reply(`${message.author} ${truncatedResponse}`);
            await logger.log(`🤖 Chatbot interaction in ${message.channel.name}:\nUser: ${message.author.tag} - ${content}\nBot: ${truncatedResponse}\n⏱️ Response time: ${responseTime}ms`);
        } catch (error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
                await message.reply(`${message.author} Maaf, kuota chatbot hari ini sudah habis. Silakan coba lagi besok!`);
                await logger.log(`❌ Chatbot quota/limit reached for ${message.author.tag}`);
                return;
            }
            if (errorMessage.includes('timeout')) {
                await message.reply(`${message.author} Maaf, chatbot sedang sibuk. Silakan coba lagi dalam beberapa saat.`);
                await logger.log(`⏰ Chatbot timeout for ${message.author.tag} after ${Date.now() - startTime}ms`);
                return;
            }
            if (errorMessage.includes('api') || errorMessage.includes('connection')) {
                await message.reply(`${message.author} Maaf, chatbot sedang mengalami masalah teknis. Silakan coba lagi nanti.`);
                await logger.log(`🔴 Chatbot API error for ${message.author.tag}: ${error.message}`);
                return;
            }
            throw error;
        }
    } catch (error) {
        console.error("Chatbot error:", error);
        await logger.log(`❌ Chatbot error for ${message.author.tag}: ${error.message}`);
        await message.reply(`${message.author} Maaf, terjadi kesalahan pada chatbot.`);
    }
}

function init(client) {
    client.on('messageCreate', async (message) => {
        if (!message.mentions.users.has(client.user.id) || message.author.id === client.user.id) return;

        await handleChatbot(message);
    });
}

export default { init };
