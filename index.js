const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==========================================
// 1. TẠO WEB SERVER GIỮ BOT SỐNG TRÊN RENDER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Discord đang chạy trực tuyến trên Render!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server HTTP đang mở tại port ${PORT} (Dành cho Render Health Check)`);
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
const TOKEN = process.env.TOKEN || 'MTU1MzUxMjIxOTc4NDc3MzY1Mg.Gg7L0Q.yYGP13Si_QmKJdfwKd7pqZVNB63n87LYnhvu88';
const ADMIN_ID = process.env.ADMIN_ID || '1498554147304247296'; 

const FILES = {
    BALANCES: './balances.json',
    TITLES: './titles.json',
    CONFIG: './config.json',
    WORD_CONFIG: './word_config.json'
};

// DATA MANAGERS WITH BUFFERED WRITE
const saveBuffers = new Map();

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

const saveJSON = (file, data) => {
    if (saveBuffers.has(file)) clearTimeout(saveBuffers.get(file));
    
    saveBuffers.set(file, setTimeout(() => {
        const serialized = data instanceof Map ? JSON.stringify(Array.from(data.entries())) : JSON.stringify(data, null, 2);
        fs.writeFile(file, serialized, 'utf8', (err) => {
            if (err) console.error(`[Data Save Error] ${file}:`, err.message);
        });
        saveBuffers.delete(file);
    }, 1000));
};

const balances = loadJSON(FILES.BALANCES);
const customTitles = loadJSON(FILES.TITLES);
const config = loadJSON(FILES.CONFIG, false);
const wordConfig = loadJSON(FILES.WORD_CONFIG, false); // Lưu kênh Nối Từ

const dailyCooldown = new Map();
const workCooldown = new Map();
const crimeCooldown = new Map();
const guildSessions = new Map();
const bjGames = new Map();
const wordGameSessions = new Map(); // Quản lý game Nối từ [guildId => data]

// START WORDS LIST FOR WORD GAME
const START_WORDS = ['phát triển', 'học tập', 'máy tính', 'yêu thương', 'thành công', 'gia đình', 'hy vọng', 'tương lai', 'thành phố', 'văn hóa'];

const getWordSession = (guildId) => {
    if (!wordGameSessions.has(guildId)) {
        const randomWord = START_WORDS[Math.floor(Math.random() * START_WORDS.length)];
        wordGameSessions.set(guildId, {
            currentWord: randomWord,
            lastUserId: null,
            usedWords: new Set([randomWord])
        });
    }
    return wordGameSessions.get(guildId);
};

// HELPER FUNCTIONS
const formatMoney = (amount) => Number(amount).toLocaleString('vi-VN') + 'đ';

const getBalance = (userId) => {
    if (!balances.has(userId)) {
        balances.set(userId, 50000);
        saveJSON(FILES.BALANCES, balances);
    }
    return balances.get(userId);
};

const setBalance = (userId, amount) => {
    balances.set(userId, Math.max(0, amount));
    saveJSON(FILES.BALANCES, balances);
};

const getSession = (guildId) => {
    if (!guildSessions.has(guildId)) {
        guildSessions.set(guildId, {
            isOpen: false,
            sessionNumber: 1,
            bets: new Map(),
            lastOpenMessage: null,
            history: [],
            timeoutId: null
        });
    }
    return guildSessions.get(guildId);
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
    let score = 0;
    let aces = 0;
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
        txSession.timeoutId = setTimeout(runSession, 10000);
    };

    runSession();
}

// EVENTS
client.once('ready', () => {
    console.log(`✅ Bot Casino đã đăng nhập thành công: ${client.user.tag}`);
    for (const [guildId, channelId] of Object.entries(config)) {
        if (channelId) startTaiXiuLoop(guildId, channelId);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;

    try {
        const { guildId, channelId, user } = interaction;
        const targetChannelId = config[guildId];
        const txSession = getSession(guildId);

        if (interaction.isButton() && ['bet_tai', 'bet_xiu'].includes(interaction.customId)) {
            if (channelId !== targetChannelId) {
                return interaction.reply({ content: '❌ Nút chỉ dùng trong kênh cược được thiết lập!', ephemeral: true });
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
                return interaction.reply({ content: '❌ Số tiền cược không hợp lệ!', ephemeral: true });
            }

            const bal = getBalance(user.id);
            if (bet > bal) {
                return interaction.reply({ content: `❌ Số dư không đủ! Số dư hiện tại: **${formatMoney(bal)}**.`, ephemeral: true });
            }

            txSession.bets.set(user.id, { choice, amount: bet });
            await updateOpenEmbed(txSession);

            return interaction.reply({ content: `✅ Đã cược **${formatMoney(bet)}** vào **${choice.toUpperCase()}**!`, ephemeral: true });
        }

        if (interaction.isButton() && ['bj_hit', 'bj_stand'].includes(interaction.customId)) {
            const gameKey = `${guildId}_${user.id}`;
            const game = bjGames.get(gameKey);

            if (!game) {
                return interaction.reply({ content: '❌ Ván đấu đã kết thúc hoặc không tồn tại!', ephemeral: true });
            }

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
        resultMessage = `🤝 **HÒA!** Bằng điểm (${playerScore}). Hoàn lại tiền cược.`;
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

    // ==========================================
    // 3. GAME NỐI TỪ TIẾNG VIỆT
    // ==========================================
    if (wordConfig[guildId] && message.channel.id === wordConfig[guildId]) {
        if (message.content.startsWith(PREFIX)) {
            const args = message.content.slice(PREFIX.length).trim().split(/ +/);
            const cmd = args.shift().toLowerCase();
            if (cmd === 'noitu' && args[0] === 'reset') {
                const newWord = START_WORDS[Math.floor(Math.random() * START_WORDS.length)];
                wordGameSessions.set(guildId, {
                    currentWord: newWord,
                    lastUserId: null,
                    usedWords: new Set([newWord])
                });
                return message.reply(`🔄 Đã reset trò chơi nối từ! Từ bắt đầu mới: **"${newWord}"**`);
            }
        }

        const inputWord = message.content.trim().toLowerCase();
        const wordParts = inputWord.split(/\s+/);

        // Kiểm tra từ ghép đúng 2 tiếng
        if (wordParts.length !== 2) {
            return message.react('❌');
        }

        const wordSession = getWordSession(guildId);
        const lastWordParts = wordSession.currentWord.split(/\s+/);
        const requiredStartWord = lastWordParts[lastWordParts.length - 1]; // Tiếng cuối từ trước

        // Không cho phép 1 người tự nối từ của chính mình
        if (wordSession.lastUserId === userId) {
            await message.reply('⚠️ Lượt vừa rồi là của bạn! Hãy đợi người khác nối tiếp.');
            return message.react('❌');
        }

        // Kiểm tra từ có nối đúng tiếng không
        if (wordParts[0] !== requiredStartWord) {
            await message.reply(`❌ Từ của bạn phải bắt đầu bằng chữ **"${requiredStartWord}"**! Từ hiện tại: **"${wordSession.currentWord}"**`);
            return message.react('❌');
        }

        // Kiểm tra xem từ đã từng dùng chưa
        if (wordSession.usedWords.has(inputWord)) {
            await message.reply(`❌ Từ **"${inputWord}"** đã được sử dụng trước đó rồi!`);
            return message.react('❌');
        }

        // Nối từ thành công
        wordSession.currentWord = inputWord;
        wordSession.lastUserId = userId;
        wordSession.usedWords.add(inputWord);

        const reward = 5000;
        setBalance(userId, getBalance(userId) + reward);

        await message.react('✅');
        return;
    }

    // Các lệnh dùng Prefix `!`
    if (!message.content.startsWith(PREFIX)) return;

    try {
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'setnoitu') {
            const isBotAdmin = userId === ADMIN_ID;
            const isGuildAdmin = message.member.permissions.has('Administrator');

            if (!isBotAdmin && !isGuildAdmin) return message.reply('❌ Bạn không có quyền Administrator!');

            const targetChannel = message.mentions.channels.first() || message.channel;
            wordConfig[guildId] = targetChannel.id;
            saveJSON(FILES.WORD_CONFIG, wordConfig);

            const session = getWordSession(guildId);
            return message.reply(`✅ Đã thiết lập kênh Nối Từ tại ${targetChannel}.\n🔤 Từ khởi đầu hiện tại: **"${session.currentWord}"**`);
        }

        if (command === 'blackjack' || command === 'bj') {
            const gameKey = `${guildId}_${userId}`;
            if (bjGames.has(gameKey)) {
                return message.reply('❌ Bạn đang trong một ván Blackjack chưa hoàn thành!');
            }

            const bet = parseInt(args[0], 10);
            if (isNaN(bet) || bet <= 0) {
                return message.reply('❌ Cú pháp: `!bj <số_tiền_cược>` (VD: `!bj 50000`)');
            }

            const bal = getBalance(userId);
            if (bet > bal) {
                return message.reply(`❌ Số dư không đủ! Bạn chỉ có **${formatMoney(bal)}**.`);
            }

            const deck = createDeck();
            const playerHand = [deck.pop(), deck.pop()];
            const dealerHand = [deck.pop(), deck.pop()];

            const timeout = setTimeout(() => {
                if (bjGames.has(gameKey)) {
                    bjGames.delete(gameKey);
                }
            }, 180000);

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
                    embed.setDescription(`🔥 **XÌ BÀN!** Bạn thắng lớn **+${formatMoney(win)}**!`);
                } else {
                    const win = Math.floor(bet * 1.5);
                    setBalance(userId, bal + win);
                    embed.setDescription(`🏆 **BLACKJACK TỰ NHIÊN!** Bạn nhận **+${formatMoney(win)}**!`);
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

        if (command === 'settaixiu' || command === 'setkenhtaixiu') {
            const isBotAdmin = userId === ADMIN_ID;
            const isGuildAdmin = message.member.permissions.has('Administrator');

            if (!isBotAdmin && !isGuildAdmin) return message.reply('❌ Bạn không có quyền Administrator!');

            const targetChannel = message.mentions.channels.first() || message.channel;
            config[guildId] = targetChannel.id;
            saveJSON(FILES.CONFIG, config);

            await message.reply(`✅ Đã thiết lập kênh Tài Xỉu tại ${targetChannel}. Khởi chạy ngay...`);
            startTaiXiuLoop(guildId, targetChannel.id);
            return;
        }

        if (command === 'hlp' || command === 'giupde') {
            const embed = new EmbedBuilder()
                .setColor('Random')
                .setTitle('📖 BẢNG HƯỚNG DẪN LỆNH')
                .addFields(
                    { name: '💼 Kinh tế', value: '`!profile`, `!sodu`, `!daily`, `!work`, `!trom`, `!chuyen`, `!top`', inline: false },
                    { name: '🎲 Mini-Game', value: '• **Tài Xỉu:** Bấm nút trực tiếp trong kênh cược.\n• **Blackjack:** `!bj <tiền_cược>` hoặc `!blackjack <tiền_cược>`\n• **Nối Từ:** Nhập từ ghép trực tiếp vào kênh nối từ (Cộng +5.000đ/từ).', inline: false },
                    { name: '👑 Admin Server', value: '`!settaixiu [#kênh]`, `!setnoitu [#kênh]`, `!noitu reset`', inline: false },
                    { name: '👑 Admin Bot', value: '`!cong`, `!tru`, `!resetmoney`, `!settitle`, `!resettitle`', inline: false }
                )
                .setFooter({ text: `Yêu cầu bởi ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        if (command === 'profile' || command === 'pf') {
            const targetUser = message.mentions.users.first() || message.author;
            const bal = getBalance(targetUser.id);
            
            const sorted = Array.from(balances.entries()).sort((a, b) => b[1] - a[1]);
            const rankIndex = sorted.findIndex(([id]) => id === targetUser.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : 'N/A';

            let title = customTitles.get(targetUser.id);
            if (!title) {
                if (bal >= 10000000) title = 'Tỷ phú sòng bạc 💎';
                else if (bal >= 5000000) title = 'Đại gia khét tiếng 👑';
                else if (bal >= 2000000) title = 'Tay chơi thứ thiệt 🔥';
                else if (bal >= 500000) title = 'Dân chơi tiềm năng ✨';
                else title = 'Người mới bắt đầu 🌱';
            }
            if (targetUser.id === ADMIN_ID && !customTitles.has(targetUser.id)) {
                title = '👑 Chủ Tịch / Admin Tối Cao 👑';
            }

            const embed = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle(`🪪 HỒ SƠ - ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '💰 Số dư', value: `**${formatMoney(bal)}**`, inline: true },
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

            return message.reply(`🎁 Nhận thành công **${formatMoney(bonus)}**! Số dư mới: **${formatMoney(newBal)}**.`);
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

            return message.reply(`💼 Bạn đi làm **${job.name}** và nhận **${formatMoney(job.pay)}**!`);
        }

        if (command === 'trom' || command === 'crime') {
            const now = Date.now();
            const lastCrime = crimeCooldown.get(userId) || 0;
            const cooldown = 3600000;

            if (now - lastCrime < cooldown) {
                const minsLeft = Math.ceil((cooldown - (now - lastCrime)) / 60000);
                return message.reply(`🚨 Cảnh sát đang tuần tra! Chờ **${minsLeft} phút** nữa.`);
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
                return message.reply(`👮 Bị phạt mất **${formatMoney(fine)}**!`);
            }
        }

        if (command === 'chuyen' || command === 'pay') {
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1], 10);

            if (!targetUser || isNaN(amount) || amount <= 0) {
                return message.reply('❌ Cú pháp: `!chuyen @user <số_tiền>`');
            }
            if (targetUser.id === userId) return message.reply('❌ Không thể tự chuyển tiền cho chính mình!');

            const senderBal = getBalance(userId);
            if (senderBal < amount) return message.reply(`❌ Số dư không đủ! Số dư: **${formatMoney(senderBal)}**.`);

            const receiverBal = getBalance(targetUser.id);
            setBalance(userId, senderBal - amount);
            setBalance(targetUser.id, receiverBal + amount);

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

        if (['cong', 'tru', 'resetmoney'].includes(command)) {
            if (userId !== ADMIN_ID) return message.reply('❌ Quyền hạn không đủ!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Hãy tag thành viên!');

            if (command === 'resetmoney') {
                setBalance(targetUser.id, 50000);
                return message.reply(`🔄 Đã reset ví của ${targetUser} về **50.000đ**.`);
            }

            const amount = parseInt(args[1], 10);
            if (isNaN(amount)) return message.reply('❌ Số tiền không hợp lệ!');

            let bal = getBalance(targetUser.id);
            bal = command === 'cong' ? bal + amount : bal - amount;
            setBalance(targetUser.id, bal);

            return message.reply(`✅ Cập nhật ví của ${targetUser}. Số dư mới: **${formatMoney(bal)}**.`);
        }

        if (command === 'settitle' || command === 'resettitle') {
            if (userId !== ADMIN_ID) return message.reply('❌ Quyền hạn không đủ!');
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.reply('❌ Hãy tag thành viên!');

            if (command === 'resettitle') {
                customTitles.delete(targetUser.id);
                saveJSON(FILES.TITLES, customTitles);
                return message.reply(`🔄 Đã xóa danh hiệu tùy chỉnh của ${targetUser}.`);
            }

            const newTitle = args.slice(1).join(' ');
            if (!newTitle) return message.reply('❌ Vui lòng nhập tên danh hiệu!');

            customTitles.set(targetUser.id, newTitle);
            saveJSON(FILES.TITLES, customTitles);

            return message.reply(`✨ Đã đặt danh hiệu cho ${targetUser}: **${newTitle}**`);
        }
    } catch (err) {
        console.error('[Message Error]:', err);
    }
});

client.login(TOKEN);
