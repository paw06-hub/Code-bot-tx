const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ChannelType, PermissionFlagsBits
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
    res.send('Bot Discord đang hoạt động!');
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// CONFIGURATION
const PREFIX = '!';
const TOKEN = process.env.TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = process.env.ADMIN_ID || '1298727049451540541'; 

const FILES = {
    BALANCES: './balances.json',
    TITLES: './titles.json',
    CONFIG: './config.json',           
    WORD_CONFIG: './word_config.json', 
    LODE_CONFIG: './lode_config.json', 
    LOTTERY: './lottery.json',         
    STAFFS: './staffs.json',           
    ADMINS: './admins.json',           
    LOANS: './loans.json',             
    CRYPTO: './crypto.json',           
    PORTFOLIO: './portfolio.json',
    HOTELS: './hotels.json'            // Thêm file dữ liệu Khách sạn
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
let adminList = loadJSON(FILES.ADMINS, false);
let loans = loadJSON(FILES.LOANS);
let cryptoMarket = loadJSON(FILES.CRYPTO, false);
let portfolios = loadJSON(FILES.PORTFOLIO);
let hotelData = loadJSON(FILES.HOTELS, false); // Quản lý phòng khách sạn đang thuê

if (!lotteryData.tickets) lotteryData.tickets = [];
if (!lotteryData.lodeBets) lotteryData.lodeBets = [];
if (!lotteryData.lastResult) lotteryData.lastResult = null;
if (!Array.isArray(staffList.users)) staffList.users = [];
if (!Array.isArray(adminList.users)) adminList.users = [];
if (!hotelData.rooms) hotelData.rooms = {}; // Cấu trúc: { channelId: { ownerId, type, price, guildId } }

if (!cryptoMarket.coins) {
    cryptoMarket.coins = {
        'BTC': { name: 'Bitcoin', price: 100000, history: [100000], change: 0 },
        'ETH': { name: 'Ethereum', price: 50000, history: [50000], change: 0 },
        'COIN': { name: 'Custom Coin', price: 10000, history: [10000], change: 0 }
    };
    saveJSONSync(FILES.CRYPTO, cryptoMarket);
}

const cryptoAnnounceMessages = new Map();
const dailyCooldown = new Map();
const guildSessions = new Map();
const bjGames = new Map();
const wordGameSessions = new Map();
const dictionaryCache = new Map();

const isBotOwner = (userId) => userId === ADMIN_ID || adminList.users.includes(userId);
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

// CẤU HÌNH VAY NGÂN HÀNG (1 TỶ)
const LOAN_INTEREST_RATE = 0.30;
const MAX_LOAN_LIMIT = 1000000000;

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

const getCrypto4ButtonsRow = () => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('c_menu_buy').setLabel('🛒 Mua Coin').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('c_menu_sell').setLabel('💰 Bán Coin').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('c_menu_chart').setLabel('📈 Xem Biểu Đồ').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('c_portfolio').setLabel('💼 Xem Ví').setStyle(ButtonStyle.Secondary)
    );
};

const getCoinSelectMenu = (actionType) => {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_coin_${actionType}`)
            .setPlaceholder('👉 Chọn đồng coin bạn muốn thao tác...')
            .addOptions([
                new StringSelectMenuOptionBuilder().setLabel('Bitcoin (BTC)').setDescription('Giá: ' + formatMoney(cryptoMarket.coins['BTC'].price)).setValue('BTC').setEmoji('🪙'),
                new StringSelectMenuOptionBuilder().setLabel('Ethereum (ETH)').setDescription('Giá: ' + formatMoney(cryptoMarket.coins['ETH'].price)).setValue('ETH').setEmoji('🪙'),
                new StringSelectMenuOptionBuilder().setLabel('Custom Coin (COIN)').setDescription('Giá: ' + formatMoney(cryptoMarket.coins['COIN'].price)).setValue('COIN').setEmoji('🚀')
            ])
    );
};

async function broadcastCryptoUpdate() {
    let marketText = '';
    for (const [symbol, coin] of Object.entries(cryptoMarket.coins)) {
        const trendEmoji = coin.change > 0 ? '<:stonks:1554601546820493472> ▲' : (coin.change < 0 ? '<:notstonks:1554601468810756266> ▼' : '🟡 ➖');
        const sign = coin.change > 0 ? '+' : '';
        marketText += `${trendEmoji} **${coin.name} (${symbol})**: **${formatMoney(coin.price)}** (${sign}${coin.change}%)\n`;
    }

    const embedMarket = new EmbedBuilder()
        .setColor('Blurple')
        .setTitle('📊 BẢN TIN THỊ TRƯỜNG COIN & CHỨNG KHOÁN (TỰ ĐỘNG)')
        .setDescription(`*Giá thị trường vừa được cập nhật! Tự động làm mới sau mỗi 2 phút.*\n\n${marketText}`)
        .setTimestamp();

    const row = getCrypto4ButtonsRow();

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
    broadcastCryptoUpdate();
}

function scheduleCryptoMarket() {
    setInterval(updateCryptoPrices, 120000);
}

// ==========================================
// HỆ THỐNG THUÊ PHÒNG KHÁCH SẠN & TỰ ĐỘNG THU THUẾ
// ==========================================
const HOTEL_PRICES = {
    vip: { name: 'Phòng VIP', price: 1500000, tax: 200000 },
    hoanggia: { name: 'Phòng Hoàng Gia', price: 5000000, tax: 500000 }
};

function scheduleHotelTaxes() {
    setInterval(async () => {
        for (const [channelId, room] of Object.entries(hotelData.rooms)) {
            const guild = client.guilds.cache.get(room.guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(channelId);
            const ownerId = room.ownerId;
            const taxAmount = HOTEL_PRICES[room.type]?.tax || 200000;

            if (channel) {
                const bal = getBalance(ownerId);
                if (bal >= taxAmount) {
                    setBalance(ownerId, bal - taxAmount);
                    channel.send(`<:notificacao:1554632317228683446> <@${ownerId}> Đã đến hạn đóng thuế phòng khách sạn! Hệ thống đã tự động thu **-${formatMoney(taxAmount)}** phí duy trì phòng.`).catch(() => {});
                } else {
                    channel.send(`<a:aawarn:1554622466297565267> <@${ownerId}> Không đủ tiền đóng thuế phòng (**${formatMoney(taxAmount)}**). Phòng khách sạn đã bị thu hồi[span_0](start_span)[span_0](end_span)!`).catch(() => {});
                    
                    const category = channel.parent;
                    if (category) {
                        for (const child of category.children.cache.values()) {
                            await child.delete().catch(() => {});
                        }
                        await category.delete().catch(() => {});
                    } else {
                        await channel.delete().catch(() => {});
                    }
                    delete hotelData.rooms[channelId];
                    saveJSONSync(FILES.HOTELS, hotelData);
                }
            } else {
                delete hotelData.rooms[channelId];
                saveJSONSync(FILES.HOTELS, hotelData);
            }
        }
    }, 3600000); // Kiểm tra và thu thuế mỗi 1 giờ
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

async function processLotteryDraw(isManual = false) {
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

    const titleText = isManual ? '<:emoji_80:1554614708089126994> KẾT QUẢ XỔ SỐ & LÔ ĐỀ (QUAY THỦ CÔNG)' : '<:emoji_80:1554614708089126994> KẾT QUẢ XỔ SỐ & LÔ ĐỀ HÔM NAY (18:00)';
    const headerMsg = isManual ? '⚡ **THÔNG BÁO: QUAY THƯỞNG XỔ SỐ THEO YÊU CẦU AD!**' : '<:emoji_8:1554594801972678726> **ĐÃ ĐẾN GIỜ QUAY THƯỞNG XỔ SỐ THƯỜNG NIÊN (18:00)!**';

    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle(titleText)
        .addFields(
            { name: '🏆 Giải Đặc Biệt (Vé Số)', value: `🎉 **${result.specialPrize}**`, inline: false },
            { name: '🎯 Số Đề (2 số cuối GĐB)', value: `🔥 **${specialDe}**`, inline: true },
            { name: '🎲 Kết Quả 27 Giải Lô', value: `\`${result.loResults.join(' - ')}\``, inline: false },
            { name: '🎉 Người Trúng Vé Số', value: ticketWinners.length > 0 ? ticketWinners.join('\n') : 'Không có ai trúng vé số.', inline: false },
            { name: '💰 Người Trúng Lô Đề', value: lodeWinners.length > 0 ? lodeWinners.join('\n') : 'Không có ai trúng Lô Đề.', inline: false }
        )
        .setTimestamp();

    let sentCount = 0;
    for (const [guildId, channelId] of Object.entries(lodeConfig)) {
        if (channelId) {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel) {
                await channel.send({ content: headerMsg, embeds: [embed] }).catch(() => {});
                sentCount++;
            }
        }
    }

    return { sentCount, result };
}

function scheduleDailyLottery() {
    let hasDrawnToday = false;

    setInterval(() => {
        const vnDateStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
        const vnDate = new Date(vnDateStr);
        
        const hours = vnDate.getHours();
        const minutes = vnDate.getMinutes();

        if (hours === 18 && minutes === 0) {
            if (!hasDrawnToday) {
                hasDrawnToday = true;
                processLotteryDraw(false);
            }
        } else {
            hasDrawnToday = false; 
        }
    }, 10000);
}

const SUITS = ['♠️', '♥️', '♦️', '♣'];
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
            .setTitle(`<:emoji_8:1554594813402161252> KẾT QUẢ PHIÊN #${txSession.sessionNumber}`)
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
    scheduleHotelTaxes(); 
});

client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;

    try {
        const { guildId, channelId, user } = interaction;
        const txSession = getSession(guildId);
        const targetChannelId = txSession.channelId;

        // Xử lý nút chọn thuê phòng khách sạn
        if (interaction.isButton() && (interaction.customId === 'hotel_vip' || interaction.customId === 'hotel_hoanggia')) {
            const roomType = interaction.customId === 'hotel_vip' ? 'vip' : 'hoanggia';
            const roomInfo = HOTEL_PRICES[roomType];
            const userBal = getBalance(user.id);

            if (userBal < roomInfo.price) {
                return interaction.reply({ content: `<a:no:1554602168093507685> Số dư không đủ để thuê phòng ${roomInfo.name}! Cần **${formatMoney(roomInfo.price)}** nhưng bạn chỉ có **${formatMoney(userBal)}**.`, ephemeral: true });
            }

            // Trừ tiền thuê phòng
            setBalance(user.id, userBal - roomInfo.price);

            await interaction.deferReply({ ephemeral: true });

            try {
                // Tạo danh mục riêng cho phòng
                const category = await interaction.guild.channels.create({
                    name: `🏨 Khách Sạn - ${user.username}`,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                        }
                    ]
                });

                // Tạo kênh chat riêng
                const textChannel = await interaction.guild.channels.create({
                    name: `💬-phòng-${roomType}`,
                    type: ChannelType.GuildText,
                    parent: category.id
                });

                // Tạo kênh voice riêng
                const voiceChannel = await interaction.guild.channels.create({
                    name: `🔊 Voice ${roomInfo.name}`,
                    type: ChannelType.GuildVoice,
                    parent: category.id
                });

                // Lưu thông tin phòng vào hệ thống (Đã lưu kèm theo price gốc để hoàn tiền sau này)
                hotelData.rooms[textChannel.id] = {
                    guildId: guildId,
                    ownerId: user.id,
                    type: roomType,
                    price: roomInfo.price
                };
                saveJSONSync(FILES.HOTELS, hotelData);

                // Gửi bảng hướng dẫn chi tiết vào phòng mới tạo
                const guideEmbed = new EmbedBuilder()
                    .setColor('Gold')
                    .setTitle(`🏨 HƯỚNG DẪN SỬ DỤNG PHÒNG ${roomInfo.name.toUpperCase()}`)
                    .setDescription(`Chào mừng <@${user.id}> đã sở hữu không gian riêng tư thành công! Dưới đây là các đặc quyền và lệnh quản lý phòng của bạn:`)
                    .addFields(
                        { name: '<:33218colorroledotspackids:1554608256804982854> Mời & Đuổi bạn bè', value: '• Mời: `!moi @user`\n• Đuổi: `!duoi @user`', inline: true },
                        { name: '<a:2902originallyknownas:1554631297035407364> Đổi tên & Khóa phòng', value: '• Đổi tên: `!doiten <tên>`\n• Khóa/Mở: `!khoa` / `!mokhoa`', inline: true },
                        { name: '<a:3642bunpay:1554630887629656115> Trả phòng & Nhận hoàn tiền', value: '• Gõ `!traphong` (hoặc `!checkout`) bên trong kênh này để **trả phòng và nhận lại 50% tiền VNĐ**.', inline: false },
                        { name: '<:emoji_11:1554594841084690483> Thông tin thuế & Duy trì', value: `• Giá thuê: **${formatMoney(roomInfo.price)}**\n• Phí duy trì: **${formatMoney(roomInfo.tax)} / giờ** (Trừ tự động vào ví).`, inline: false },
                        { name: '<a:as_warning:1554611415514357760> Lưu ý', value: 'Nếu ví hết tiền khi đến hạn đóng thuế, phòng sẽ tự động bị thu hồi!', inline: false }
                    )
                    .setTimestamp();

                await textChannel.send({ content: `🎉 Chủ nhân <@${user.id}> đã nhận phòng thành công!`, embeds: [guideEmbed] });

                return interaction.editReply({ content: `<a:yes:1554602231389487125> Thuê phòng thành công! Kênh riêng của bạn đã được khởi tạo tại danh mục mới.` });
            } catch (err) {
                console.error('[Hotel Creation Error]:', err);
                return interaction.editReply({ content: '<a:no:1554602168093507685> Có lỗi xảy ra khi tạo phòng tự động. Vui lòng thử lại sau!' });
            }
        }

        if (interaction.isButton() && ['bet_tai', 'bet_xiu'].includes(interaction.customId)) {
            if (channelId !== targetChannelId) {
                return interaction.reply({ content: '<a:no:1554602168093507685> Nút chỉ dùng trong kênh cược!', ephemeral: true });
            }
            if (!txSession.isOpen) {
                return interaction.reply({ content: '<a:emoji_11:1554594850605899887> Hết thời gian đặt cược!', ephemeral: true });
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
                    return interaction.reply({ content: '<a:no:1554602168093507685> Số tiền không hợp lệ!', ephemeral: true });
                }

                const bal = getBalance(user.id);
                if (bet > bal) {
                    return interaction.reply({ content: `<a:no:1554602168093507685> Số dư không đủ! Hiện có: **${formatMoney(bal)}**.`, ephemeral: true });
                }

                txSession.bets.set(user.id, { choice, amount: bet });
                await updateOpenEmbed(txSession);

                return interaction.reply({ content: `<a:yes:1554602231389487125> Đã cược **${formatMoney(bet)}** vào **${choice.toUpperCase()}**!`, ephemeral: true });
            }

            if (interaction.customId.startsWith('modal_trade_')) {
                const parts = interaction.customId.split('_'); 
                const isBuy = parts[2] === 'buy';
                const symbol = parts[3];
                const amount = parseInt(interaction.fields.getTextInputValue('crypto_amount'), 10);

                if (isNaN(amount) || amount <= 0) {
                    return interaction.reply({ content: '<a:no:1554602168093507685> Số lượng không hợp lệ!', ephemeral: true });
                }

                const coin = cryptoMarket.coins[symbol];
                if (!coin) return interaction.reply({ content: '<a:no:1554602168093507685> Mã coin không tồn tại!', ephemeral: true });

                if (isBuy) {
                    const totalPrice = coin.price * amount;
                    const userBal = getBalance(user.id);
                    if (userBal < totalPrice) {
                        return interaction.reply({ content: `<a:no:1554602168093507685> Không đủ tiền! Cần **${formatMoney(totalPrice)}**, ví có **${formatMoney(userBal)}**.`, ephemeral: true });
                    }
                    setBalance(user.id, userBal - totalPrice);
                    const portfolio = getUserPortfolio(user.id);
                    portfolio[symbol] = (portfolio[symbol] || 0) + amount;
                    setUserPortfolio(user.id, portfolio);

                    return interaction.reply({ content: `<a:yes:1554602231389487125> Mua thành công **${amount} ${symbol}** (${coin.name}) với giá **${formatMoney(totalPrice)}**!`, ephemeral: true });
                } else {
                    const portfolio = getUserPortfolio(user.id);
                    const userOwned = portfolio[symbol] || 0;
                    if (userOwned < amount) {
                        return interaction.reply({ content: `<a:no:1554602168093507685> Bạn chỉ sở hữu **${userOwned} ${symbol}**, không đủ để bán!`, ephemeral: true });
                    }
                    const totalReceive = coin.price * amount;
                    portfolio[symbol] -= amount;
                    if (portfolio[symbol] <= 0) delete portfolio[symbol];
                    setUserPortfolio(user.id, portfolio);
                    setBalance(user.id, getBalance(user.id) + totalReceive);

                    return interaction.reply({ content: `<a:yes:1554602231389487125> Bán thành công **${amount} ${symbol}** (${coin.name}), nhận về **+${formatMoney(totalReceive)}**!`, ephemeral: true });
                }
            }
        }

        if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            const selectedSymbol = interaction.values[0];
            const coin = cryptoMarket.coins[selectedSymbol];

            if (customId === 'select_coin_buy' || customId === 'select_coin_sell') {
                const isBuy = customId === 'select_coin_buy';
                const modal = new ModalBuilder()
                    .setCustomId(`modal_trade_${isBuy ? 'buy' : 'sell'}_${selectedSymbol}`)
                    .setTitle(`${isBuy ? 'MUA' : 'BÁN'} ${selectedSymbol} (Giá: ${formatMoney(coin.price)})`);

                const amountInput = new TextInputBuilder()
                    .setCustomId('crypto_amount')
                    .setLabel(`Nhập số lượng ${selectedSymbol} muốn giao dịch:`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('VD: 10')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
                return interaction.showModal(modal);
            }

            if (customId === 'select_coin_chart') {
                const chartUrl = getCryptoChartUrl(selectedSymbol, coin);
                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle(`<a:emoji_5:1554592992008867930> BIỂU ĐỒ GIÁ - ${coin.name} (${selectedSymbol})`)
                    .setDescription(`Giá hiện tại: **${formatMoney(coin.price)}** | Biến động: **${coin.change > 0 ? '+' : ''}${coin.change}%**`)
                    .setImage(chartUrl);

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }

        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId === 'c_portfolio') {
                const portfolio = getUserPortfolio(user.id);
                const ownedKeys = Object.keys(portfolio);
                if (ownedKeys.length === 0) {
                    return interaction.reply({ content: '<:Brim_LUL:1554629586275405884> Danh mục đầu tư của bạn đang trống.', ephemeral: true });
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
                    .setTitle(`<:Brim_LUL:1554629586275405884> DANH MỤC ĐẦU TƯ - ${user.username}`)
                    .setDescription(desc)
                    .addFields({ name: '<:azu_vnd:1554629080194744371> Tổng tài sản', value: `**${formatMoney(totalValue)}**`, inline: false });
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (customId === 'c_menu_buy') {
                const row = getCoinSelectMenu('buy');
                return interaction.reply({ content: '<a:buy:1554628524936273970> **Chọn đồng coin bạn muốn MUA:**', components: [row], ephemeral: true });
            }

            if (customId === 'c_menu_sell') {
                const row = getCoinSelectMenu('sell');
                return interaction.reply({ content: '<:Money:1554628369797222534> **Chọn đồng coin bạn muốn BÁN:**', components: [row], ephemeral: true });
            }

            if (customId === 'c_menu_chart') {
                const row = getCoinSelectMenu('chart');
                return interaction.reply({ content: '<:coins:1554628216063397900> **Chọn đồng coin bạn muốn xem biểu đồ:**', components: [row], ephemeral: true });
            }
        }

        if (interaction.isButton() && ['bj_hit', 'bj_stand'].includes(interaction.customId)) {
            const gameKey = `${guildId}_${user.id}`;
            const game = bjGames.get(gameKey);

            if (!game) return interaction.reply({ content: '<a:cb:1554593663567274106> Ván đấu đã kết thúc!', ephemeral: true });

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
                        { name: '<a:vuongmiendo:1554622871882436710> @Paw162', value: `${formatHand(game.dealerHand, true)} (?? điểm)` },
                        { name: '<:Members:1554622922629451828> Bạn', value: `${formatHand(game.playerHand)} (${playerScore} điểm)` }
                    )
                    .setFooter({ text: `Tiền cược: ${formatMoney(game.bet)}` });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('bj_hit').setLabel('RÚT').setEmoji('1554638419626303619').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('bj_stand').setLabel('DẰN').setEmoji('1554638549251526717').setStyle(ButtonStyle.Danger)
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
        resultMessage = `<:emoji_4:1554625281686249507> **Bạn đã QUẮC (${playerScore} điểm)!** Bị trừ **-${formatMoney(bet)}**.`;
        setBalance(user.id, currentBal - bet);
    } else if (isXiBan) {
        winAmount = Math.floor(bet * 2);
        resultMessage = `<a:luavang:1554626974914453594> **XÌ BÀN!** Nhận thưởng lớn **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (isPlayerBJ && !isDealerBJ) {
        winAmount = Math.floor(bet * 1.5);
        resultMessage = `<:new:1554626843280285746> **BLACKJACK!** Bạn nhận **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (isNguLinh) {
        winAmount = Math.floor(bet * 2);
        resultMessage = `<:sao_vang:1554626148791615488> **NGŨ LINH!** Bạn thắng **+${formatMoney(winAmount)}**!`;
        setBalance(user.id, currentBal + winAmount);
    } else if (dealerScore > 21) {
        winAmount = bet;
        resultMessage = `<a:Danker_dance:1554625991131926548> **@Paw162 QUẮC (${dealerScore} điểm)!** Bạn thắng **+${formatMoney(winAmount)}**.`;
        setBalance(user.id, currentBal + winAmount);
    } else if (playerScore > dealerScore) {
        winAmount = bet;
        resultMessage = `<:emoji_112:1554625557583495218> **Thắng trận!** (${playerScore} vs ${dealerScore}). Nhận **+${formatMoney(winAmount)}**.`;
        setBalance(user.id, currentBal + winAmount);
    } else if (playerScore < dealerScore) {
        resultMessage = `<:emoji_4:1554625281686249507> **@Paw162 thắng!** (${dealerScore} vs ${playerScore}). Mất **-${formatMoney(bet)}**.`;
        setBalance(user.id, currentBal - bet);
    } else {
        resultMessage = `<a:3712partneranimated:1554624999132893299> **HÒA!** Bằng điểm (${playerScore}). Hoàn lại tiền.`;
    }

    bjGames.delete(gameKey);

    const embed = new EmbedBuilder()
        .setColor(winAmount > 0 ? 'Green' : (resultMessage.includes('HÒA') ? 'Yellow' : 'Red'))
        .setTitle(`<:Notification:1554624690729783296> KẾT QUẢ BLACKJACK <a:loading:1554624602142015539> - ${user.username}`)
        .setDescription(resultMessage)
        .addFields(
            { name: '<a:vuongmiendo:1554622871882436710> @Paw162', value: `${formatHand(dealerHand)} (${dealerScore} điểm)` },
            { name: '<:Members:1554622922629451828> Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
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
                return message.reply(`<a:aawarn:1554622466297565267> Đã reset game Nối Từ! Từ bắt đầu: **"${newWord}"**`);
            }
        }

        const inputWord = message.content.trim().toLowerCase();
        const wordParts = inputWord.split(/\s+/);
        const PENALTY_ERR = 2000;

        if (wordParts.length !== 2) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`<a:no:1554602168093507685> Từ **"${inputWord}"** không phải là từ ghép 2 tiếng! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('<:tu_choii:1554623553452777534>');
        }

        const wordSession = getWordSession(guildId);
        const lastWordParts = wordSession.currentWord.split(/\s+/);
        const requiredStartWord = lastWordParts[lastWordParts.length - 1];

        if (wordSession.lastUserId === userId) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`<a:as_warning:1554611415514357760> Bạn phải đợi người khác nối tiếp! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('<:tu_choii:1554623553452777534>');
        }

        if (wordParts[0] !== requiredStartWord) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`<a:no:1554602168093507685> Phải bắt đầu bằng từ **"${requiredStartWord}"**! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('<:tu_choii:1554623553452777534>');
        }

        if (wordSession.usedWords.has(inputWord)) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`<a:no:1554602168093507685> Từ **"${inputWord}"** đã dùng trước đó! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('<:tu_choii:1554623553452777534>');
        }

        const isExistInDict = await checkVietnameseWordOnline(inputWord);
        if (!isExistInDict) {
            setBalance(userId, getBalance(userId) - PENALTY_ERR);
            await message.reply(`<a:no:1554602168093507685> Từ **"${inputWord}"** không có trong từ điển! (-${formatMoney(PENALTY_ERR)})`);
            return message.react('<:tu_choii:1554623553452777534>');
        }

        wordSession.currentWord = inputWord;
        wordSession.lastUserId = userId;
        wordSession.usedWords.add(inputWord);

        const REWARD = 5000;
        setBalance(userId, getBalance(userId) + REWARD);

        await message.react('<a:Verify:1554597525640585328>');
        startWordGameTimeout(guildId, message.channel);
        return;
    }

    if (!message.content.startsWith(PREFIX)) return;

    try {
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ==========================================
        // LỆNH THUÊ PHÒNG KHÁCH SẠN
        // ==========================================
        if (command === 'khachsan' || command === 'thuephong' || command === 'hotel') {
            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('🏨 HỆ THỐNG THUÊ PHÒNG KHÁCH SẠN 24/7')
                .setDescription('Thuê phòng riêng tư để nhận ngay **Danh mục, Kênh Chat và Kênh Voice độc quyền**!\n\n• **Phòng VIP:** `1.500.000đ` (Thuế: 200.000đ/giờ)\n• **Phòng Tổng Thống:** `5.000.000đ` (Thuế: 500.000đ/giờ)\n\n*Bấm nút bên dưới để chọn phòng muốn thuê:*');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('hotel_vip').setLabel('<:lr:1554621025562525788> Thuê Phòng VIP (1.5 Tr)').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('hotel_hoanggia').setLabel('<a:lg:1554620960034791424> Thuê Phòng Tổng Thống (5 Tr)').setStyle(ButtonStyle.Primary)
            );

            return message.reply({ embeds: [embed], components: [row] });
        }

        // ==========================================
        // CÁC LỆNH QUẢN LÝ PHÒNG KHÁCH SẠN (!moi, !duoi, !doiten, !khoa, !mokhoa, !traphong)
        // ==========================================
        
        // 1. LỆNH MỜI THÀNH VIÊN VÀO PHÒNG (!moi)
        if (command === 'moi') {
            const roomInfo = hotelData.rooms[message.channel.id];
            if (!roomInfo) return message.reply('<a:no:1554602168093507685> Lệnh này chỉ dùng được bên trong **kênh chat phòng khách sạn** của bạn!');
            if (roomInfo.ownerId !== userId && !isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Chỉ có **chủ phòng** mới có quyền mời người khác!');

            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!moi @user`');
            if (targetUser.id === userId) return message.reply('<a:as_warning:1554611415514357760> Bạn chính là chủ phòng rồi mà!');

            try {
                await message.channel.permissionOverwrites.create(targetUser.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });

                const category = message.channel.parent;
                if (category) {
                    for (const child of category.children.cache.values()) {
                        if (child.type === ChannelType.GuildVoice) {
                            await child.permissionOverwrites.create(targetUser.id, {
                                ViewChannel: true,
                                Connect: true,
                                Speak: true
                            });
                        }
                    }
                }
                return message.reply(`<a:yes:1554602231389487125> Đã mời thành công ${targetUser} vào phòng khách sạn của bạn!`);
            } catch (err) {
                console.error('[Room Invite Error]:', err);
                return message.reply('<a:no:1554602168093507685> Có lỗi xảy ra khi cấp quyền cho thành viên.');
            }
        }

        // 2. LỆNH ĐUỔI THÀNH VIÊN KHỎI PHÒNG (!duoi)
        if (command === 'duoi') {
            const roomInfo = hotelData.rooms[message.channel.id];
            if (!roomInfo) return message.reply('<a:no:1554602168093507685> Lệnh này chỉ dùng được bên trong **kênh chat phòng khách sạn** của bạn!');
            if (roomInfo.ownerId !== userId && !isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Chỉ có **chủ phòng** mới có quyền đuổi người khác!');

            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!duoi @user`');
            if (targetUser.id === userId || targetUser.id === roomInfo.ownerId) return message.reply('<a:as_warning:1554611415514357760> Không thể tự đuổi chính mình hoặc chủ phòng!');

            try {
                await message.channel.permissionOverwrites.delete(targetUser.id);
                const category = message.channel.parent;
                if (category) {
                    for (const child of category.children.cache.values()) {
                        await child.permissionOverwrites.delete(targetUser.id).catch(() => {});
                        if (child.type === ChannelType.GuildVoice) {
                            const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
                            if (member && member.voice.channelId === child.id) {
                                await member.voice.disconnect().catch(() => {});
                            }
                        }
                    }
                }
                return message.reply(`<a:yes:1554602231389487125> Đã thu hồi quyền và đuổi ${targetUser} khỏi phòng thành công!`);
            } catch (err) {
                console.error('[Room Kick Error]:', err);
                return message.reply('<a:no:1554602168093507685> Có lỗi xảy ra khi tước quyền thành viên.');
            }
        }

        // 3. LỆNH ĐỔI TÊN PHÒNG (!doiten)
        if (command === 'doiten') {
            const roomInfo = hotelData.rooms[message.channel.id];
            if (!roomInfo) return message.reply('<a:no:1554602168093507685> Lệnh này chỉ dùng được bên trong **kênh chat phòng khách sạn** của bạn!');
            if (roomInfo.ownerId !== userId && !isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Chỉ có **chủ phòng** mới có quyền đổi tên phòng!');

            const newName = args.join(' ');
            if (!newName) return message.reply('<a:no:1554602168093507685> Vui lòng nhập tên mới cho phòng! Cú pháp: `!doiten <tên_phòng_mới>`');
            if (newName.length > 30) return message.reply('<a:as_warning:1554611415514357760> Tên phòng quá dài, vui lòng đặt dưới 30 ký tự!');

            try {
                await message.channel.setName(newName);
                const category = message.channel.parent;
                if (category) {
                    for (const child of category.children.cache.values()) {
                        if (child.type === ChannelType.GuildVoice) {
                            await child.setName(`🔊 ${newName}`).catch(() => {});
                        }
                    }
                }
                return message.reply(`<a:yes:1554602231389487125> Đã đổi tên phòng khách sạn thành công thành: **${newName}**!`);
            } catch (err) {
                console.error('[Room Rename Error]:', err);
                return message.reply('<a:no:1554602168093507685> Có lỗi xảy ra khi đổi tên phòng (Discord giới hạn số lần đổi tên kênh, hãy thử lại sau ít phút).');
            }
        }

        // 4. LỆNH KHÓA / MỞ KHÓA PHÒNG (!khoa / !mokhoa)
        if (command === 'khoa' || command === 'mokhoa') {
            const roomInfo = hotelData.rooms[message.channel.id];
            if (!roomInfo) return message.reply('<a:no:1554602168093507685> Lệnh này chỉ dùng được bên trong **kênh chat phòng khách sạn** của bạn!');
            if (roomInfo.ownerId !== userId && !isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Chỉ có **chủ phòng** mới có quyền khóa/mở khóa phòng!');

            const isLock = command === 'khoa';
            const category = message.channel.parent;

            try {
                const overwriteOptions = {
                    ViewChannel: isLock ? false : true,
                    Connect: isLock ? false : true
                };

                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, overwriteOptions);
                if (category) {
                    for (const child of category.children.cache.values()) {
                        await child.permissionOverwrites.edit(message.guild.roles.everyone, overwriteOptions).catch(() => {});
                    }
                }

                if (isLock) {
                    return message.reply('🔒 Đã **khóa phòng** thành công! Người ngoài sẽ không thể nhìn thấy hoặc tự ý vào phòng của bạn nữa.');
                } else {
                    return message.reply('🔓 Đã **mở khóa phòng** thành công! Mọi người có thể tự do ghé thăm phòng của bạn.');
                }
            } catch (err) {
                console.error('[Room Lock/Unlock Error]:', err);
                return message.reply('<a:no:1554602168093507685> Có lỗi xảy ra khi thay đổi trạng thái khóa phòng.');
            }
        }

        // 5. LỆNH TRẢ PHÒNG VÀ HOÀN 50% TIỀN VNĐ (!traphong / !checkout)
        if (command === 'traphong' || command === 'checkout') {
            const roomInfo = hotelData.rooms[message.channel.id];
            if (!roomInfo) return message.reply('<a:no:1554602168093507685> Lệnh này chỉ dùng được bên trong **kênh chat phòng khách sạn**!');
            if (roomInfo.ownerId !== userId && !isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Chỉ có **chủ phòng** mới có quyền trả phòng!');

            // Tính 50% tiền hoàn lại dựa trên giá phòng đã thuê
            const refundAmount = Math.floor(roomInfo.price * 0.5);
            const currentBal = getBalance(roomInfo.ownerId);

            // Cộng lại tiền vào ví chủ phòng
            setBalance(roomInfo.ownerId, currentBal + refundAmount);

            await message.reply(`<a:yes:1554602231389487125> Bạn đã tiến hành trả phòng thành công! Hệ thống đã hoàn lại **+${formatMoney(refundAmount)}** (50% giá trị phòng) vào ví của <@${roomInfo.ownerId}>. Danh mục phòng sẽ được xóa sau 3 giây...`);

            // Xóa toàn bộ kênh và danh mục phòng sau 3 giây
            setTimeout(async () => {
                try {
                    const category = message.channel.parent;
                    if (category) {
                        for (const child of category.children.cache.values()) {
                            await child.delete().catch(() => {});
                        }
                        await category.delete().catch(() => {});
                    } else {
                        await message.delete().catch(() => {});
                    }
                    delete hotelData.rooms[message.channel.id];
                    saveJSONSync(FILES.HOTELS, hotelData);
                } catch (err) {
                    console.error('[Room Checkout Delete Error]:', err);
                }
            }, 3000);

            return;
        }

        // ==========================================
        // CÁC LỆNH ĐẶT CƯỢC LÔ ĐỀ & VÉ SỐ
        // ==========================================
        if (command === 'lo' || command === 'de') {
            const num = args[0];
            const bet = parseInt(args[1], 10);

            if (!num || !/^\d{2}$/.exec(num) || isNaN(bet) || bet <= 0) {
                return message.reply(`<a:no:1554602168093507685> Cú pháp: \`!${command} <số_2_chữ_số> <tiền_cược>\`\n*(VD: \`!${command} 68 50000\`)*`);
            }

            const bal = getBalance(userId);
            if (bet > bal) {
                return message.reply(`<a:no:1554602168093507685> Số dư ví không đủ! Bạn hiện có **${formatMoney(bal)}**.`);
            }

            setBalance(userId, bal - bet);
            lotteryData.lodeBets.push({
                userId: userId,
                type: command,
                number: num,
                amount: bet
            });
            saveJSONSync(FILES.LOTTERY, lotteryData);

            const rateText = command === 'de' ? '1 ăn 70 (Giải Đặc Biệt)' : '1 ăn 3.5 mỗi nháy (27 giải)';
            return message.reply(`<a:yes:1554602231389487125> Đã đặt cược **${command.toUpperCase()} ${num}** với số tiền **${formatMoney(bet)}**! Tỉ lệ: **${rateText}**. Đợi kết quả lúc 18:00!`);
        }

        if (command === 'veso' || command === 'muaveso') {
            const TICKET_PRICE = 10000;
            let num = args[0];

            if (!num) {
                num = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
            } else if (!/^\d{6}$/.exec(num)) {
                return message.reply('<a:no:1554602168093507685> Vé số phải có đủ **6 chữ số** (VD: `!veso 123456` hoặc gõ `!veso` để mua ngẫu nhiên).');
            }

            const bal = getBalance(userId);
            if (bal < TICKET_PRICE) {
                return message.reply(`<a:no:1554602168093507685> Bạn cần ít nhất **${formatMoney(TICKET_PRICE)}** để mua vé số!`);
            }

            setBalance(userId, bal - TICKET_PRICE);
            lotteryData.tickets.push({
                userId: userId,
                number: num
            });
            saveJSONSync(FILES.LOTTERY, lotteryData);

            return message.reply(`<:2990_yes:1554602080780689418> Đã mua thành công vé số **${num}** với giá **${formatMoney(TICKET_PRICE)}**! Trúng Giải Đặc Biệt nhận ngay **100.000.000đ**!`);
        }

        // LỆNH ÉP BOT RA KẾT QUẢ SỔ XỐ / LÔ ĐỀ NGAY
        if (['kqsx', 'quayso', 'eplode'].includes(command)) {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Bạn không có quyền ép quay số!');
            
            await message.reply('<:emoji_80:1554614708089126994> **Đang tiến hành quay số KQSX & Lô Đề ngay lập tức...**');
            const resData = await processLotteryDraw(true);
            
            if (resData.sentCount === 0) {
                return message.channel.send('<a:cb:1554593663567274106>Đã quay xong kết quả nhưng chưa có kênh nào được cài đặt bằng lệnh `!setlode`!');
            }
            return;
        }

        if (command === 'importdata') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền Khôi Phục dữ liệu!');
            
            const attachments = Array.from(message.attachments.values());
            if (attachments.length === 0) {
                return message.reply('<a:no:1554602168093507685> Vui lòng đính kèm ít nhất một file `.json` cần import kèm theo lệnh `!importdata`!');
            }

            let successCount = 0;
            let failedFiles = [];

            for (const att of attachments) {
                const fileName = att.name.toLowerCase();
                const matchedKey = Object.keys(FILES).find(key => FILES[key].toLowerCase().includes(fileName));

                if (matchedKey) {
                    try {
                        const targetPath = FILES[matchedKey];
                        const response = await axios.get(att.url, { responseType: 'text' });
                        
                        JSON.parse(response.data); 
                        fs.writeFileSync(targetPath, response.data, 'utf8');
                        successCount++;
                    } catch (e) {
                        console.error(`[Import Error cho file ${fileName}]:`, e.message);
                        failedFiles.push(fileName);
                    }
                } else {
                    failedFiles.push(`${fileName} (không khớp tên hệ thống)`);
                }
            }

            balances = loadJSON(FILES.BALANCES);
            customTitles = loadJSON(FILES.TITLES);
            config = loadJSON(FILES.CONFIG, false);
            wordConfig = loadJSON(FILES.WORD_CONFIG, false);
            lodeConfig = loadJSON(FILES.LODE_CONFIG, false);
            lotteryData = loadJSON(FILES.LOTTERY, false);
            staffList = loadJSON(FILES.STAFFS, false);
            adminList = loadJSON(FILES.ADMINS, false);
            loans = loadJSON(FILES.LOANS);
            cryptoMarket = loadJSON(FILES.CRYPTO, false);
            portfolios = loadJSON(FILES.PORTFOLIO);
            hotelData = loadJSON(FILES.HOTELS, false);

            let replyMessage = `<a:yes:1554602231389487125> Đã import thành công **${successCount}/${attachments.length}** file dữ liệu! Bot đã tự động nạp lại bộ nhớ RAM.`;
            if (failedFiles.length > 0) {
                replyMessage += `\n<a:as_warning:1554611415514357760> Các file lỗi/không nhận diện: ${failedFiles.join(', ')}`;
            }

            return message.reply(replyMessage);
        }

        if (command === 'addadmin') {
            if (userId !== ADMIN_ID) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền thêm Admin!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!addadmin @user`');

            if (targetUser.id === ADMIN_ID) {
                return message.reply('<a:cb:1554593663567274106> Đây là Owner!');
            }

            if (adminList.users.includes(targetUser.id)) {
                return message.reply(`<a:as_warning:1554611415514357760> ${targetUser} đã có quyền Admin phụ từ trước!`);
            }

            adminList.users.push(targetUser.id);
            saveJSONSync(FILES.ADMINS, adminList);
            return message.reply(`<a:yes:1554602231389487125> Đã thêm ${targetUser} vào danh sách Admin thành công!`);
        }

        if (command === 'removeadmin' || command === 'deladmin') {
            if (userId !== ADMIN_ID) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền gỡ Admin!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!removeadmin @user`');

            const index = adminList.users.indexOf(targetUser.id);
            if (index === -1) {
                return message.reply(`<a:as_warning:1554611415514357760> ${targetUser} không có trong danh sách Admin!`);
            }

            adminList.users.splice(index, 1);
            saveJSONSync(FILES.ADMINS, adminList);
            return message.reply(`<a:yes:1554602231389487125> Đã gỡ bỏ quyền Admin của ${targetUser}.`);
        }

        if (command === 'listadmin' || command === 'admins') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Bạn không có quyền xem danh sách này!');
            
            let desc = `<a:Crown:1554608058460676167> **Owner :** <@${ADMIN_ID}>\n`;
            if (adminList.users.length > 0) {
                desc += `<:994180roleadminred:1554607509724209153> **Admin:**\n` + adminList.users.map(id => `• <@${id}>`).join('\n');
            } else {
                desc += `<:994180roleadminred:1554607509724209153> **Admin:** Chưa có ai.`;
            }

            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('<:MH_supporter:1554613407552905226> Danh Sách Owner & Admin BOT')
                .setDescription(desc);
            return message.reply({ embeds: [embed] });
        }

        if (command === 'addstaff') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền thêm Staff!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!addstaff @user`');

            if (staffList.users.includes(targetUser.id)) {
                return message.reply(`⚠ ${targetUser} đã có trong danh sách Staff từ trước!`);
            }

            staffList.users.push(targetUser.id);
            saveJSONSync(FILES.STAFFS, staffList);
            return message.reply(`<a:yes:1554602231389487125> Đã thêm ${targetUser} vào danh sách Quản Trị Viên (Staff)!`);
        }

        if (command === 'removestaff' || command === 'delstaff') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền xóa Staff!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('<a:no:1554602168093507685> Cú pháp: `!removestaff @user`');

            const index = staffList.users.indexOf(targetUser.id);
            if (index === -1) {
                return message.reply(`<a:as_warning:1554611415514357760> ${targetUser} không có trong danh sách Staff!`);
            }

            staffList.users.splice(index, 1);
            saveJSONSync(FILES.STAFFS, staffList);
            return message.reply(`<a:yes:1554602231389487125> Đã gỡ bỏ ${targetUser} khỏi danh sách Staff.`);
        }

        if (command === 'liststaff' || command === 'staffs') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Bạn không có quyền xem danh sách này!');
            if (staffList.users.length === 0) {
                return message.reply('<:1503moderatorbadge:1554610677220511774> Danh sách Staff hiện tại đang trống.');
            }

            const staffMentions = staffList.users.map(id => `• <@${id}>`).join('\n');
            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('<:1503moderatorbadge:1554610677220511774> Danh Sạch Staff')
                .setDescription(staffMentions);
            return message.reply({ embeds: [embed] });
        }

        if (['coin', 'crypto', 'chungkhoan'].includes(command)) {
            const subCmd = args[0]?.toLowerCase();

            if (subCmd === 'chart' || subCmd === 'bieudo') {
                const symbol = args[1]?.toUpperCase();
                if (!symbol || !cryptoMarket.coins[symbol]) {
                    return message.reply('<a:no:1554602168093507685> Cú pháp xem biểu đồ: `!coin chart <MÃ_COIN>`\n*(VD: `!coin chart BTC`)*');
                }

                const coin = cryptoMarket.coins[symbol];
                const chartUrl = getCryptoChartUrl(symbol, coin);
                const row = getCrypto4ButtonsRow();

                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle(`📈 BIỂU ĐỒ GIÁ TRỰC TUYẾN - ${coin.name} (${symbol})`)
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

            let marketText = '';
            for (const [symbol, coin] of Object.entries(cryptoMarket.coins)) {
                const trendEmoji = coin.change > 0 ? '<:stonks:1554601546820493472> ▲' : (coin.change < 0 ? '<:notstonks:1554601468810756266> ▼' : '🟡 ➖');
                const sign = coin.change > 0 ? '+' : '';
                marketText += `${trendEmoji} **${coin.name} (${symbol})**: **${formatMoney(coin.price)}** (${sign}${coin.change}%)\n`;
            }

            const embedMarket = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle('📊 THỊ TRƯỜNG CHỨNG KHOÁN & COIN ÁO')
                .setDescription(`*Chọn các nút bên dưới để thực hiện nhanh thao tác (Mua, Bán, Xem biểu đồ, Xem ví).*:\n\n${marketText}`);

            const row = getCrypto4ButtonsRow();

            return message.reply({ embeds: [embedMarket], components: [row] });
        }

        if (command === 'setcoin') {
            if (!isBotStaff(userId) && !message.member.permissions.has('Administrator')) return message.reply('<a:no:1554602168093507685> Bạn không có quyền cấu hình kênh!');
            const targetChannel = message.mentions.channels.first() || message.channel;

            if (typeof config[guildId] !== 'object') config[guildId] = {};
            config[guildId].cryptoChannelId = targetChannel.id;
            saveJSONSync(FILES.CONFIG, config);

            return message.reply(`<a:yes:1554602231389487125> Đã thiết lập kênh thông báo biến động Crypto tự động tại ${targetChannel}.`);
        }

        // LỆNH VAY TIỀN NGÂN HÀNG (SỬ DỤNG HẠN MỨC 1 TỶ)
        if (command === 'vay' || command === 'vaytien') {
            const amount = parseInt(args[0], 10);
            const currentDebt = getLoan(userId);

            if (isNaN(amount) || amount <= 0) {
                const embed = new EmbedBuilder()
                    .setColor('Yellow')
                    .setTitle('🏦 NGÂN HÀNG 2ChânBank - THÔNG TIN VAY')
                    .setDescription(`• Lãi suất cố định: **${LOAN_INTEREST_RATE * 100}%**\n• Hạn ngạch tối đa: **${formatMoney(MAX_LOAN_LIMIT)}**\n• Nợ hiện tại của bạn: **${formatMoney(currentDebt)}**`);
                return message.reply({ embeds: [embed] });
            }

            if (currentDebt > 0) return message.reply(`<a:no:1554602168093507685> Trả Hết Nợ Cũ Đi **${formatMoney(currentDebt)}** Rồi Vay Lại.`);
            if (amount > MAX_LOAN_LIMIT) return message.reply(`<a:no:1554602168093507685> Vay Nhiều Quá Trả Không Nổi Đâu **${formatMoney(MAX_LOAN_LIMIT)}**.`);

            const totalDebtWithInterest = Math.floor(amount * (1 + LOAN_INTEREST_RATE));
            setLoan(userId, totalDebtWithInterest);
            setBalance(userId, getBalance(userId) + amount);

            return message.reply(`<a:yes:1554602231389487125> +1 Con Nợ **+${formatMoney(amount)}**. Tổng nợ cần trả: **${formatMoney(totalDebtWithInterest)}**.`);
        }

        if (command === 'trano' || command === 'payloan') {
            const currentDebt = getLoan(userId);
            if (currentDebt <= 0) return message.reply('🎉 Bạn không có khoản nợ nào!');

            let payAmount = parseInt(args[0], 10);
            if (args[0]?.toLowerCase() === 'all') payAmount = currentDebt;

            if (isNaN(payAmount) || payAmount <= 0) return message.reply(`<a:no:1554602168093507685> Cú pháp: \`!trano <số_tiền|all>\`. Nợ hiện tại: **${formatMoney(currentDebt)}**`);

            const bal = getBalance(userId);
            if (bal < payAmount) return message.reply(`<a:no:1554602168093507685> Số dư ví không đủ!`);

            const actualPayment = Math.min(payAmount, currentDebt);
            setBalance(userId, bal - actualPayment);
            setLoan(userId, currentDebt - actualPayment);

            return message.reply(`💳 Đã trả **-${formatMoney(actualPayment)}** tiền nợ. Nợ còn lại: **${formatMoney(currentDebt - actualPayment)}**.`);
        }

        if (command === 'exportdata') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền này!');
            
            const allData = {};
            for (const [key, filePath] of Object.entries(FILES)) {
                if (fs.existsSync(filePath)) {
                    try {
                        const raw = fs.readFileSync(filePath, 'utf8');
                        allData[key] = JSON.parse(raw);
                    } catch (e) {
                        console.error(`[Export Read Error] ${filePath}:`, e.message);
                    }
                }
            }

            const backupFilePath = './bot_backup_all.json';
            fs.writeFileSync(backupFilePath, JSON.stringify(allData, null, 2), 'utf8');

            const attachment = new AttachmentBuilder(backupFilePath);
            await message.author.send({ content: '📦 **File backup tổng hợp toàn bộ dữ liệu bot:**', files: [attachment] }).catch(() => null);
            
            setTimeout(() => {
                if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);
            }, 5000);

            return message.reply('<a:yes:1554602231389487125> Đã đóng gói toàn bộ dữ liệu thành **1 file duy nhất** và gửi vào tin nhắn riêng cho bạn!');
        }

        if (command === 'cong') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Không có quyền!');
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);
            if (!targetUser || isNaN(amount)) return message.reply('<a:no:1554602168093507685> Sai cú pháp! VD: `!cong @user 50000`');
            setBalance(targetUser.id, getBalance(targetUser.id) + amount);
            return message.reply(`<a:yes:1554602231389487125> Đã cộng **${formatMoney(amount)}** cho ${targetUser}!`);
        }

        if (command === 'tru') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Không có quyền!');
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);
            if (!targetUser || isNaN(amount) || amount <= 0) return message.reply('<a:no:1554602168093507685> Sai cú pháp! VD: `!tru @user 50000`');
            
            const currentBal = getBalance(targetUser.id);
            const newBal = Math.max(0, currentBal - amount); 
            setBalance(targetUser.id, newBal);
            return message.reply(`<a:yes:1554602231389487125> Đã trừ **${formatMoney(amount)}** của ${targetUser}! Số dư mới: **${formatMoney(newBal)}**`);
        }

        if (command === 'resetmoney' || command === 'resetvon') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền reset tiền hệ thống!');
            const targetUser = message.mentions.users.first();
            
            if (!targetUser && args[0]?.toLowerCase() !== 'all') {
                return message.reply('<a:no:1554602168093507685> Cú pháp: `!resetmoney @user` (hoặc `!resetmoney all` nếu muốn reset toàn server).');
            }

            if (args[0]?.toLowerCase() === 'all') {
                for (const [uId] of balances.entries()) {
                    balances.set(uId, 50000); 
                }
                saveJSONSync(FILES.BALANCES, balances);
                return message.reply('⚠ **Đã reset số dư của TOÀN BỘ thành viên trong server về mức khởi điểm (50.000đ)!**');
            }

            setBalance(targetUser.id, 50000); 
            return message.reply(`🔄 Đã reset số dư của ${targetUser} về mức khởi điểm (**50.000đ**) thành công!`);
        }

        if (command === 'settaixiu') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            const txSession = getSession(guildId);
            txSession.channelId = targetChannel.id;
            saveTaiXiuState(guildId, txSession);
            await message.reply(`<a:yes:1554602231389487125> Đã thiết lập kênh Tài Xỉu tại ${targetChannel}.`);
            startTaiXiuLoop(guildId, targetChannel.id);
            return;
        }

        if (command === 'setlode') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            lodeConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.LODE_CONFIG, lodeConfig);
            return message.reply(`<a:yes:1554602231389487125> Đã thiết lập kênh Lô Đề tại ${targetChannel}.`);
        }

        if (command === 'setnoitu') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Không có quyền!');
            const targetChannel = message.mentions.channels.first() || message.channel;
            wordConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.WORD_CONFIG, wordConfig);
            startWordGameTimeout(guildId, targetChannel);
            return message.reply(`<a:yes:1554602231389487125> Đã thiết lập kênh Nối Từ tại ${targetChannel}.`);
        }

        if (command === 'settitle') {
            if (!isBotOwner(userId)) return message.reply('<a:no:1554602168093507685> Chỉ Owner mới có quyền cấp danh hiệu!');
            const targetUser = message.mentions.users.first();
            const titleText = args.slice(1).join(' ');
            if (!targetUser || !titleText) return message.reply('<a:no:1554602168093507685> Cú pháp: `!settitle @user <Tên danh hiệu>`');
            
            customTitles.set(targetUser.id, titleText);
            saveJSONSync(FILES.TITLES, customTitles);
            return message.reply(`<a:yes:1554602231389487125> Đã cấp danh hiệu **"${titleText}"** cho ${targetUser}!`);
        }

        if (command === 'blackjack' || command === 'bj') {
            const gameKey = `${guildId}_${userId}`;
            if (bjGames.has(gameKey)) return message.reply('<a:no:1554602168093507685> Bạn đang trong ván đấu khác!');

            const bet = parseInt(args[0], 10);
            if (isNaN(bet) || bet <= 0) return message.reply('<a:no:1554602168093507685> Cú pháp: `!bj <số_tiền>`');

            const bal = getBalance(userId);
            if (bet > bal) return message.reply('<a:no:1554602168093507685> Số dư không đủ!');

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
                    { name: '<a:vuongmiendo:1554622871882436710> @Paw162', value: `${formatHand(dealerHand, true)} (?? điểm)` },
                    { name: '<:Members:1554622922629451828> Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bj_hit').setLabel('RÚT').setEmoji('1554638419626303619').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('bj_stand').setLabel('DẰN').setEmoji('1554638549251526717').setStyle(ButtonStyle.Danger)
            );

            return message.reply({ embeds: [embed], components: [row] });
        }

        // LỆNH HƯỚNG DẪN THÀNH VIÊN (!hlp)
        if (command === 'hlp' || command === 'giupde' || command === 'help') {
            const embed = new EmbedBuilder()
                .setColor('Random')
                .setTitle('📖 BẢNG HƯỚNG DẪN CÁC LỆNH DÀNH CHO THÀNH VIÊN')
                .setDescription('Danh sách các lệnh giải trí, tài chính, giao dịch coin và dịch vụ khách sạn:')
                .addFields(
                    { 
                        name: '🏨 Khách Sạn 24/7', 
                        value: '• `!khachsan` (hoặc `!thuephong`): Mở giao diện bảng chọn thuê Phòng VIP (1.5 Tr) hoặc Hoàng Gia (5 Tr)\n• `!moi @user`: Mời bạn vào phòng khách sạn của bạn\n• `!duoi @user`: Đuổi thành viên khỏi phòng khách sạn\n• `!doiten <tên_mới>`: Đổi tên phòng khách sạn\n• `!khoa` / `!mokhoa`: Khóa hoặc mở khóa phòng\n• `!traphong` (hoặc `!checkout`): Trả phòng và nhận lại **50% tiền VNĐ** vào ví', 
                        inline: false 
                    },
                    { 
                        name: '💰 Tài Chính & Ngân Hàng', 
                        value: '• `!balance` (hoặc `!sodu`): Xem số dư ví hiện tại\n• `!profile` (hoặc `!pf`): Xem hồ sơ chi tiết, BXH và danh hiệu\n• `!daily`: Điểm danh nhận quà hằng ngày (100.000đ)\n• `!top` (hoặc `!bxh`): Xem bảng xếp hạng đại gia\n• `!vay <số_tiền>`: Vay tiền ngân hàng (lãi suất 30%, tối đa 1 Tỷ)\n• `!trano <số_tiền|all>`: Trả nợ ngân hàng', 
                        inline: false 
                    },
                    { 
                        name: '📈 Chứng Khoán & Crypto', 
                        value: '• `!coin`: Xem bảng giá thị trường kèm bảng 4 nút bấm tương tác\n• `!coin chart <MÃ>`: Xem biểu đồ kỹ thuật trực tuyến (VD: `!coin chart BTC`)\n• `!coin vi`: Xem danh mục đầu tư coin của bạn', 
                        inline: false 
                    },
                    { 
                        name: '🎲 Game Giải Trí & Lô Đề', 
                        value: '• `!lo <số_2_chữ_số> <số_tiền>`: Đánh Lô (1 ăn 3.5 mỗi nháy trong 27 giải)\n• `!de <số_2_chữ_số> <số_tiền>`: Đánh Đề (1 ăn 70 Giải Đặc Biệt)\n• `!veso [chữ_số]` (hoặc `!muaveso`): Mua vé số 6 chữ số giá 10.000đ (Trúng 100Tr)\n• `!bj <số_tiền>` (hoặc `!blackjack`): Chơi bài Blackjack (Xì Dách)\n• **Tài Xỉu:** Tham gia cược qua các nút bấm tương tác tại kênh Tài Xỉu\n• **Nối Từ:** Tham gia trực tiếp bằng cách gõ từ ghép 2 tiếng tại kênh Nối Từ (`!noitu reset` để làm mới từ)\n• **Lô Đề / Vé Số:** Tự động quay thưởng vào 18:00 hằng ngày', 
                        inline: false 
                    }
                )
                .setFooter({ text: 'Hệ thống giải trí và giao dịch trực tuyến' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        // LỆNH HƯỚNG DẪN ADMIN / STAFF (!hlpa)
        if (command === 'hlpa') {
            if (!isBotStaff(userId)) return message.reply('<a:no:1554602168093507685> Bạn không có quyền sử dụng lệnh hướng dẫn Admin này!');

            const embed = new EmbedBuilder()
                .setColor('DarkRed')
                .setTitle('⚙️ BẢNG LỆNH QUẢN TRỊ (ADMIN & STAFF)')
                .setDescription('Danh sách các lệnh cấu hình, quản lý hệ thống dành riêng cho đội ngũ Quản Trị Viên:')
                .addFields(
                    { 
                        name: '🛠️ Cấu Hình Hệ Thống & Kênh', 
                        value: '• `!setcoin`: Đặt kênh thông báo biến động Crypto tự động\n• `!settaixiu`: Đặt kênh chơi Tài Xỉu tự động\n• `!setlode`: Đặt kênh thông báo Xổ số / Lô đề\n• `!setnoitu`: Đặt kênh chơi game Nối Từ\n• `!kqsx` (hoặc `!quayso`): Ép bot ra kết quả Xổ Số & Lô Đề ngay lập tức', 
                        inline: false 
                    },
                    { 
                        name: '💵 Quản Lý Kinh Tế & Thành Viên', 
                        value: '• `!cong @user <số_tiền>`: Cộng tiền cho người chơi\n• `!tru @user <số_tiền>`: Trừ tiền của người chơi (Staff+)\n• `!settitle @user <Danh hiệu>`: Cấp danh hiệu cho người dùng (Owner)\n• `!resetmoney @user` (hoặc `all`): Reset ví tiền về mặc định (Owner)', 
                        inline: false 
                    },
                    { 
                        name: '🛡️ Quản Lý Quyền Hạn (Admin/Staff)', 
                        value: '• `!addadmin @user`: Thêm Admin phụ tối cao (Chỉ Owner gốc)\n• `!removeadmin @user`: Gỡ Admin phụ (Chỉ Owner gốc)\n• `!listadmin`: Xem danh sách Admin\n• `!addstaff @user`: Thêm quản trị viên Staff\n• `!removestaff @user`: Xóa quản trị viên Staff\n• `!liststaff`: Xem danh sách Staff', 
                        inline: false 
                    },
                    { 
                        name: '📦 Sao Lưu & Khôi Phục Dữ Liệu', 
                        value: '• `!exportdata`: Sao lưu và gửi toàn bộ file dữ liệu qua tin nhắn riêng (Chỉ Owner)\n• `!importdata`: Đính kèm file JSON để cập nhật dữ liệu hàng loạt (Chỉ Owner)', 
                        inline: false 
                    }
                )
                .setFooter({ text: 'Khu vực bảo mật dành cho Staff/Admin' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        if (command === 'profile' || command === 'pf') {
            const targetUser = message.mentions.users.first() || message.author;
            const bal = getBalance(targetUser.id);
            
            const sortedBalances = Array.from(balances.entries()).sort((a, b) => b[1] - a[1]);
            const rankIndex = sortedBalances.findIndex(([id]) => id === targetUser.id);
            const rankText = rankIndex !== -1 ? `#${rankIndex + 1}` : 'Chưa xếp hạng';

            let titleText = customTitles.get(targetUser.id);
            if (!titleText) {
                if (targetUser.id === ADMIN_ID || adminList.users.includes(targetUser.id)) {
                    titleText = '<a:Crown:1554608058460676167> Owner';
                } else if (isBotStaff(targetUser.id)) {
                    titleText = '<:994180roleadminred:1554607509724209153> Quản Trị Viên';
                } else {
                    titleText = '<:33218colorroledotspackids:1554608256804982854> Thành Viên';
                }
            }

            const embed = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle(`🪪 Profile - ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '💲 Số dư', value: `**${formatMoney(bal)}**`, inline: false },
                    { name: '🏆 BXH Toàn Cầu', value: `**${rankText}**`, inline: false },
                    { name: '🎖️ Danh hiệu', value: `**${titleText}**`, inline: false }
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
