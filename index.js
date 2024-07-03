// index.js
import "dotenv/config";
import { Telegraf } from 'telegraf';
import "dotenv/config";
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Audio2TextJS from 'audio2textjs';
import crypto from 'crypto';
import sqlite3 from 'better-sqlite3';

// YOUR_TELEGRAM_BOT_TOKEN
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TIMEOUT = 50 * 60 * 1000;; // 50 minutes
const bot = new Telegraf(TELEGRAM_TOKEN, {
    handlerTimeout: TIMEOUT
});

/**
 * Maximum length allowed for a Telegram message.
 * @type {number}
 */
const MAX_MESSAGE_LENGTH = 4096;

// Define __dirname using import.meta.url and path.dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const botInfo = await bot.telegram.getMe();

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// Initialize the Audio2TextJS
const sttConverter = new Audio2TextJS({
    threads: 4,
    processors: 1,
    duration: 0,
    maxLen: 0,
    outputJson: true,
    outputTxt: true,
    outputCsv: true
});

const db = new sqlite3('database.db');

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        is_bot INTEGER,
        chat_type TEXT,
        language_code TEXT
    );

    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY,
        message_id INTEGER,
        user_id INTEGER,
        chat_id INTEGER,
        date INTEGER,
        file_id TEXT,
        duration INTEGER,
        mime_type TEXT,
        file_size INTEGER,
        file_name TEXT,
        file_url TEXT,
        file_path TEXT
    );

    CREATE TABLE IF NOT EXISTS hashes (
        fileHash TEXT PRIMARY KEY,
        chat_id INTEGER,
        file_url TEXT,
        textRAW TEXT
    );
`);

// Function to execute SQL query with error handling
const executeQuery = (query, params = []) => {
    try {
        const stmt = db.prepare(query);
        return stmt.run(params);
    } catch (error) {
        console.error(`Error executing query: ${query}`, error.message);
        throw error;
    }
};

// Function to load users from database
const loadUsers = () => {
    try {
        const query = 'SELECT * FROM users';
        return db.prepare(query).all();
    } catch (error) {
        console.error('Error loading users:', error.message);
        return [];
    }
};

// Function to save user to database
const saveUser = (user) => {
    try {
        const query = `
            INSERT INTO users (id, username, first_name, is_bot, chat_type, language_code)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, is_bot=excluded.is_bot, chat_type=excluded.chat_type, language_code=excluded.language_code
        `;
        executeQuery(query, [
            user.id,
            user.username || '', // تأكد من عدم وجود قيمة فارغة لاسم المستخدم
            user.first_name || '', // تأكد من عدم وجود قيمة فارغة للاسم الأول
            user.is_bot || 0, // استخدام قيمة افتراضية في حالة عدم وجود قيمة
            user.chat_type || '', // تأكد من عدم وجود قيمة فارغة لنوع المحادثة
            user.language_code || '' // تأكد من عدم وجود قيمة فارغة لرمز اللغة
        ]);
    } catch (error) {
        console.error('Error saving user:', error.message);
    }
};


// Function to remove user from database
const removeUser = (userId) => {
    try {
        const query = 'DELETE FROM users WHERE id = ?';
        executeQuery(query, [userId]);
    } catch (error) {
        console.error('Error removing user:', error.message);
    }
};

// Function to check if user exists in database
const isUserInDatabase = (userId) => {
    try {
        const query = 'SELECT COUNT(*) as count FROM users WHERE id = ?';
        const result = db.prepare(query).get(userId);
        return result.count > 0;
    } catch (error) {
        console.error('Error checking user in database:', error.message);
        return false;
    }
};

// Function to log user details to database
const dbUsers = (ctx) => {
    try {
        const { from } = ctx.message;
        const userData = { id: from.id, username: from.username, first_name: from.first_name, is_bot: from.is_bot, chat_type: ctx.chat.type, language_code: from.language_code };

        if (!isUserInDatabase(userData.id)) {
            saveUser(userData);
        }
    } catch (error) {
        console.error('Error saving user data:', error.message);
    }
};

// Function to download file from URL and save locally
const downloadFile = async (url, outputPath) => {
    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        await fs.promises.writeFile(outputPath, Buffer.from(buffer));
        return outputPath;
    } catch (error) {
        console.error('Error downloading file:', error.message);
        throw error;
    }
};

// Function to calculate file hash
const calculateFileHash = async (filePath) => {
    try {
        const algorithm = 'sha256';
        const fileData = await fs.promises.readFile(filePath);
        const hash = crypto.createHash(algorithm).update(fileData).digest('hex');
        return hash;
    } catch (error) {
        console.error('Error calculating file hash:', error.message);
        throw error;
    }
};

// Function to log request details to database
const logRequest = async (message, fileUrl, filePath) => {
    try {
        const { message_id, from, chat, date, audio, voice, video } = message;
        const media = audio || voice || video || {};

        const query = `
            INSERT INTO requests (message_id, user_id, chat_id, date, file_id, duration, mime_type, file_size, file_name, file_url, file_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        executeQuery(query, [message_id, from.id, chat.id, date, media.file_id, media.duration, media.mime_type, media.file_size, media.file_name || 'audio.ogg', fileUrl, filePath]);
    } catch (error) {
        console.error('Error logging request:', error.message);
        throw error;
    }
};

/**
 * Handles audio and video messages sent to the bot
 * @param {Object} ctx - The update context from Telegraf
 * @param {Object} media - The media object from the message
 */
const handleMediaMessage = async (ctx, media) => {
    try {
        // Check if the media duration exceeds 10 minutes (600 seconds)
        if (media.duration > 600) {
            return ctx.reply('⚠️ The media file is too long. Please send a file that is less than 10 minutes.');
        }

        const fileLink = await ctx.telegram.getFileLink(media.file_id);
        const inputFileUrl = fileLink.href;
        const extname = (media.mime_type === 'video/mp4') ? 'mp4' : (media.mime_type === 'audio/ogg') ? 'ogg' : 'mp3'
        const inputFilePath = path.join(downloadsDir, `${media.file_id}.${extname}`);

        // Log the request details to requests.json
        await logRequest(ctx.message, inputFileUrl, inputFilePath);

        ctx.reply('✅ Your request has been logged and will be processed shortly.');
    } catch (error) {
        ctx.reply(`❌ An error occurred while processing the message:\n${error.message}`);
    }
};

/**
 * Process media files recorded in requests from the database.
 * Retries processing every 10 seconds if no requests are found.
 * Logs errors encountered during processing.
 */
const processMediaFiles = async () => {
    try {
        const query = 'SELECT * FROM requests';
        const requests = db.prepare(query).all();

        if (requests.length === 0) {
            setTimeout(processMediaFiles, 10 * 1000); // Retry processing after 10 seconds
            return;
        }

        for (const request of requests) {
            try {
                await processRequest(request);
            } catch (error) {
                console.error(`Error processing request ${request.id}:`, error.message);
            }
        }

        setTimeout(processMediaFiles, 10 * 1000);
    } catch (error) {
        console.error('Error processing media files:', error.message);
        setTimeout(processMediaFiles, 10 * 1000);
    }
};

/**
 * Process a single media file request.
 * Downloads the file, calculates its hash, performs conversion if necessary,
 * sends success or failure messages, and cleans up files.
 *
 * @param {Object} request - The request object containing request details.
 * @param {number} request.id - The ID of the request.
 * @param {number} request.chat_id - The ID of the chat to send messages to.
 * @param {number} request.message_id - The ID of the message to reply to.
 * @param {string} request.file_url - The URL of the file to download.
 * @param {string} request.file_path - The local path to save the downloaded file.
 */
const processRequest = async (request) => {
    const { id, chat_id, message_id, file_url, file_path } = request;

    await downloadFile(file_url, file_path);

    const fileHash = await calculateFileHash(file_path);

    const existingHash = db.prepare('SELECT * FROM hashes WHERE fileHash = ?').get(fileHash);

    try {
        if (existingHash) {
            const message = `✅ Conversion completed successfully:\n\n${truncateText(existingHash.textRAW)}`;
            await sendMessage(chat_id, message, message_id);
        } else {
            const result = await sttConverter.runWhisper(file_path, process.env.WHISPER_MODEL, process.env.WHISPER_LANGUAGE);

            if (result.success) {
                const message = `✅ Conversion completed successfully:\n\n${truncateText(result.output[1].data)}`;
                await sendMessage(chat_id, message, message_id);
                await Promise.all([
                    sendDocument(chat_id, `${file_path}.OUTPUT.wav.json`, 'text.json', message_id),
                    sendDocument(chat_id, `${file_path}.OUTPUT.wav.txt`, 'text.txt', message_id),
                    sendDocument(chat_id, `${file_path}.OUTPUT.wav.csv`, 'text.csv', message_id)
                ]);
                db.prepare(`
                    INSERT INTO hashes (fileHash, chat_id, file_url, textRAW)
                    VALUES (?, ?, ?, ?)
                `).run(fileHash, chat_id, file_url || '', result.output[1].data || '');
            } else {
                console.log(`❌ Conversion failed:\n${result.message}`);
                await sendMessage(chat_id, `❌ Conversion failed:\n${result.message}`, message_id);
            }
        }
    } catch (error) {
        console.error('Error sending message or document:', error.message);
        await cleanupFiles(file_path);
        db.prepare('DELETE FROM requests WHERE id = ?').run(id);
        return; // Exit function early
    }

    await cleanupFiles(file_path);
    db.prepare('DELETE FROM requests WHERE id = ?').run(id);
};

/**
 * Clean up temporary files associated with a processed request.
 *
 * @param {string} file_path - The path to the main file and associated output files.
 */
const cleanupFiles = async (file_path) => {
    try {
        if (fs.existsSync(file_path)) await fs.promises.unlink(file_path);
        if (fs.existsSync(`${file_path}.OUTPUT.wav`)) await fs.promises.unlink(`${file_path}.OUTPUT.wav`);
        await Promise.all([
            `${file_path}.OUTPUT.wav.json`,
            `${file_path}.OUTPUT.wav.txt`,
            `${file_path}.OUTPUT.wav.csv`
        ].map(async (ext) => {
            if (fs.existsSync(ext)) await fs.promises.unlink(ext);
        }));
    } catch (error) {
        console.error('Error cleaning up files:', error.message);
        throw error;
    }
};

/**
 * Sends a text message to a Telegram chat.
 *
 * @param {number|string} chat_id - The ID of the chat where the message will be sent.
 * @param {string} text - The text message content.
 * @param {number} [reply_to_message_id] - (Optional) ID of the message to reply to.
 * @throws {Error} If there is an error sending the message.
 */
const sendMessage = async (chat_id, text, reply_to_message_id) => {
    try {
        await bot.telegram.sendMessage(chat_id, text, { reply_to_message_id });
    } catch (error) {
        console.error('Error sending message:', error.message);
        throw error;
    }
};

/**
 * Sends a document (file) to a Telegram chat.
 *
 * @param {number|string} chat_id - The ID of the chat where the document will be sent.
 * @param {string} filePath - The path to the file to be sent.
 * @param {string} fileName - The name of the file.
 * @param {number} [reply_to_message_id] - (Optional) ID of the message to reply to.
 * @throws {Error} If there is an error sending the document.
 */
const sendDocument = async (chat_id, filePath, fileName, reply_to_message_id) => {
    try {
        const source = fs.readFileSync(filePath);
        await bot.telegram.sendDocument(chat_id, { source, filename: fileName }, { reply_to_message_id });
    } catch (error) {
        console.error('Error sending document:', error.message);
        throw error;
    }
};

/**
 * Truncates the given text if it exceeds the maximum message length.
 * @param {string} text - The text to truncate.
 * @returns {string} The truncated text, if necessary.
 */
function truncateText(text) {
    if (text.length > MAX_MESSAGE_LENGTH) {
        const truncated = '... (truncated)';
        return text.substring(0, MAX_MESSAGE_LENGTH - truncated.length) + truncated;
    } else {
        return text;
    }
}

// Startup message
const numUsers = loadUsers().length;
const startupMessage = `
🤖 **Bot Startup Information**
📅 Current Time: ${new Date().toLocaleString()}
🚀 Bot Status: Operational
👥 Users: ${numUsers}
🤖 Bot Username: @${botInfo.username}
📜 Bot Description: audio processing and transcription. It supports converting audio files to text using various pre-trained models.

🌟 Enjoy using the bot!
`;

// Print startup message
console.log(startupMessage);

// Listen for text commands
bot.start(async (ctx) => {
    dbUsers(ctx);

    ctx.reply(`
🎤 Welcome! Send me an audio or video file to convert it to text.\n\n💬 If you have any questions, please feel free to ask @f93ii.
`);
});

// Handle the command to fetch all users in batches
bot.command('users', async (ctx) => {
    try {
        const Users = loadUsers();
        const batchSize = 10;

        for (let i = 0; i < Users.length; i += batchSize) {
            const batch = Users.slice(i, i + batchSize);

            let message = `👥 Total number of users: ${Users.length}\n\n`;
            for (let j = 0; j < batch.length; j++) {
                const user = batch[j];
                message += `
${j + 1}️⃣ User ID: ${user.id}
👤 Username: @${user.username || '-'}
📛 First Name: ${user.first_name || '-'}
💬 Chat Type: ${user.chat_type || '-'}
🌐 Language Code: ${user.language_code || '-'}
\n`;
            }

            await ctx.reply(message);
        }
    } catch (error) {
        console.error('❌ Error fetching users:', error);
        await ctx.reply(`❌ Error fetching users: ${error.message}`);
    }
});

// Handle bot being deleted from the chat
bot.on('my_chat_member', async (ctx) => {
    const new_chat_member = ctx?.update?.my_chat_member?.new_chat_member;
    const status = new_chat_member?.status;

    if (status === 'left' || status === 'kicked') {
        const chatId = ctx.chat.id; // Get the chat ID where the bot was deleted
        removeUser(chatId);
    }
});

// Listen for audio messages
bot.on('audio', async (ctx) => {
    dbUsers(ctx);
    await handleMediaMessage(ctx, ctx.message.audio);
});

// Listen for voice messages
bot.on('voice', async (ctx) => {
    dbUsers(ctx);
    await handleMediaMessage(ctx, ctx.message.voice);
});

// Listen for video messages
bot.on('video', async (ctx) => {
    dbUsers(ctx);
    await handleMediaMessage(ctx, ctx.message.video);
});

// Handle errors
bot.catch((err, ctx) => {
    console.error(`❌ Error encountered in the bot: ${err}`);
    ctx.reply(`❌ Sorry, something went wrong.`);
});

// Start processing media files from requests.json
processMediaFiles();

// Launch the bot
bot.launch().then(() => {
    console.log(`🚀 Bot @${botInfo.username} is running`);
}).catch(err => {
    console.error(`❌ Error launching bot: ${err}`);
});