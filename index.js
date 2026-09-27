const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. WEB SERVER GIỮ BOT SỐNG TRÊN RENDER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Discord Casino & Game đang hoạt động!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server HTTP mở tại port ${PORT}`);
});

// ==========================================
// 2. KHỞI TẠO DISCORD BOT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// CONFIGURATION
const PREFIX = '!';
const TOKEN = process.env.TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = process.env.ADMIN_ID || '1498554147304247296'; 

const FILES = {
    BALANCES: './balances.json',
    TITLES: './titles.json',
    CONFIG: './config.json',           
    WORD_CONFIG: './word_config.json', 
    LODE_CONFIG: './lode_config.json', 
    LOTTERY: './lottery.json',         
    STAFFS: './staffs.json',           
    LOANS: './loans.json',             
    CRYPTO: './crypto.json',           
    PORTFOLIO: './portfolio.json'      
};

// DATA MANAGERS & AUTO-SAVE IMMEDIATELY
const loadJSON = (file, isMap = true) => {
    if (!fs.existsSync(file)) return isMap ? new Map() : {};
    try {
        const raw = fs.readFileSync(file, 'utf8');
        return isMap ? new Map(JSON.parse(raw)) : JSON.parse(raw);
    } catch (err) {
        console.error(`[Data Load Error] ${file}:`, err.message);
        return isMap ? new Map() : {};
    }
};

const saveJSONSync = (file, data) => {
    try {
        const serialized = data instanceof Map ? JSON.stringify(Array.from(data.entries()), null, 2) : JSON.stringify(data, null, 2);
        fs.writeFileSync(file, serialized, 'utf8');
    } catch (err) {
        console.error(`[Data Save Error] ${file}:`, err.message);
    }
};

let balances = loadJSON(FILES.BALANCES);
let customTitles = loadJSON(FILES.TITLES);
let config = loadJSON(FILES.CONFIG, false);
let wordConfig = loadJSON(FILES.WORD_CONFIG, false);
let lodeConfig = loadJSON(FILES.LODE_CONFIG, false);
let lotteryData = loadJSON(FILES.LOTTERY, false);
let staffList = loadJSON(FILES.STAFFS, false);
let loans = loadJSON(FILES.LOANS);
let cryptoMarket = loadJSON(FILES.CRYPTO, false);
let portfolios = loadJSON(FILES.PORTFOLIO);

if (!lotteryData.tickets) lotteryData.tickets = [];
if (!lotteryData.lodeBets) lotteryData.lodeBets = [];
if (!lotteryData.lastResult) lotteryData.lastResult = null;
if (!Array.isArray(staffList.users)) staffList.users = [];

if (!cryptoMarket.coins) {
    cryptoMarket.coins = {
        'BTC': { name: 'Bitcoin', price: 100000, history: [100000], change: 0 },
        'ETH': { name: 'Ethereum', price: 50000, history: [50000], change: 0 },
        'JNG': { name: 'JangJii Coin', price: 10000, history: [10000], change: 0 }
    };
    saveJSONSync(FILES.CRYPTO, cryptoMarket);
}

const cryptoAnnounceMessages = new Map();
const dailyCooldown = new Map();
const workCooldown = new Map();
const guildSessions = new Map();
const bjGames = new Map();
const wordGameSessions = new Map();
const dictionaryCache = new Map();

const isBotOwner = (userId) => userId === ADMIN_ID;
const isBotStaff = (userId) => isBotOwner(userId) || staffList.users.includes(userId);

async function checkVietnameseWordOnline(word) {
    if (dictionaryCache.has(word)) return dictionaryCache.get(word);
    try {
        const url = `https://vi.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        const pages = data.query?.pages;
        if (!pages) return false;
        const pageId = Object.keys(pages)[0];
        const isValid = pageId !== "-1";
        dictionaryCache.set(word, isValid);
        return isValid;
    } catch (error) {
        console.error("[Dictionary API Error]:", error);
        return true;
    }
}

const START_WORDS = ['phát triển', 'học tập', 'máy tính', 'yêu thương', 'thành công', 'gia đình', 'hy vọng', 'tương lai', 'thành phố', 'văn hóa'];

const formatMoney = (amount) => Number(amount).toLocaleString('vi-VN') + 'đ';

const getBalance = (userId) => {
    if (!balances.has(userId)) {
        balances.set(userId, 50000);
        saveJSONSync(FILES.BALANCES, balances);
    }
    return balances.get(userId);
};

const setBalance = (userId, amount) => {
    balances.set(userId, Math.max(0, amount));
    saveJSONSync(FILES.BALANCES, balances);
};

const LOAN_INTEREST_RATE = 0.30;
const MAX_LOAN_LIMIT = 5000000;

const getLoan = (userId) => loans.get(userId) || 0;
const setLoan = (userId, amount) => {
    if (amount <= 0) loans.delete(userId);
    else loans.set(userId, amount);
    saveJSONSync(FILES.LOANS, loans);
};

const getUserPortfolio = (userId) => portfolios.get(userId) || {};
const setUserPortfolio = (userId, portfolioData) => {
    portfolios.set(userId, portfolioData);
    saveJSONSync(FILES.PORTFOLIO, portfolios);
};

// HÀM TẠO URL BIỂU ĐỒ KỸ THUẬT SỐ (QUICKCHART API)
const getCryptoChartUrl = (symbol, coin) => {
    const chartConfig = {
        type: 'line',
        data: {
            labels: coin.history.map((_, index) => `P${index + 1}`),
            datasets: [{
                label: `Biểu đồ giá ${symbol}`,
                data: coin.history,
                borderColor: 'rgb(0, 255, 128)',
                backgroundColor: 'rgba(0, 255, 128, 0.2)',
                fill: true,
                tension: 0.2
            }]
        },
        options: {
            plugins: {
                legend: { labels: { color: 'white' } }
            },
            scales: {
                x: { ticks: { color: 'white' }, grid: { color: '#333' } },
                y: { ticks: { color: 'white' }, grid: { color: '#333' } }
            }
        }
    };
    return `https://quickchart.io/chart?w=500&h=250&bkg=#2f3136&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
};

// HÀM TẠO ACTION ROW CHỨA CÁC NÚT: MUA, BÁN, BIỂU ĐỒ (CHO TỪNG COIN)
const getCryptoButtonsRow = (symbol) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`c_buy_${symbol}`).setLabel(`🛒 Mua ${symbol}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`c_sell_${symbol}`).setLabel(`💰 Bán ${symbol}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`c_chart_${symbol}`).setLabel(`📈 Biểu đồ ${symbol}`).setStyle(ButtonStyle.Primary)
    );
};

async function broadcastCryptoUpdate() {
    let marketText = '';
    for (const [symbol, coin] of Object.entries(cryptoMarket.coins)) {
        const trendEmoji = coin.change > 0 ? '🟢 ▲' : (coin.change < 0 ? '🔴 ▼' : '🟡 ➖');
        const sign = coin.change > 0 ? '+' : '';
        marketText += `${trendEmoji} **${coin.name} (${symbol})**: **${formatMoney(coin.price)}** (${sign}${coin.change}%)\n`;
    }

    const embedMarket = new EmbedBuilder()
        .setColor('Blurple')
        .setTitle('📊 BẢN TIN THỊ TRƯỜNG COIN & CHỨNG KHOÁN (TỰ ĐỘNG)')
        .setDescription(`*Giá thị trường vừa được cập nhật! Tự động làm mới sau mỗi 2 phút.*\n\n${marketText}`)
        .setTimestamp();

    // Tạo thanh nút bấm mặc định cho mã BTC hoặc tổng quan (Ở đây gắn nút cho BTC hoặc danh mục chính)
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('c_buy_BTC').setLabel('🛒 Mua BTC').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('c_sell_BTC').setLabel('💰 Bán BTC').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('c_chart_BTC').setLabel('📈 Biểu đồ BTC').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('c_portfolio').setLabel('💼 Xem Ví').setStyle(ButtonStyle.Secondary)
    );

    for (const [guildId, guildData] of Object.entries(config)) {
        if (typeof guildData === 'object' && guildData.cryptoChannelId) {
            const channel = await client.channels.fetch(guildData.cryptoChannelId).catch(() => null);
            if (channel) {
                const oldMsgId = cryptoAnnounceMessages.get(guildId);
                if (oldMsgId) {
                    const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
                    if (oldMsg) await oldMsg.delete().catch(() => {});
                }

                const newMsg = await channel.send({ embeds: [embedMarket], components: [row] }).catch(() => null);
                if (newMsg) {
                    cryptoAnnounceMessages.set(guildId, newMsg.id);
                }
            }
        }
    }
}

function updateCryptoPrices() {
    for (const [symbol, coin] of Object.entries(cryptoMarket.coins)) {
        const percentChange = (Math.random() * 0.30) - 0.15;
        let newPrice = Math.round(coin.price * (1 + percentChange));
        if (newPrice < 1000) newPrice = 1000;

        coin.change = Math.round(percentChange * 100);
        coin.price = newPrice;
        coin.history.push(newPrice);
        if (coin.history.length > 10) coin.history.shift();
    }
    saveJSONSync(FILES.CRYPTO, cryptoMarket);
    console.log('📈 [Crypto Engine] Đã cập nhật giá thị trường coin!');
    broadcastCryptoUpdate();
}

function scheduleCryptoMarket() {
    setInterval(updateCryptoPrices, 120000);
}

const getWordSession = (guildId) => {
    if (!wordGameSessions.has(guildId)) {
        const randomWord = START_WORDS[Math.floor(Math.random() * START_WORDS.length)];
        wordGameSessions.set(guildId, {
            currentWord: randomWord,
            lastUserId: null,
            usedWords: new Set([randomWord]),
            timeoutId: null
        });
    }
    return wordGameSessions.get(guildId);
};

const startWordGameTimeout = (guildId, channel) => {
    const session = getWordSession(guildId);
    if (session.timeoutId) clearTimeout(session.timeoutId);

    session.timeoutId = setTimeout(async () => {
        const lastUser = session.lastUserId;
        const PENALTY_TIMEOUT = 10000;

        let penaltyMsg = '';
        if (lastUser) {
            const currentBal = getBalance(lastUser);
            setBalance(lastUser, currentBal - PENALTY_TIMEOUT);
            penaltyMsg = `\n💥 <@${lastUser}> bị phạt **-${formatMoney(PENALTY_TIMEOUT)}** vì để ván đấu bị gián đoạn quá 3 phút!`;
        }

        const newWord = START_WORDS[Math.floor(Math.random() * START_WORDS.length)];
        session.currentWord = newWord;
        session.lastUserId = null;
        session.usedWords = new Set([newWord]);
        session.timeoutId = null;

        await channel.send(`⏳ **Đã quá 3 phút không có ai nối từ!**${penaltyMsg}\n🔄 **Bắt đầu ván mới với từ:** **"${newWord}"**`).catch(() => {});
    }, 180000);
};

const getSession = (guildId) => {
    if (!guildSessions.has(guildId)) {
        const guildCfg = config[guildId] || {};
        const channelId = typeof guildCfg === 'string' ? guildCfg : guildCfg.channelId;
        const savedSessionNumber = typeof guildCfg === 'object' && guildCfg.sessionNumber ? guildCfg.sessionNumber : 1;
        const savedHistory = typeof guildCfg === 'object' && Array.isArray(guildCfg.history) ? guildCfg.history : [];

        guildSessions.set(guildId, {
            isOpen: false,
            channelId: channelId,
            sessionNumber: savedSessionNumber,
            bets: new Map(),
            lastOpenMessage: null,
            history: savedHistory,
            timeoutId: null
        });
    }
    return guildSessions.get(guildId);
};

const saveTaiXiuState = (guildId, session) => {
    if (typeof config[guildId] !== 'object') {
        config[guildId] = {};
    }
    config[guildId].channelId = session.channelId;
    config[guildId].sessionNumber = session.sessionNumber;
    config[guildId].history = session.history;

    saveJSONSync(FILES.CONFIG, config);
};

const getSessionStats = (txSession) => {
    let totalTai = 0, countTai = 0, totalXiu = 0, countXiu = 0;
    for (const bet of txSession.bets.values()) {
        if (bet.choice === 'tai') {
            totalTai += bet.amount;
            countTai++;
        } else {
            totalXiu += bet.amount;
            countXiu++;
        }
    }
    return { totalTai, countTai, totalXiu, countXiu };
};

const renderHistoryBridge = (history) => {
    if (history.length === 0) return '`Chưa có dữ liệu cầu`';
    return history.map(item => {
        if (item === 'tai') return '🔴 T';
        if (item === 'xiu') return '🔵 X';
        return '💥 B';
    }).join(' ➔ ');
};

function generateLotteryResults() {
    const pad = (num, size) => num.toString().padStart(size, '0');
    const specialPrize = pad(Math.floor(Math.random() * 1000000), 6);
    
    const loResults = [];
    for (let i = 0; i < 27; i++) {
        loResults.push(pad(Math.floor(Math.random() * 100), 2));
    }
    loResults[0] = specialPrize.slice(-2);

    return { specialPrize, loResults };
}

async function processLotteryDraw() {
    const result = generateLotteryResults();
    lotteryData.lastResult = result;
    const specialDe = result.specialPrize.slice(-2);

    const ticketWinners = [];
    for (const ticket of lotteryData.tickets) {
        if (ticket.number === result.specialPrize) {
            const PRIZE = 100000000;
            setBalance(ticket.userId, getBalance(ticket.userId) + PRIZE);
            ticketWinners.push(`<@${ticket.userId}> (Số: **${ticket.number}**) -> **+${formatMoney(PRIZE)}**`);
        }
    }

    const lodeWinners = [];
    for (const bet of lotteryData.lodeBets) {
        if (bet.type === 'de') {
            if (bet.number === specialDe) {
                const winAmount = bet.amount * 70;
                setBalance(bet.userId, getBalance(bet.userId) + winAmount);
                lodeWinners.push(`🎯 <@${bet.userId}> trúng **ĐỀ ${bet.number}** -> **+${formatMoney(winAmount)}**`);
            }
        } else if (bet.type === 'lo') {
            const hitCount = result.loResults.filter(num => num === bet.number).length;
            if (hitCount > 0) {
                const winAmount = Math.floor(bet.amount * 3.5 * hitCount);
                setBalance(bet.userId, getBalance(bet.userId) + winAmount);
                lodeWinners.push(`🎲 <@${bet.userId}> trúng **LÔ ${bet.number}** (${hitCount} nháy) -> **+${formatMoney(winAmount)}**`);
            }
        }
    }

    lotteryData.tickets = [];
    lotteryData.lodeBets = [];
    saveJSONSync(FILES.LOTTERY, lotteryData);

    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('🎰 KẾT QUẢ XỔ SỐ & LÔ ĐỀ HÔM NAY (18:00)')
        .addFields(
            { name: '🏆 Giải Đặc Biệt (Vé Số)', value: `🎉 **${result.specialPrize}**`, inline: false },
            { name: '🎯 Số Đề (2 số cuối GĐB)', value: `🔥 **${specialDe}**`, inline: true },
            { name: '🎲 Kết Quả 27 Giải Lô', value: `\`${result.loResults.join(' - ')}\``, inline: false },
            { name: '🎉 Người Trúng Vé Số', value: ticketWinners.length > 0 ? ticketWinners.join('\n') : 'Không có ai trúng vé số.', inline: false },
            { name: '💰 Người Trúng Lô Đề', value: lodeWinners.length > 0 ? lodeWinners.join('\n') : 'Không có ai trúng Lô Đề.', inline: false }
        )
        .setTimestamp();

    for (const [guildId, channelId] of Object.entries(lodeConfig)) {
        if (channelId) {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel) {
                channel.send({ content: '🔔 **ĐÃ ĐẾN GIỜ QUAY THƯỞNG XỔ SỐ THƯỜNG NIÊN (18:00)!**', embeds: [embed] }).catch(() => {});
            }
        }
    }
}

function scheduleDailyLottery() {
    const checkTime = () => {
        const now = new Date();
        if (now.getHours() === 18 && now.getMinutes() === 0) {
            processLotteryDraw();
        }
    };
    setInterval(checkTime, 60000);
}

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const createDeck = () => {
    const deck = [];
    for (let i = 0; i < SUITS.length; i++) {
        for (let j = 0; j < VALUES.length; j++) {
            deck.push({ suit: SUITS[i], value: VALUES[j] });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
};

const calculateHand = (hand) => {
    let score = 0, aces = 0;
    for (const card of hand) {
        if (card.value === 'A') {
            aces += 1;
            score += 11;
        } else if (['J', 'Q', 'K'].includes(card.value)) {
            score += 10;
        } else {
            score += parseInt(card.value, 10);
        }
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
    }
    return score;
};

const formatHand = (hand, hideSecond = false) => {
    if (hideSecond) return `${hand[0].value}${hand[0].suit} 🂠`;
    return hand.map(c => `${c.value}${c.suit}`).join(' ');
};

async function updateOpenEmbed(txSession) {
    if (!txSession.lastOpenMessage) return;
    const { totalTai, countTai, totalXiu, countXiu } = getSessionStats(txSession);
    const bridgeText = renderHistoryBridge(txSession.history);

    const embedOpen = new EmbedBuilder()
        .setColor('Gold')
        .setTitle(`🎲 PHIÊN TÀI XỈU #${txSession.sessionNumber}`)
        .setDescription(`⏱️ Thời gian đặt cược: **40 giây**.\n📊 **SOI CẦU (10 phiên gần nhất):**\n${bridgeText}\n\n👇 **Bấm nút bên dưới để cược!**`)
        .addFields(
            { name: '🔴 CỬA TÀI', value: `💰 **${formatMoney(totalTai)}**\n👥 **${countTai}** người`, inline: true },
            { name: '🔵 CỬA XỈU', value: `💰 **${formatMoney(totalXiu)}**\n👥 **${countXiu}** người`, inline: true }
        )
        .setTimestamp();

    await txSession.lastOpenMessage.edit({ embeds: [embedOpen] }).catch(() => {});
}

async function startTaiXiuLoop(guildId, channelId) {
    const txSession = getSession(guildId);
    txSession.channelId = channelId;
    
    if (txSession.timeoutId) clearTimeout(txSession.timeoutId);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const runSession = async () => {
        txSession.isOpen = true;
        txSession.bets.clear();

        const bridgeText = renderHistoryBridge(txSession.history);

        const embedOpen = new EmbedBuilder()
            .setColor('Gold')
            .setTitle(`🎲 PHIÊN TÀI XỈU #${txSession.sessionNumber}`)
            .setDescription(`⏱️ Thời gian đặt cược: **40 giây**.\n📊 **SOI CẦU (10 phiên gần nhất):**\n${bridgeText}\n\n👇 **Bấm nút bên dưới để cược!**`)
            .addFields(
                { name: '🔴 CỬA TÀI', value: '💰 **0đ**\n👥 **0** người', inline: true },
                { name: '🔵 CỬA XỈU', value: '💰 **0đ**\n👥 **0** người', inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bet_tai').setLabel('🔴 CƯỢC TÀI').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('bet_xiu').setLabel('🔵 CƯỢC XỈU').setStyle(ButtonStyle.Primary)
        );

        const openMsg = await channel.send({ embeds: [embedOpen], components: [row] }).catch(() => null);
        if (openMsg) txSession.lastOpenMessage = openMsg;

        await new Promise(res => setTimeout(res, 40000));
        txSession.isOpen = false;

        if (txSession.lastOpenMessage) {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bet_tai').setLabel('ĐÃ HẾT GIỜ').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('bet_xiu').setLabel('ĐÃ HẾT GIỜ').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            await txSession.lastOpenMessage.edit({ components: [disabledRow] }).catch(() => {});
        }

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const d3 = Math.floor(Math.random() * 6) + 1;
        const sum = d1 + d2 + d3;
        const res = (d1 === d2 && d2 === d3) ? 'bao' : (sum >= 11 ? 'tai' : 'xiu');

        txSession.history.push(res);
        if (txSession.history.length > 10) txSession.history.shift();

        const { totalTai, totalXiu } = getSessionStats(txSession);
        let resultText = `🎲 Kết quả: **${d1} - ${d2} - ${d3}** (Tổng: **${sum}** - **${res === 'bao' ? 'BÃO' : res.toUpperCase()}**)\n`;
        resultText += `📊 Tổng cược: 🔴 **${formatMoney(totalTai)}** | 🔵 **${formatMoney(totalXiu)}**\n\n`;

        if (txSession.bets.size === 0) {
            resultText += '😢 Không có ai tham gia cược!';
        } else {
            for (const [userId, betData] of txSession.bets.entries()) {
                let bal = getBalance(userId);
                if (res === 'bao') {
                    setBalance(userId, bal - betData.amount);
                    resultText += `❌ <@${userId}> cược ${betData.choice.toUpperCase()} (${formatMoney(betData.amount)}) gặp BÃO!\n`;
                } else if (res === betData.choice) {
                    setBalance(userId, bal + betData.amount);
                    resultText += `🎉 <@${userId}> thắng **+${formatMoney(betData.amount)}** (${betData.choice.toUpperCase()})\n`;
                } else {
                    setBalance(userId, bal - betData.amount);
                    resultText += `😢 <@${userId}> thua **-${formatMoney(betData.amount)}** (${betData.choice.toUpperCase()})\n`;
                }
            }
        }

        const embedResult = new EmbedBuilder()
            .setColor(res === 'tai' ? 'Green' : res === 'xiu' ? 'Blue' : 'Red')
            .setTitle(`🎲 KẾT QUẢ PHIÊN #${txSession.sessionNumber}`)
            .setDescription(resultText)
            .setTimestamp();

        await channel.send({ embeds: [embedResult] }).catch(() => null);

        txSession.sessionNumber++;
        saveTaiXiuState(guildId, txSession);

        txSession.timeoutId = setTimeout(runSession, 10000);
    };

    runSession();
}

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập: ${client.user.tag}`);
    for (const [guildId, guildData] of Object.entries(config)) {
        const channelId = typeof guildData === 'string' ? guildData : guildData?.channelId;
        if (channelId) startTaiXiuLoop(guildId, channelId);
    }
    scheduleDailyLottery();
    scheduleCryptoMarket();
});

// ==========================================
// 3. XỬ LÝ SỰ KIỆN TƯƠNG TÁC (NÚT BẤM & MODAL)
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;

    try {
        const { guildId, channelId, user } = interaction;
        const txSession = getSession(guildId);
        const targetChannelId = txSession.channelId;

        // Xử lý nút Tài Xỉu
        if (interaction.isButton() && ['bet_tai', 'bet_xiu'].includes(interaction.customId)) {
            if (channelId !== targetChannelId) {
                return interaction.reply({ content: '❌ Nút chỉ dùng trong kênh cược!', ephemeral: true });
            }
            if (!txSession.isOpen) {
                return interaction.reply({ content: '⏳ Hết thời gian đặt cược!', ephemeral: true });
            }

            const choice = interaction.customId === 'bet_tai' ? 'tai' : 'xiu';
            const modal = new ModalBuilder()
                .setCustomId(`modal_${choice}`)
                .setTitle(`ĐẶT CƯỢC ${choice.toUpperCase()}`);

            const amountInput = new TextInputBuilder()
                .setCustomId('bet_amount')
                .setLabel('Nhập số tiền cược (VNĐ):')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('VD: 50000')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
            if (interaction.customId === 'modal_tai' || interaction.customId === 'modal_xiu') {
                const choice = interaction.customId === 'modal_tai' ? 'tai' : 'xiu';
                const bet = parseInt(interaction.fields.getTextInputValue('bet_amount'), 10);

                if (isNaN(bet) || bet <= 0) {
                    return interaction.reply({ content: '❌ Số tiền không hợp lệ!', ephemeral: true });
                }

                const bal = getBalance(user.id);
                if (bet > bal) {
                    return interaction.reply({ content: `❌ Số dư không đủ! Hiện có: **${formatMoney(bal)}**.`, ephemeral: true });
                }

                txSession.bets.set(user.id, { choice, amount: bet });
                await updateOpenEmbed(txSession);

                return interaction.reply({ content: `✅ Đã cược **${formatMoney(bet)}** vào **${choice.toUpperCase()}**!`, ephemeral: true });
            }

            // Xử lý modal nhập số lượng Mua/Bán Coin trực tiếp qua nút
            if (interaction.customId.startsWith('modal_c_buy_') || interaction.customId.startsWith('modal_c_sell_')) {
                const isBuy = interaction.customId.includes('c_buy_');
                const symbol = interaction.customId.split('_').pop();
                const amount = parseInt(interaction.fields.getTextInputValue('crypto_amount'), 10);

                if (isNaN(amount) || amount <= 0) {
                    return interaction.reply({ content: '❌ Số lượng không hợp lệ!', ephemeral: true });
                }

                const coin = cryptoMarket.coins[symbol];
                if (!coin) return interaction.reply({ content: '❌ Mã coin không tồn tại!', ephemeral: true });

                if (isBuy) {
                    const totalPrice = coin.price * amount;
                    const userBal = getBalance(user.id);
                    if (userBal < totalPrice) {
                        return interaction.reply({ content: `❌ Không đủ tiền! Cần **${formatMoney(totalPrice)}**, ví có **${formatMoney(userBal)}**.`, ephemeral: true });
                    }
                    setBalance(user.id, userBal - totalPrice);
                    const portfolio = getUserPortfolio(user.id);
                    portfolio[symbol] = (portfolio[symbol] || 0) + amount;
                    setUserPortfolio(user.id, portfolio);

                    return interaction.reply({ content: `✅ Mua thành công **${amount} ${symbol}** với giá **${formatMoney(totalPrice)}**!`, ephemeral: true });
                } else {
                    const portfolio = getUserPortfolio(user.id);
                    const userOwned = portfolio[symbol] || 0;
                    if (userOwned < amount) {
                        return interaction.reply({ content: `❌ Bạn chỉ sở hữu **${userOwned} ${symbol}**, không đủ để bán!`, ephemeral: true });
                    }
                    const totalReceive = coin.price * amount;
                    portfolio[symbol] -= amount;
                    if (portfolio[symbol] <= 0) delete portfolio[symbol];
                    setUserPortfolio(user.id, portfolio);
                    setBalance(user.id, getBalance(user.id) + totalReceive);

                    return interaction.reply({ content: `✅ Bán thành công **${amount} ${symbol}**, nhận về **+${formatMoney(totalReceive)}**!`, ephemeral: true });
                }
            }
        }

        // Xử lý các nút bấm Giao dịch Crypto trực tiếp từ Bảng tin hoặc Lệnh
        if (interaction.isButton()) {
            const customId = interaction.customId;

            // Nút xem Ví
            if (customId === 'c_portfolio') {
                const portfolio = getUserPortfolio(user.id);
                const ownedKeys = Object.keys(portfolio);
                if (ownedKeys.length === 0) {
                    return interaction.reply({ content: '💼 Danh mục đầu tư của bạn đang trống.', ephemeral: true });
                }
                let desc = '';
                let totalValue = 0;
                for (const symbol of ownedKeys) {
                    const count = portfolio[symbol];
                    const coin = cryptoMarket.coins[symbol];
                    if (coin) {
                        const val = count * coin.price;
                        totalValue += val;
                        desc += `• **${coin.name} (${symbol})**: ${count} coin | Giá trị: **${formatMoney(val)}**\n`;
                    }
                }
                const embed = new EmbedBuilder()
                    .setColor('Aqua')
                    .setTitle(`💼 DANH MỤC ĐẦU TƯ - ${user.username}`)
                    .setDescription(desc)
                    .addFields({ name: '📊 Tổng tài sản', value: `**${formatMoney(totalValue)}**`, inline: false });
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Nút Xem Biểu Đồ
            if (customId.startsWith('c_chart_')) {
                const symbol = customId.split('_').pop();
                const coin = cryptoMarket.coins[symbol];
                if (!coin) return interaction.reply({ content: '❌ Không tìm thấy mã coin!', ephemeral: true });

                const chartUrl = getCryptoChartUrl(symbol, coin);
                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle(`📈 BIỂU ĐỒ GIÁ - ${coin.name} (${symbol})`)
                    .setDescription(`Giá hiện tại: **${formatMoney(coin.price)}** | Biến động: **${coin.change > 0 ? '+' : ''}${coin.change}%**`)
                    .setImage(chartUrl);

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Nút Mua / Bán mở Modal nhập số lượng tương ứng
            if (customId.startsWith('c_buy_') || customId.startsWith('c_sell_')) {
                const isBuy = customId.startsWith('c_buy_');
                const symbol = customId.split('_').pop();
                const coin = cryptoMarket.coins[symbol];
                if (!coin) return interaction.reply({ content: '❌ Mã coin không tồn tại!', ephemeral: true });

                const modal = new ModalBuilder()
                    .setCustomId(`modal_${customId}`)
                    .setTitle(`${isBuy ? 'MUA' : 'BÁN'} ${symbol} (Giá: ${formatMoney(coin.price)})`);

                const amountInput = new TextInputBuilder()
                    .setCustomId('crypto_amount')
                    .setLabel('Nhập số lượng muốn giao dịch:')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('VD: 2')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
                return interaction.showModal(modal);
            }
        }

        // Xử lý nút Blackjack
        if (interaction.isButton() && ['bj_hit', 'bj_stand'].includes(interaction.customId)) {
            const gameKey = `${guildId}_${user.id}`;
            const game = bjGames.get(gameKey);

            if (!game) return interaction.reply({ content: '❌ Ván đấu đã kết thúc!', ephemeral: true });

            if (interaction.customId === 'bj_hit') {
                game.playerHand.push(game.deck.pop());
                const playerScore = calculateHand(game.playerHand);

                if (playerScore > 21 || game.playerHand.length === 5) {
                    return finishBlackjackGame(interaction, gameKey, game);
                }

                const embed = new EmbedBuilder()
                    .setColor('DarkGreen')
                    .setTitle(`🃏 BLACKJACK - ${user.username}`)
                    .addFields(
                        { name: '🤖 Nhà Cái', value: `${formatHand(game.dealerHand, true)} (?? điểm)` },
                        { name: '👤 Bạn', value: `${formatHand(game.playerHand)} (${playerScore} điểm)` }
                    )
                    .setFooter({ text: `Tiền cược: ${formatMoney(game.bet)}` });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('bj_hit').setLabel('🃏 RÚT (HIT)').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('bj_stand').setLabel('🛑 DẰN (STAND)').setStyle(ButtonStyle.Danger)
                );

                return interaction.update({ embeds: [embed], components: [row] });
            }

            if (interaction.customId === 'bj_stand') {
                return finishBlackjackGame(interaction, gameKey, game);
            }
        }
    } catch (err) {
        console.error('[Interaction Error]:', err);
    }
});

async function finishBlackjackGame(interaction, gameKey, game) {
    const { user, bet, deck, playerHand, dealerHand, timeout } = game;
    if (timeout) clearTimeout(timeout);

    let playerScore = calculateHand(playerHand);

    if (playerScore <= 21) {
        while (calculateHand(dealerHand) < 17) {
            dealerHand.push(deck.pop());
        }
    }

    let dealerScore = calculateHand(dealerHand);
    let resultMessage = '';
    let winAmount = 0;
    let currentBal = getBalance(user.id);

    const isPlayerBJ = playerHand.length === 2 && playerScore === 21;
    const isDealerBJ = dealerHand.length === 2 && dealerScore === 21;
    const isXiBan = playerHand.length === 2 && playerHand[0].value === 'A' && playerHand[1].value === 'A';
    const isNguLinh = playerHand.length === 5 && playerScore <= 21;

    if (playerScore > 21) {
        resultMessage = `💥 **Bạn đã QUẮC (${playerScore} điểm)!** Bị trừ **-${formatMoney(bet)}**.`;
        setBalance(user.id, currentBal - bet);
    } else if (isXiBan) {
        winAmount = Math.floor(bet * 2);
        resultMessage = `🔥 **XÌ BÀN!** Nhận thưởng lớn **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (isPlayerBJ && !isDealerBJ) {
        winAmount = Math.floor(bet * 1.5);
        resultMessage = `🏆 **BLACKJACK!** Bạn nhận **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (isNguLinh) {
        winAmount = Math.floor(bet * 2);
        resultMessage = `🌟 **NGŨ LINH!** Bạn thắng **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (dealerScore > 21) {
        winAmount = bet;
        resultMessage = `🎉 **Nhà cái QUẮC (${dealerScore} điểm)!** Bạn thắng **+${formatMoney(winAmount)}**.`;
        setBalance(user.id, currentBal + winAmount);
    } else if (playerScore > dealerScore) {
        winAmount = bet;
        resultMessage = `🎉 **Thắng trận!** (${playerScore} vs ${dealerScore}). Nhận **+${formatMoney(winAmount)}**.`;
        setBalance(user.id, currentBal + winAmount);
    } else if (playerScore < dealerScore) {
        resultMessage = `😭 **Nhà cái thắng!** (${dealerScore} vs ${playerScore}). Mất **-${formatMoney(bet)}**.`;
        setBalance(user.id, currentBal - bet);
    } else {
        resultMessage = `🤝 **HÒA!** Bằng điểm (${playerScore}). Hoàn lại tiền.`;
    }

    bjGames.delete(gameKey);

    const embed = new EmbedBuilder()
        .setColor(winAmount > 0 ? 'Green' : (resultMessage.includes('HÒA') ? 'Yellow' : 'Red'))
        .setTitle(`🃏 KẾT QUẢ BLACKJACK - ${user.username}`)
        .setDescription(resultMessage)
        .addFields(
            { name: '🤖 Nhà Cái', value: `${formatHand(dealerHand)} (${dealerScore} điểm)` },
            { name: '👤 Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
        )
        .setFooter({ text: `Ví hiện tại: ${formatMoney(getBalance(user.id))}` });

    return interaction.update({ embeds: [embed], components: [] }).catch(() => {});
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const guildId = message.guild.id;
    const userId = message.author.id;

    if (wordConfig[guildId] && message.channel.id === wordConfig[guildId]) {
        if (message.content.startsWith(PREFIX)) {
            const args = message.content.slice(PREFIX.length).trim().split(/ +/);
            const cmd = args.shift().toLowerCase();
            if (cmd === 'noitu' && args[0] === 'reset') {
                const session = getWordSession(guildId);
                if (session.timeoutId) clearTimeout(session.timeoutId);

                const newWord = START_WORDS[Math.floor(Math.random() * START_WORDS.length)];
                wordGameSessions.set(guildId, {
                    currentWord: newWord,
                    lastUserId: null,
                    usedWords: new Set([newWord]),
                    timeoutId: null
                });
                startWordGameTimeout(guildId, message.channel);
                return message.reply(`🔄 Đã reset game Nối Từ! Từ bắt đầu: **"${newWord}"**`);
            }
        }

        const inputWord = message.content.trim().toLowerCase();
        const wordParts = inputWord.split(/\s+/);
        const PENALTY_ERR = 2000;

        if (wordParts.length !== 2) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`❌ Từ **"${inputWord}"** không phải là từ ghép 2 tiếng! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('❌');
        }

        const wordSession = getWordSession(guildId);
        const lastWordParts = wordSession.currentWord.split(/\s+/);
        const requiredStartWord = lastWordParts[lastWordParts.length - 1];

        if (wordSession.lastUserId === userId) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`⚠️ Bạn phải đợi người khác nối tiếp! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('❌');
        }

        if (wordParts[0] !== requiredStartWord) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`❌ Phải bắt đầu bằng từ **"${requiredStartWord}"**! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('❌');
        }

        if (wordSession.usedWords.has(inputWord)) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`❌ Từ **"${inputWord}"** đã dùng trước đó! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('❌');
        }

        const isExistInDict = await checkVietnameseWordOnline(inputWord);
        if (!isExistInDict) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`❌ Từ **"${inputWord}"** không có trong từ điển! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('❌');
        }

        wordSession.currentWord = inputWord;
        wordSession.lastUserId = userId;
        wordSession.usedWords.add(inputWord);

        const REWARD = 5000;
        setBalance(userId, getBalance(userId) + REWARD);

        await message.react('✅');
        startWordGameTimeout(guildId, message.channel);
        return;
    }

    if (!message.content.startsWith(PREFIX)) return;

    try {
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // 📈 LỆNH COIN: TÍCH HỢP NÚT BẤM TRỰC TIẾP
        if (['coin', 'crypto', 'chungkhoan'].includes(command)) {
            const subCmd = args[0]?.toLowerCase();

            if (subCmd === 'chart' || subCmd === 'bieudo') {
                const symbol = args[1]?.toUpperCase();
                if (!symbol || !cryptoMarket.coins[symbol]) {
                    return message.reply('❌ Cú pháp xem biểu đồ: `!coin chart <MÃ_COIN>`\n*(VD: `!coin chart BTC`)*');
                }

                const coin = cryptoMarket.coins[symbol];
                const chartUrl = getCryptoChartUrl(symbol, coin);
                const row = getCryptoButtonsRow(symbol);

                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle(`📈 BIỂU ĐỒ GIÁ TRỰC QUYẾN - ${coin.name} (${symbol})`)
                    .setDescription(`Giá hiện tại: **${formatMoney(coin.price)}** | Biến động: **${coin.change > 0 ? '+' : ''}${coin.change}%**`)
                    .setImage(chartUrl);

                return message.reply({ embeds: [embed], components: [row] });
            }

            if (subCmd === 'vi' || subCmd === 'portfolio') {
                const portfolio = getUserPortfolio(userId);
                const ownedKeys = Object.keys(portfolio);

                if (ownedKeys.length === 0) {
                    return message.reply('💼 Danh mục đầu tư của bạn đang trống. Hãy dùng nút bên dưới hoặc lệnh `!coin` để mua!');
                }

                let desc = '';
                let totalValue = 0;

                for (const symbol of ownedKeys) {
                    const count = portfolio[symbol];
                    const coin = cryptoMarket.coins[symbol];
                    if (coin) {
                        const val = count * coin.price;
                        totalValue += val;
                        desc += `• **${coin.name} (${symbol})**: ${count} coin | Giá trị: **${formatMoney(val)}**\n`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('Aqua')
                    .setTitle(`💼 DANH MỤC ĐẦU TƯ - ${message.author.username}`)
                    .setDescription(desc)
                    .addFields({ name: '📊 Tổng giá trị tài sản Coin', value: `**${formatMoney(totalValue)}**`, inline: false });

                return message.reply({ embeds: [embed] });
            }

            // GỬI BẢNG GIÁ KÈM NÚT BẤM GIAO DỊCH NHANH CHO BTC, ETH, JNG
            let marketText = '';
            for (const [symbol, coin] of Object.entries(cryptoMarket.coins)) {
                const trendEmoji = coin.change > 0 ? '🟢 ▲' : (coin.change < 0 ? '🔴 ▼' : '🟡 ➖');
                const sign = coin.change > 0 ? '+' : '';
                marketText += `${trendEmoji} **${coin.name} (${symbol})**: **${formatMoney(coin.price)}** (${sign}${coin.change}%)\n`;
            }

            const embedMarket = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle('📊 THỊ TRƯỜNG CHỨNG KHOÁN & COIN ÁO (TƯƠNG TÁC NHANH)')
                .setDescription(`*Chọn các nút bên dưới để Mua, Bán hoặc xem Biểu đồ trực tiếp.*\n\n${marketText}`);

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('c_buy_BTC').setLabel('🛒 Mua BTC').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('c_sell_BTC').setLabel('💰 Bán BTC').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('c_chart_BTC').setLabel('📈 Biểu đồ BTC').setStyle(ButtonStyle.Primary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('c_buy_ETH').setLabel('🛒 Mua ETH').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('c_sell_ETH').setLabel('💰 Bán ETH').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('c_chart_ETH').setLabel('📈 Biểu đồ ETH').setStyle(ButtonStyle.Primary)
            );

            const row3 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('c_buy_JNG').setLabel('🛒 Mua JNG').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('c_sell_JNG').setLabel('💰 Bán JNG').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('c_chart_JNG').setLabel('📈 Biểu đồ JNG').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('c_portfolio').setLabel('💼 Xem Ví').setStyle(ButtonStyle.Secondary)
            );

            return message.reply({ embeds: [embedMarket], components: [row1, row2, row3] });
        }

        if (command === 'setcoin') {
            if (!isBotStaff(userId) && !message.member.permissions.has('Administrator')) return message.reply('❌ Bạn không có quyền cấu hình kênh!');
            const targetChannel = message.mentions.channels.first() || message.channel;

            if (typeof config[guildId] !== 'object') config[guildId] = {};
            config[guildId].cryptoChannelId = targetChannel.id;
            saveJSONSync(FILES.CONFIG, config);

            return message.reply(`✅ Đã thiết lập kênh thông báo biến động Crypto tự động tại ${targetChannel}.\n*(Bản tin sẽ đi kèm đầy đủ nút Mua/Bán/Biểu đồ và tự động xóa tin nhắn cũ!)*`);
        }

        // Lệnh Vay tiền, Trả nợ, Game khác giữ nguyên như bản trước...
        if (command === 'vay' || command === 'vaytien') {
            const amount = parseInt(args[0], 10);
            const currentDebt = getLoan(userId);

            if (isNaN(amount) || amount <= 0) {
                const embed = new EmbedBuilder()
                    .setColor('Yellow')
                    .setTitle('🏦 NGÂN HÀNG DISCORD - THÔNG TIN VAY')
                    .setDescription(`• Lãi suất cố định: **${LOAN_INTEREST_RATE * 100}%**\n• Hạn ngạch tối đa: **${formatMoney(MAX_LOAN_LIMIT)}**\n• Nợ hiện tại của bạn: **${formatMoney(currentDebt)}**`);
                return message.reply({ embeds: [embed] });
            }

            if (currentDebt > 0) return message.reply(`❌ Hãy trả hết khoản nợ cũ **${formatMoney(currentDebt)}** trước.`);
            if (amount > MAX_LOAN_LIMIT) return message.reply(`❌ Vượt quá hạn ngạch tối đa **${formatMoney(MAX_LOAN_LIMIT)}**.`);

            const totalDebtWithInterest = Math.floor(amount * (1 + LOAN_INTEREST_RATE));
            setLoan(userId, totalDebtWithInterest);
            setBalance(userId, getBalance(userId) + amount);

            return message.reply(`✅ Vay thành công **+${formatMoney(amount)}**. Tổng nợ cần trả: **${formatMoney(totalDebtWithInterest)}**.`);
        }

        if (command === 'trano' || command === 'payloan') {
            const currentDebt = getLoan(userId);
            if (currentDebt <= 0) return message.reply('🎉 Bạn không có khoản nợ nào!');

            let payAmount = parseInt(args[0], 10);
            if (args[0]?.toLowerCase() === 'all') payAmount = currentDebt;

            if (isNaN(payAmount) || payAmount <= 0) return message.reply(`❌ Cú pháp: \`!trano <số_tiền|all>\`. Nợ hiện tại: **${formatMoney(currentDebt)}**`);

            const bal = getBalance(userId);
            if (bal < payAmount) return message.reply(`❌ Số dư ví không đủ!`);

            const actualPayment = Math.min(payAmount, currentDebt);
            setBalance(userId, bal - actualPayment);
            setLoan(userId, currentDebt - actualPayment);

            return message.reply(`💳 Đã trả **-${formatMoney(actualPayment)}** tiền nợ. Nợ còn lại: **${formatMoney(currentDebt - actualPayment)}**.`);
        }

        if (command === 'exportdata') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ Owner!');
            const attachments = [];
            for (const filePath of Object.values(FILES)) {
                if (fs.existsSync(filePath)) attachments.push(new AttachmentBuilder(filePath));
            }
            await message.author.send({ content: '📦 **Backup dữ liệu:**', files: attachments }).catch(() => null);
            return message.reply('✅ Đã gửi file backup vào tin nhắn riêng!');
        }

        if (command === 'cong') {
            if (!isBotStaff(userId)) return message.reply('❌ Không có quyền!');
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);
            if (!targetUser || isNaN(amount)) return message.reply('❌ Sai cú pháp!');
            setBalance(targetUser.id, getBalance(targetUser.id) + amount);
            return message.reply(`✅ Đã cộng tiền cho ${targetUser}!`);
        }

        if (command === 'settaixiu') {
            if (!isBotStaff(userId)) return message.reply('❌ Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            const txSession = getSession(guildId);
            txSession.channelId = targetChannel.id;
            saveTaiXiuState(guildId, txSession);
            await message.reply(`✅ Đã thiết lập kênh Tài Xỉu tại ${targetChannel}.`);
            startTaiXiuLoop(guildId, targetChannel.id);
            return;
        }

        if (command === 'setlode') {
            if (!isBotStaff(userId)) return message.reply('❌ Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            lodeConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.LODE_CONFIG, lodeConfig);
            return message.reply(`✅ Đã thiết lập kênh Lô Đề tại ${targetChannel}.`);
        }

        if (command === 'setnoitu') {
            if (!isBotStaff(userId)) return message.reply('❌ Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            wordConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.WORD_CONFIG, wordConfig);
            startWordGameTimeout(guildId, targetChannel);
            return message.reply(`✅ Đã thiết lập kênh Nối Từ tại ${targetChannel}.`);
        }

        if (command === 'blackjack' || command === 'bj') {
            const gameKey = `${guildId}_${userId}`;
            if (bjGames.has(gameKey)) return message.reply('❌ Bạn đang trong ván đấu khác!');

            const bet = parseInt(args[0], 10);
            if (isNaN(bet) || bet <= 0) return message.reply('❌ Cú pháp: `!bj <số_tiền>`');

            const bal = getBalance(userId);
            if (bet > bal) return message.reply(`❌ Số dư không đủ!`);

            const deck = createDeck();
            const playerHand = [deck.pop(), deck.pop()];
            const dealerHand = [deck.pop(), deck.pop()];

            const timeout = setTimeout(() => bjGames.delete(gameKey), 180000);
            bjGames.set(gameKey, { user: message.author, bet, deck, playerHand, dealerHand, timeout });

            const playerScore = calculateHand(playerHand);
            const embed = new EmbedBuilder()
                .setColor('DarkGreen')
                .setTitle(`🃏 BLACKJACK - ${message.author.username}`)
                .addFields(
                    { name: '🤖 Nhà Cái', value: `${formatHand(dealerHand, true)} (?? điểm)` },
                    { name: '👤 Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bj_hit').setLabel('🃏 RÚT').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('bj_stand').setLabel('🛑 DẰN').setStyle(ButtonStyle.Danger)
            );

            return message.reply({ embeds: [embed], components: [row] });
        }

        if (command === 'hlp' || command === 'giupde') {
            const embed = new EmbedBuilder()
                .setColor('Random')
                .setTitle('📖 BẢNG HƯỚNG DẪN LỆNH BOT')
                .addFields(
                    { name: '📈 Chứng Khoán & Crypto', value: '• `!coin`: Xem bảng giá kèm các nút bấm tương tác (Mua, Bán, Biểu đồ trực tiếp)\n• `!coin chart <MÃ>`: Xem biểu đồ\n• `!coin vi`: Xem danh mục đầu tư', inline: false },
                    { name: '⚙️ Cấu Hình', value: '• `!setcoin`: Kênh tự động báo giá coin (kèm nút bấm & tự xóa tin cũ)', inline: false }
                );
            return message.reply({ embeds: [embed] });
        }

        if (command === 'profile' || command === 'pf') {
            const targetUser = message.mentions.users.first() || message.author;
            const bal = getBalance(targetUser.id);
            const loan = getLoan(targetUser.id);
            const embed = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle(`🪪 HỒ SƠ - ${targetUser.username}`)
                .addFields(
                    { name: '💰 Số dư', value: `**${formatMoney(bal)}**`, inline: true },
                    { name: '💳 Tiền nợ', value: `**${formatMoney(loan)}**`, inline: true }
                );
            return message.reply({ embeds: [embed] });
        }

        if (command === 'balance' || command === 'sodu') {
            return message.reply(`💰 Số dư của bạn: **${formatMoney(getBalance(userId))}**`);
        }

        if (command === 'daily') {
            const now = Date.now();
            if (now - (dailyCooldown.get(userId) || 0) < 86400000) return message.reply('⏰ Đã điểm danh hôm nay rồi!');
            setBalance(userId, getBalance(userId) + 100000);
            dailyCooldown.set(userId, now);
            return message.reply(`🎁 Điểm danh nhận **+100.000đ**!`);
        }

        if (command === 'top' || command === 'bxh') {
            const sorted = Array.from(balances.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
            let desc = sorted.map(([id, bal], i) => `🪙 **Top ${i + 1}**: <@${id}> - **${formatMoney(bal)}**`).join('\n');
            const embed = new EmbedBuilder().setTitle('🏆 BẢNG XẾP HẠNG ĐẠI GIA').setDescription(desc || 'Chưa có dữ liệu.').setColor('Gold');
            return message.reply({ embeds: [embed] });
        }

    } catch (err) {
        console.error('[Message Error]:', err);
    }
});

client.login(TOKEN);
