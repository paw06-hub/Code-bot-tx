const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const express = require('express');
const axios = require('axios'); // Dùng để đọc/tải file đính kèm khi import

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
    CONFIG: './config.json',           // Cấu hình & Lịch sử Tài Xỉu
    WORD_CONFIG: './word_config.json', // Kênh Nối Từ
    LODE_CONFIG: './lode_config.json', // Kênh Lô Đề 18h
    LOTTERY: './lottery.json',         // Vé số, Cược Lô Đề & KQXS
    STAFFS: './staffs.json',           // File lưu danh sách Staff
    LOANS: './loans.json'              // File lưu khoản vay & nợ
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

// NẠP DỮ LIỆU TỪ FILE JSON KHI KHỞI ĐỘNG
let balances = loadJSON(FILES.BALANCES);
let customTitles = loadJSON(FILES.TITLES);
let config = loadJSON(FILES.CONFIG, false);
let wordConfig = loadJSON(FILES.WORD_CONFIG, false);
let lodeConfig = loadJSON(FILES.LODE_CONFIG, false);
let lotteryData = loadJSON(FILES.LOTTERY, false);
let staffList = loadJSON(FILES.STAFFS, false);
let loans = loadJSON(FILES.LOANS); // Map lưu nợ vay

if (!lotteryData.tickets) lotteryData.tickets = [];
if (!lotteryData.lodeBets) lotteryData.lodeBets = [];
if (!lotteryData.lastResult) lotteryData.lastResult = null;
if (!Array.isArray(staffList.users)) staffList.users = [];

const dailyCooldown = new Map();
const workCooldown = new Map();
const crimeCooldown = new Map();
const guildSessions = new Map();
const bjGames = new Map();
const wordGameSessions = new Map();

const dictionaryCache = new Map();

// HELPER CHECK QUYỀN
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

// HELPER FUNCTIONS FOR MONEY WITH AUTO-SAVE
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
    saveJSONSync(FILES.BALANCES, balances); // Ghi đĩa ngay lập tức
};

// HELPER MANAGEMENT FOR LOANS
const LOAN_INTEREST_RATE = 0.30; // Lãi suất 30%
const MAX_LOAN_LIMIT = 5000000;   // Hạn ngạch vay tối đa: 5.000.000đ

const getLoan = (userId) => {
    return loans.get(userId) || 0;
};

const setLoan = (userId, amount) => {
    if (amount <= 0) {
        loans.delete(userId);
    } else {
        loans.set(userId, amount);
    }
    saveJSONSync(FILES.LOANS, loans);
};

// GAME NỐI TỪ SESSION
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

// TÀI XỈU SESSION MANAGER
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
    config[guildId] = {
        channelId: session.channelId,
        sessionNumber: session.sessionNumber,
        history: session.history
    };
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

// ==========================================
// 3. XỔ SỐ & LÔ ĐỀ SYSTEM (18:00)
// ==========================================
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
    console.log('⏰ Bắt đầu quay thưởng Xổ Số & Lô Đề lúc 18:00...');
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

// BLACKJACK ENGINE
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

// TÀI XỈU ENGINE
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
        let resultText = `🎲 Kết quả: **${d1} - ${d2} -${d3}** (Tổng: **${sum}** - **${res === 'bao' ? 'BÃO' : res.toUpperCase()}**)\n`;
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

// EVENTS
client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập: ${client.user.tag}`);
    for (const [guildId, guildData] of Object.entries(config)) {
        const channelId = typeof guildData === 'string' ? guildData : guildData?.channelId;
        if (channelId) startTaiXiuLoop(guildId, channelId);
    }
    scheduleDailyLottery();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;

    try {
        const { guildId, channelId, user } = interaction;
        const txSession = getSession(guildId);
        const targetChannelId = txSession.channelId;

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

        if (interaction.isModalSubmit()) {
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
        resultMessage = `🎉 **Thắng trận!** (${playerScore} vs${dealerScore}). Nhận **+${formatMoney(winAmount)}**.`;
        setBalance(user.id, currentBal + winAmount);
    } else if (playerScore < dealerScore) {
        resultMessage = `😭 **Nhà cái thắng!** (${dealerScore} vs${playerScore}). Mất **-${formatMoney(bet)}**.`;
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

    // KÊNH GAME NỐI TỪ
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

        // 🏦 HỆ THỐNG VAY TIỀN & TRẢ NỢ (TÍN DỤNG) - LÃI SUẤT 30%
        if (command === 'vay' || command === 'vaytien') {
            const amount = parseInt(args[0], 10);
            const currentDebt = getLoan(userId);

            if (isNaN(amount) || amount <= 0) {
                const embed = new EmbedBuilder()
                    .setColor('Yellow')
                    .setTitle('🏦 NGÂN HÀNG DISCORD - THÔNG TIN VAY')
                    .setDescription(`• Lãi suất cố định: **${LOAN_INTEREST_RATE * 100}%**\n• Hạn ngạch tối đa: **${formatMoney(MAX_LOAN_LIMIT)}**\n• Nợ hiện tại của bạn: **${formatMoney(currentDebt)}**`)
                    .setFooter({ text: 'Cú pháp vay: !vay <số_tiền>' });
                return message.reply({ embeds: [embed] });
            }

            if (currentDebt > 0) {
                return message.reply(`❌ Bạn chưa thể vay thêm! Hãy trả hết khoản nợ cũ **${formatMoney(currentDebt)}** bằng lệnh \`!trano\` trước.`);
            }

            if (amount > MAX_LOAN_LIMIT) {
                return message.reply(`❌ Số tiền vay vượt quá hạn ngạch cho phép! Tối đa bạn chỉ được vay **${formatMoney(MAX_LOAN_LIMIT)}**.`);
            }

            const totalDebtWithInterest = Math.floor(amount * (1 + LOAN_INTEREST_RATE));
            
            setLoan(userId, totalDebtWithInterest);
            setBalance(userId, getBalance(userId) + amount);

            const embedSuccess = new EmbedBuilder()
                .setColor('Green')
                .setTitle('🏦 VAY TIỀN THÀNH CÔNG')
                .addFields(
                    { name: '💵 Số tiền thực nhận', value: `**+${formatMoney(amount)}**`, inline: true },
                    { name: '📈 Tổng nợ phải trả (gồm 30% lãi)', value: `**${formatMoney(totalDebtWithInterest)}**`, inline: true },
                    { name: '💰 Ví hiện tại', value: `**${formatMoney(getBalance(userId))}**`, inline: false }
                )
                .setFooter({ text: 'Dùng !trano <số_tiền> để hoàn trả khoản vay.' });

            return message.reply({ embeds: [embedSuccess] });
        }

        if (command === 'trano' || command === 'payloan') {
            const currentDebt = getLoan(userId);
            if (currentDebt <= 0) {
                return message.reply('🎉 Bạn hiện không có khoản nợ nào!');
            }

            let payAmount = parseInt(args[0], 10);
            if (args[0]?.toLowerCase() === 'all') {
                payAmount = currentDebt;
            }

            if (isNaN(payAmount) || payAmount <= 0) {
                return message.reply(`❌ Cú pháp: \`!trano <số_tiền>\` hoặc \`!trano all\`.\n📌 Tổng nợ cần trả: **${formatMoney(currentDebt)}**`);
            }

            const bal = getBalance(userId);
            if (bal < payAmount) {
                return message.reply(`❌ Bạn không đủ tiền mặt để trả! Số dư hiện tại: **${formatMoney(bal)}**.`);
            }

            const actualPayment = Math.min(payAmount, currentDebt);
            const remainingDebt = currentDebt - actualPayment;

            setBalance(userId, bal - actualPayment);
            setLoan(userId, remainingDebt);

            const embedPay = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('💳 THANH TOÁN KHOẢN NỢ')
                .addFields(
                    { name: '💸 Số tiền đã trả', value: `**-${formatMoney(actualPayment)}**`, inline: true },
                    { name: '📌 Nợ còn lại', value: `**${formatMoney(remainingDebt)}**`, inline: true },
                    { name: '💰 Ví hiện tại', value: `**${formatMoney(getBalance(userId))}**`, inline: false }
                );

            return message.reply({ embeds: [embedPay] });
        }

        // 📦 EXPORT BACKUP DỮ LIỆU SỐ DƯ & CẤU HÌNH
        if (command === 'exportdata' || command === 'backupdata') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền export dữ liệu!');
            
            const attachments = [];
            for (const [key, filePath] of Object.entries(FILES)) {
                if (fs.existsSync(filePath)) {
                    attachments.push(new AttachmentBuilder(filePath));
                }
            }

            await message.author.send({ content: '📦 **Dữ liệu backup hiện tại của Bot:**', files: attachments }).catch(() => null);
            return message.reply('✅ Đã gửi toàn bộ file JSON lưu trữ số dư & dữ liệu vào tin nhắn riêng của bạn!');
        }

        // 📥 IMPORT/RESTORE KHÔI PHÚC DỮ LIỆU TỪ FILE DISCORD DÙNG CHO ADMIN
        if (command === 'importdata' || command === 'restoredata') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền import khôi phục dữ liệu!');

            const attachment = message.attachments.first();
            if (!attachment) {
                return message.reply('❌ Vui lòng **đính kèm (upload) file .json** backup cần khôi phục cùng với tin nhắn `!importdata`!');
            }

            const fileName = attachment.name;
            let targetPath = null;

            if (fileName.includes('balances')) targetPath = FILES.BALANCES;
            else if (fileName.includes('titles')) targetPath = FILES.TITLES;
            else if (fileName.includes('config')) targetPath = FILES.CONFIG;
            else if (fileName.includes('staffs')) targetPath = FILES.STAFFS;
            else if (fileName.includes('lottery')) targetPath = FILES.LOTTERY;
            else if (fileName.includes('word_config')) targetPath = FILES.WORD_CONFIG;
            else if (fileName.includes('lode_config')) targetPath = FILES.LODE_CONFIG;
            else if (fileName.includes('loans')) targetPath = FILES.LOANS;

            if (!targetPath) {
                return message.reply('❌ File đính kèm không đúng định dạng tên! (Cần chứa một trong các tên: `balances.json`, `titles.json`, `loans.json`, `staffs.json`,...)');
            }

            try {
                const response = await axios.get(attachment.url);
                const importedData = response.data;

                fs.writeFileSync(targetPath, JSON.stringify(importedData, null, 2), 'utf8');

                if (targetPath === FILES.BALANCES) balances = loadJSON(FILES.BALANCES);
                if (targetPath === FILES.TITLES) customTitles = loadJSON(FILES.TITLES);
                if (targetPath === FILES.CONFIG) config = loadJSON(FILES.CONFIG, false);
                if (targetPath === FILES.STAFFS) staffList = loadJSON(FILES.STAFFS, false);
                if (targetPath === FILES.LOTTERY) lotteryData = loadJSON(FILES.LOTTERY, false);
                if (targetPath === FILES.WORD_CONFIG) wordConfig = loadJSON(FILES.WORD_CONFIG, false);
                if (targetPath === FILES.LODE_CONFIG) lodeConfig = loadJSON(FILES.LODE_CONFIG, false);
                if (targetPath === FILES.LOANS) loans = loadJSON(FILES.LOANS);

                return message.reply(`✅ Khôi phục thành công dữ liệu cho file **${fileName}**! Hệ thống đã tự động cập nhật.`);
            } catch (err) {
                console.error('[Import Error]:', err);
                return message.reply('❌ Lỗi khi tải hoặc ghi đè file dữ liệu! Vui lòng kiểm tra định dạng file JSON.');
            }
        }

        // 🛠️ QUẢN LÝ DANH SÁCH STAFF
        if (command === 'addstaff') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền thêm Staff!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Cú pháp: `!addstaff @user`');

            if (staffList.users.includes(targetUser.id)) {
                return message.reply(`⚠️ ${targetUser} đã là Staff rồi!`);
            }

            staffList.users.push(targetUser.id);
            saveJSONSync(FILES.STAFFS, staffList);

            return message.reply(`✅ Đã thêm ${targetUser} vào danh sách **Staff**!`);
        }

        if (command === 'delstaff' || command === 'removestaff') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền xóa Staff!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Cú pháp: `!delstaff @user`');

            if (!staffList.users.includes(targetUser.id)) {
                return message.reply(`⚠️ ${targetUser} không phải là Staff!`);
            }

            staffList.users = staffList.users.filter(id => id !== targetUser.id);
            saveJSONSync(FILES.STAFFS, staffList);

            return message.reply(`🗑️ Đã xóa ${targetUser} khỏi danh sách **Staff**.`);
        }

        if (command === 'stafflist' || command === 'dsstaff') {
            if (staffList.users.length === 0) {
                return message.reply('📌 Hiện chưa có Staff nào trong danh sách.');
            }

            const staffMentions = staffList.users.map((id, index) => `${index + 1}. <@${id}> (\`${id}\`)`).join('\n');
            const embed = new EmbedBuilder()
                .setColor('Aqua')
                .setTitle('🛡️ DANH SÁCH STAFF BẢO TRÌ BOT')
                .setDescription(staffMentions)
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // 💰 LỆNH CỘNG VÀ TRỪ TIỀN
        if (command === 'cong' || command === 'addmoney') {
            if (!isBotStaff(userId)) return message.reply('❌ Chỉ **Staff** hoặc **Bot Owner** mới được dùng lệnh này!');
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);

            if (!targetUser || isNaN(amount) || amount <= 0) {
                return message.reply('❌ Cú pháp: `!cong @user <số_tiền>`');
            }

            let bal = getBalance(targetUser.id);
            bal += amount;
            setBalance(targetUser.id, bal);

            return message.reply(`✅ Đã cộng **+${formatMoney(amount)}** cho ${targetUser}. Số dư mới: **${formatMoney(bal)}**.`);
        }

        if (command === 'tru' || command === 'removemoney') {
            if (!isBotStaff(userId)) return message.reply('❌ Chỉ **Staff** hoặc **Bot Owner** mới được dùng lệnh này!');
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);

            if (!targetUser || isNaN(amount) || amount <= 0) {
                return message.reply('❌ Cú pháp: `!tru @user <số_tiền>`');
            }

            let bal = getBalance(targetUser.id);
            bal = Math.max(0, bal - amount);
            setBalance(targetUser.id, bal);

            return message.reply(`📉 Đã trừ **-${formatMoney(amount)}** của ${targetUser}. Số dư mới: **${formatMoney(bal)}**.`);
        }

        // 👑 LỆNH ĐẶC QUYỀN RIÊNG CỦA BOT OWNER
        if (command === 'resetmoney') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền reset ví!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Hãy tag người cần reset!');

            setBalance(targetUser.id, 50000);
            return message.reply(`🔄 Đã reset ví của ${targetUser} về **50.000đ**.`);
        }

        if (command === 'settitle' || command === 'resettitle') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền chỉnh danh hiệu!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Cú pháp: `!settitle @user <tên_danh_hiệu>`');

            if (command === 'resettitle') {
                customTitles.delete(targetUser.id);
                saveJSONSync(FILES.TITLES, customTitles);
                return message.reply(`🔄 Đã xóa danh hiệu tùy chỉnh của ${targetUser}.`);
            }

            const newTitle = args.slice(1).join(' ');
            if (!newTitle) return message.reply('❌ Vui lòng nhập tên danh hiệu!');

            customTitles.set(targetUser.id, newTitle);
            saveJSONSync(FILES.TITLES, customTitles);

            return message.reply(`✨ Đã đặt danh hiệu cho ${targetUser}: **${newTitle}**`);
        }

        if (command === 'forcedraw') {
            if (!isBotOwner(userId)) return message.reply('❌ Chỉ **Bot Owner (Chủ Bot)** mới có quyền!');
            await processLotteryDraw();
            return message.reply('⚡ Đã ép kích hoạt quay thưởng Xổ Số & Lô Đề!');
        }

        // 🎟️ LỆNH VÉ SỐ & LÔ ĐỀ
        if (['veso', 'muaveso'].includes(command)) {
            const subCmd = args[0]?.toLowerCase();
            const TICKET_PRICE = 10000;

            if (subCmd === 'mua') {
                const number = args[1];
                if (!number || !/^\d{6}$/.test(number)) {
                    return message.reply('❌ Vé số gồm 6 chữ số! Cú pháp: `!veso mua <6_chữ_số>`');
                }

                const bal = getBalance(userId);
                if (bal < TICKET_PRICE) return message.reply(`❌ Bạn không đủ tiền! Giá vé: **${formatMoney(TICKET_PRICE)}**.`);

                setBalance(userId, bal - TICKET_PRICE);
                lotteryData.tickets.push({ userId, number });
                saveJSONSync(FILES.LOTTERY, lotteryData);

                return message.reply(`🎟️ Mua thành công vé số **"${number}"**! Kết quả quay vào **18:00 hàng ngày**.`);
            }

            const myTickets = lotteryData.tickets.filter(t => t.userId === userId);
            const ticketList = myTickets.length > 0 ? myTickets.map(t => `• **${t.number}**`).join('\n') : 'Chưa mua vé nào hôm nay.';

            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('🎟️ VÉ SỐ KIẾN THIẾT (QUAY TỰ ĐỘNG 18:00)')
                .setDescription(`• Giá vé: **${formatMoney(TICKET_PRICE)}/vé**\n• Giải Đặc Biệt: **100.000.000đ**\n\n📌 **Vé của bạn hôm nay:**\n${ticketList}`)
                .setFooter({ text: 'Mua vé: !veso mua <6_chữ_số>' });

            return message.reply({ embeds: [embed] });
        }

        if (['lode', 'de', 'lo'].includes(command)) {
            let type = args[0]?.toLowerCase();
            let num = args[1];
            let bet = parseInt(args[2], 10);

            if (command === 'de' || command === 'lo') {
                type = command;
                num = args[0];
                bet = parseInt(args[1], 10);
            }

            if (!['de', 'lo'].includes(type) || !num || !/^\d{2}$/.test(num) || isNaN(bet) || bet <= 0) {
                return message.reply('❌ Cú pháp Lô Đề:\n• Đề (1 ăn 70): `!lode de <2_chữ_số> <tiền_cược>`\n• Lô (1 ăn 3.5): `!lode lo <2_chữ_số> <tiền_cược>`');
            }

            const bal = getBalance(userId);
            if (bet > bal) return message.reply(`❌ Số dư không đủ! Số dư: **${formatMoney(bal)}**.`);

            setBalance(userId, bal - bet);
            lotteryData.lodeBets.push({ userId, type, number: num, amount: bet });
            saveJSONSync(FILES.LOTTERY, lotteryData);

            return message.reply(`🎯 Đã cược **${type.toUpperCase()}${num}** với **${formatMoney(bet)}**! Trả thưởng lúc **18:00**.`);
        }

        if (['ketqua', 'kqxs'].includes(command)) {
            if (!lotteryData.lastResult) return message.reply('❌ Chưa có kết quả xổ số nào!');
            const res = lotteryData.lastResult;
            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('🎰 KẾT QUẢ XỔ SỐ GẦN NHẤT')
                .addFields(
                    { name: '🏆 Giải Đặc Biệt (Vé Số)', value: `🎉 **${res.specialPrize}**`, inline: false },
                    { name: '🎯 Số Đề', value: `🔥 **${res.specialPrize.slice(-2)}**`, inline: true },
                    { name: '🎲 27 Giải Lô', value: `\`${res.loResults.join(' - ')}\``, inline: false }
                );

            return message.reply({ embeds: [embed] });
        }

        // CÀI ĐẶT KÊNH THÔNG BÁO LÔ ĐỀ 18H
        if (command === 'setlode' || command === 'setlodechannel') {
            const isGuildAdmin = message.member.permissions.has('Administrator');
            if (!isBotStaff(userId) && !isGuildAdmin) return message.reply('❌ Bạn không có quyền Administrator hoặc Staff!');

            const targetChannel = message.mentions.channels.first() || message.channel;
            lodeConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.LODE_CONFIG, lodeConfig);

            return message.reply(`✅ Đã thiết lập kênh thông báo KQXS & Lô Đề (18:00) tại ${targetChannel}.`);
        }

        // CÀI ĐẶT KÊNH TÀI XỈU
        if (command === 'settaixiu' || command === 'setkenhtaixiu') {
            const isGuildAdmin = message.member.permissions.has('Administrator');
            if (!isBotStaff(userId) && !isGuildAdmin) return message.reply('❌ Bạn không có quyền Administrator hoặc Staff!');

            const targetChannel = message.mentions.channels.first() || message.channel;
            const txSession = getSession(guildId);
            txSession.channelId = targetChannel.id;
            saveTaiXiuState(guildId, txSession);

            await message.reply(`✅ Đã thiết lập kênh Tài Xỉu tại ${targetChannel}.`);
            startTaiXiuLoop(guildId, targetChannel.id);
            return;
        }

        // CÀI ĐẶT KÊNH NỐI TỪ
        if (command === 'setnoitu') {
            const isGuildAdmin = message.member.permissions.has('Administrator');
            if (!isBotStaff(userId) && !isGuildAdmin) return message.reply('❌ Bạn không có quyền Administrator hoặc Staff!');

            const targetChannel = message.mentions.channels.first() || message.channel;
            wordConfig[guildId] = targetChannel.id;
            saveJSONSync(FILES.WORD_CONFIG, wordConfig);

            const session = getWordSession(guildId);
            startWordGameTimeout(guildId, targetChannel);

            return message.reply(`✅ Đã thiết lập kênh Nối Từ tại ${targetChannel}.\n🔤 Từ bắt đầu: **"${session.currentWord}"**.`);
        }

        // GAME BLACKJACK
        if (command === 'blackjack' || command === 'bj') {
            const gameKey = `${guildId}_${userId}`;
            if (bjGames.has(gameKey)) return message.reply('❌ Bạn đang trong một ván đấu chưa kết thúc!');

            const bet = parseInt(args[0], 10);
            if (isNaN(bet) || bet <= 0) return message.reply('❌ Cú pháp: `!bj <số_tiền_cược>`');

            const bal = getBalance(userId);
            if (bet > bal) return message.reply(`❌ Số dư không đủ! Hiện có **${formatMoney(bal)}**.`);

            const deck = createDeck();
            const playerHand = [deck.pop(), deck.pop()];
            const dealerHand = [deck.pop(), deck.pop()];

            const timeout = setTimeout(() => bjGames.delete(gameKey), 180000);
            const game = { user: message.author, bet, deck, playerHand, dealerHand, timeout };
            bjGames.set(gameKey, game);

            const playerScore = calculateHand(playerHand);

            if (playerScore === 21 || (playerHand[0].value === 'A' && playerHand[1].value === 'A')) {
                clearTimeout(timeout);
                bjGames.delete(gameKey);

                const embed = new EmbedBuilder()
                    .setColor('Gold')
                    .setTitle(`🃏 BLACKJACK - ${message.author.username}`)
                    .addFields(
                        { name: '🤖 Nhà Cái', value: `${formatHand(dealerHand)} (${calculateHand(dealerHand)} điểm)` },
                        { name: '👤 Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
                    );

                if (playerHand[0].value === 'A' && playerHand[1].value === 'A') {
                    const win = bet * 2;
                    setBalance(userId, bal + win);
                    embed.setDescription(`🔥 **XÌ BÀN!** Thắng lớn **+${formatMoney(win)}**!`);
                } else {
                    const win = Math.floor(bet * 1.5);
                    setBalance(userId, bal + win);
                    embed.setDescription(`🏆 **BLACKJACK TỰ NHIÊN!** Thắng **+${formatMoney(win)}**!`);
                }

                return message.reply({ embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setColor('DarkGreen')
                .setTitle(`🃏 BLACKJACK - ${message.author.username}`)
                .addFields(
                    { name: '🤖 Nhà Cái', value: `${formatHand(dealerHand, true)} (?? điểm)` },
                    { name: '👤 Bạn', value: `${formatHand(playerHand)} (${playerScore} điểm)` }
                )
                .setFooter({ text: `Tiền cược: ${formatMoney(bet)}` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bj_hit').setLabel('🃏 RÚT (HIT)').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('bj_stand').setLabel('🛑 DẰN (STAND)').setStyle(ButtonStyle.Danger)
            );

            return message.reply({ embeds: [embed], components: [row] });
        }

        // LỆNH HƯỚNG DẪN
        if (command === 'hlp' || command === 'giupde') {
            const embed = new EmbedBuilder()
                .setColor('Random')
                .setTitle('📖 BẢNG HƯỚNG DẪN LỆNH BOT')
                .addFields(
                    { name: '💼 Kinh tế & Ngân hàng', value: '`!profile`, `!sodu`, `!daily`, `!work`, `!trom`, `!chuyen`, `!top`\n• **Vay tiền:** `!vay <số_tiền>` (Lãi suất 30%)\n• **Trả nợ:** `!trano <số_tiền|all>`', inline: false },
                    { name: '🎲 Mini-Game', value: '• **Tài Xỉu:** Đặt trực tiếp qua nút bấm.\n• **Blackjack:** `!bj <tiền>`\n• **Nối Từ:** Nhập từ trong kênh game.\n• **Vé Số:** `!veso mua <6_chữ_số>`\n• **Lô Đề:** `!lode de/lo <2_chữ_số> <tiền>`\n• **KQXS:** `!ketqua`', inline: false },
                    { name: '🛡️ Quản trị Staff & Admin', value: '`!cong @user <tiền>`, `!tru @user <tiền>`, `!settaixiu`, `!setnoitu`, `!setlode`, `!noitu reset`', inline: false },
                    { name: '👑 Bot Owner (Chủ Bot)', value: '`!addstaff @user`, `!delstaff @user`, `!stafflist`, `!resetmoney`, `!settitle`, `!forcedraw`, `!exportdata`, `!importdata` (Đính kèm file)', inline: false }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // PROFILE & CÁC LỆNH KINH TẾ
        if (command === 'profile' || command === 'pf') {
            const targetUser = message.mentions.users.first() || message.author;
            const bal = getBalance(targetUser.id);
            const loan = getLoan(targetUser.id);
            
            const sorted = Array.from(balances.entries()).sort((a, b) => b[1] - a[1]);
            const rankIndex = sorted.findIndex(([id]) => id === targetUser.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : 'N/A';

            let title = customTitles.get(targetUser.id);
            if (!title) {
                if (isBotOwner(targetUser.id)) title = '👑 Bot Owner / Admin Tối Cao 👑';
                else if (isBotStaff(targetUser.id)) title = '🛡️ Ban Quản Trị / Staff 🛡️';
                else if (bal >= 10000000) title = 'Tỷ phú sòng bạc 💎';
                else if (bal >= 5000000) title = 'Đại gia khét tiếng 👑';
                else if (bal >= 2000000) title = 'Tay chơi thứ thiệt 🔥';
                else if (bal >= 500000) title = 'Dân chơi tiềm năng ✨';
                else title = 'Người mới bắt đầu 🌱';
            }

            const embed = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle(`🪪 HỒ SƠ - ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '💰 Số dư', value: `**${formatMoney(bal)}**`, inline: true },
                    { name: '💳 Tiền nợ', value: `**${formatMoney(loan)}**`, inline: true },
                    { name: '🏆 BXH Toàn Cầu', value: `**#${rank}**`, inline: true },
                    { name: '🎖️ Danh hiệu', value: `**${title}**`, inline: false }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        if (command === 'balance' || command === 'sodu') {
            return message.reply(`💰 Số dư của bạn: **${formatMoney(getBalance(userId))}**`);
        }

        if (command === 'daily') {
            const now = Date.now();
            const lastDaily = dailyCooldown.get(userId) || 0;
            const cooldown = 86400000;

            if (now - lastDaily < cooldown) {
                const hoursLeft = Math.ceil((cooldown - (now - lastDaily)) / 3600000);
                return message.reply(`⏰ Bạn đã điểm danh hôm nay rồi! Quay lại sau **${hoursLeft} giờ**.`);
            }

            const bonus = 100000;
            const newBal = getBalance(userId) + bonus;
            setBalance(userId, newBal);
            dailyCooldown.set(userId, now);

            return message.reply(`🎁 Nhận điểm danh **${formatMoney(bonus)}**! Số dư mới: **${formatMoney(newBal)}**.`);
        }

        if (command === 'work') {
            const now = Date.now();
            const lastWork = workCooldown.get(userId) || 0;
            const cooldown = 1800000;

            if (now - lastWork < cooldown) {
                const minsLeft = Math.ceil((cooldown - (now - lastWork)) / 60000);
                return message.reply(`☕ Nghỉ ngơi thêm **${minsLeft} phút** nữa nhé!`);
            }

            const jobs = [
                { name: 'phụ hồ', pay: 20000 },
                { name: 'lập trình viên thuê', pay: 80000 },
                { name: 'streamer game', pay: 50000 },
                { name: 'bán vé số', pay: 10000 }
            ];
            const job = jobs[Math.floor(Math.random() * jobs.length)];
            const newBal = getBalance(userId) + job.pay;

            setBalance(userId, newBal);
            workCooldown.set(userId, now);

            return message.reply(`💼 Bạn làm **${job.name}** và nhận được **${formatMoney(job.pay)}**!`);
        }

        if (command === 'trom' || command === 'crime') {
            const now = Date.now();
            const lastCrime = crimeCooldown.get(userId) || 0;
            const cooldown = 3600000;

            if (now - lastCrime < cooldown) {
                const minsLeft = Math.ceil((cooldown - (now - lastCrime)) / 60000);
                return message.reply(`🚨 Cảnh sát đang trực! Quay lại sau **${minsLeft} phút**.`);
            }

            crimeCooldown.set(userId, now);
            let bal = getBalance(userId);

            if (Math.random() < 0.5) {
                const loot = Math.floor(Math.random() * 100000) + 20000;
                setBalance(userId, bal + loot);
                return message.reply(`🦹 Trộm thành công **${formatMoney(loot)}**!`);
            } else {
                const fine = Math.floor(Math.random() * 50000) + 10000;
                setBalance(userId, bal - fine);
                return message.reply(`👮 Bị công an phạt mất **${formatMoney(fine)}**!`);
            }
        }

        if (command === 'chuyen' || command === 'pay') {
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);

            if (!targetUser || isNaN(amount) || amount <= 0) return message.reply('❌ Cú pháp: `!chuyen @user <số_tiền>`');
            if (targetUser.id === userId) return message.reply('❌ Không thể tự chuyển cho chính mình!');

            const senderBal = getBalance(userId);
            if (senderBal < amount) return message.reply(`❌ Số dư không đủ! Hiện có: **${formatMoney(senderBal)}**.`);

            setBalance(userId, senderBal - amount);
            setBalance(targetUser.id, getBalance(targetUser.id) + amount);

            return message.reply(`💸 Đã chuyển **${formatMoney(amount)}** cho ${targetUser}!`);
        }

        if (command === 'top' || command === 'bxh') {
            const sorted = Array.from(balances.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
            let desc = sorted.map(([id, bal], i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🪙';
                return `${medal} **Top ${i + 1}**: <@${id}> - **${formatMoney(bal)}**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🏆 BẢNG XẾP HẠNG ĐẠI GIA TOÀN CẦU 🏆')
                .setDescription(desc || 'Chưa có dữ liệu.')
                .setColor('Gold');

            return message.reply({ embeds: [embed] });
        }

    } catch (err) {
        console.error('[Message Error]:', err);
    }
});

client.login(TOKEN);
