const {  
  default: makeWASocket,  
  useMultiFileAuthState,  
  DisconnectReason,  
} = require("@whiskeysockets/baileys");  
  
const qrcode = require("qrcode-terminal");  
const QRCode = require("qrcode"); // Generates QR as image/base64  
const http = require("http");  
const pino = require("pino");  
const fs = require("fs");  
  
// ============================================  
// STORE LATEST QR FOR WEB PAGE  
// ============================================  
let latestQR = null;  
let botStatus = "⏳ Starting...";  
  
// ============================================  
// WEB SERVER — View QR code in browser!  
// Visit your Railway URL to scan QR  
// ============================================  
const PORT = process.env.PORT || 3000;  
  
http  
  .createServer(async (req, res) => {  
    // Main page — shows QR or status  
    if (req.url === "/" || req.url === "/qr") {  
      res.writeHead(200, { "Content-Type": "text/html" });  
  
      if (latestQR) {  
        // Generate QR as base64 image  
        const qrImageDataURL = await QRCode.toDataURL(latestQR, {  
          width: 400,  
          margin: 2,  
        });  
  
        res.end(`  
          <!DOCTYPE html>  
          <html>  
          <head>  
            <title>WhatsApp Bot - Scan QR</title>  
            <meta http-equiv="refresh" content="10">  
            <style>  
              body {  
                font-family: Arial, sans-serif;  
                display: flex;  
                flex-direction: column;  
                align-items: center;  
                justify-content: center;  
                min-height: 100vh;  
                margin: 0;  
                background: #0a1628;  
                color: white;  
              }  
              .container {  
                text-align: center;  
                background: #1a2742;  
                padding: 40px;  
                border-radius: 20px;  
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);  
              }  
              img {  
                border-radius: 10px;  
                margin: 20px 0;  
              }  
              .status { color: #ffa500; font-size: 18px; }  
              .steps {   
                text-align: left;   
                background: #0d1b2a;   
                padding: 20px;   
                border-radius: 10px;   
                margin-top: 20px;  
              }  
              .steps li { margin: 8px 0; }  
            </style>  
          </head>  
          <body>  
            <div class="container">  
              <h1>📱 Scan QR Code</h1>  
              <p class="status">Status: Waiting for scan...</p>  
              <img src="${qrImageDataURL}" alt="QR Code" />  
              <div class="steps">  
                <h3>Steps:</h3>  
                <ol>  
                  <li>Open <b>WhatsApp</b> on your phone</li>  
                  <li>Go to <b>Settings → Linked Devices</b></li>  
                  <li>Tap <b>"Link a Device"</b></li>  
                  <li>Scan the QR code above</li>  
                </ol>  
              </div>  
              <p style="color: #666; font-size: 12px;">  
                Page auto-refreshes every 10 seconds  
              </p>  
            </div>  
          </body>  
          </html>  
        `);  
      } else {  
        // No QR — bot is either connected or starting  
        res.end(`  
          <!DOCTYPE html>  
          <html>  
          <head>  
            <title>WhatsApp Bot Status</title>  
            <meta http-equiv="refresh" content="5">  
            <style>  
              body {  
                font-family: Arial, sans-serif;  
                display: flex;  
                align-items: center;  
                justify-content: center;  
                min-height: 100vh;  
                margin: 0;  
                background: #0a1628;  
                color: white;  
              }  
              .container {  
                text-align: center;  
                background: #1a2742;  
                padding: 40px;  
                border-radius: 20px;  
              }  
              .status-icon { font-size: 80px; }  
            </style>  
          </head>  
          <body>  
            <div class="container">  
              <div class="status-icon">  
                ${botStatus.includes("ONLINE") ? "✅" : "⏳"}  
              </div>  
              <h1>${botStatus}</h1>  
              <p style="color: #888;">Page auto-refreshes every 5 seconds</p>  
            </div>  
          </body>  
          </html>  
        `);  
      }  
    }  
    // Health check endpoint  
    else if (req.url === "/health") {  
      res.writeHead(200, { "Content-Type": "application/json" });  
      res.end(JSON.stringify({ status: "running", bot: botStatus }));  
    } else {  
      res.writeHead(302, { Location: "/" });  
      res.end();  
    }  
  })  
  .listen(PORT, () => {  
    console.log(`🌐 Web server running on port ${PORT}`);  
    console.log(`📱 Open your Railway URL in browser to scan QR!`);  
  });  
  
// ============================================  
// AUTH DIRECTORY  
// ============================================  
const AUTH_DIR = "./auth_info";  
if (!fs.existsSync(AUTH_DIR)) {  
  fs.mkdirSync(AUTH_DIR, { recursive: true });  
}  
  
// ============================================  
// TRACKING  
// ============================================  
const repliedMessages = new Set();  
let botStartTime = Date.now();  
  
// ============================================  
// KEYWORD REPLIES  
// ============================================  
const keywordReplies = [  
  {  
    keywords: ["hi", "hello", "hey", "hii", "hiii", "helo"],  
    reply: "Hi! 👋 How can we help you today?",  
  },  
  {  
    keywords: [  
      "what is dholera",  
      "dholera kya hai",  
      "about dholera",  
      "dholera",  
    ],  
    reply: `🏙️ *Dholera* is an upcoming Greenfield Smart City — a dream project of Honorable PM Narendra Modi.  
  
It is India's first smart city being built from scratch under the DMIC (Delhi-Mumbai Industrial Corridor) project.  
  
Would you like to know about our plot offerings? Type *"price"* to know more!`,  
  },  
  {  
    keywords: ["price", "rate", "cost", "kitna", "amount", "plot"],  
    reply: `💰 *Our Offering:*  
  
✅ Residential Plots under *₹10 Lakh*  
📍 0 KM from SIR (Special Investment Region)  
🛣️ 5 min from Dholera-Ahmedabad Expressway  
📐 Multiple sizes available  
  
Would you like to schedule a *free site visit*? 🚗  
Type *"visit"* to book now!`,  
  },  
  {  
    keywords: ["visit", "site visit", "book", "dekhna hai"],  
    reply: `🚗 *Site Visit Booking*  
  
We offer *FREE pickup & drop* for site visits!  
  
📞 Please share:  
1️⃣ Your Name  
2️⃣ Preferred Date  
3️⃣ Number of People  
  
Our team will confirm your visit shortly! ✅`,  
  },  
  {  
    keywords: ["location", "kahan hai", "where", "map"],  
    reply: `📍 *Location:*  
  
Dholera Smart City, Gujarat  
🛣️ 100 KM from Ahmedabad  
✈️ Near upcoming Dholera International Airport  
🚄 On Delhi-Mumbai Industrial Corridor  
  
Google Maps: https://maps.google.com/?q=Dholera+Smart+City`,  
  },  
  {  
    keywords: ["thank", "thanks", "dhanyawad", "shukriya"],  
    reply:  
      "You're welcome! 😊 Feel free to ask anything anytime. We're here to help! 🙏",  
  },  
];  
  
const DEFAULT_REPLY = `Thanks for your message! 🙏  
  
Here's what I can help you with:  
1️⃣ Type *"Dholera"* — Know about Dholera Smart City  
2️⃣ Type *"Price"* — Get plot pricing details  
3️⃣ Type *"Visit"* — Book a free site visit  
4️⃣ Type *"Location"* — Get location details  
  
Or just ask your question and our team will respond shortly! 😊`;  
  
function getReply(text) {  
  const lowerText = text.toLowerCase().trim();  
  for (const entry of keywordReplies) {  
    for (const keyword of entry.keywords) {  
      if (lowerText.includes(keyword.toLowerCase())) {  
        return entry.reply;  
      }  
    }  
  }  
  return DEFAULT_REPLY;  
}  
  
// ============================================  
// BOT START  
// ============================================  
async function startBot() {  
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);  
  
  // ✅ FIX: Baileys v7 REQUIRES a pino logger  
  const logger = pino({ level: "silent" });  
  
  const sock = makeWASocket({  
    auth: state,  
    logger: logger,  
    syncFullHistory: false,  
    // REMOVED: printQRInTerminal (deprecated in v7)  
  });  
  
  sock.ev.on("creds.update", saveCreds);  
  
  sock.ev.on("connection.update", (update) => {  
    const { connection, lastDisconnect, qr } = update;  
  
    if (qr) {  
      // ✅ Store QR for web page (Railway solution!)  
      latestQR = qr;  
      botStatus = "📱 Waiting for QR scan...";  
  
      // Also show in terminal (works locally)  
      console.log("\n📱 QR Code received!");  
      console.log("👉 Open your Railway URL in browser to scan!\n");  
      qrcode.generate(qr, { small: true });  
    }  
  
    if (connection === "close") {  
      latestQR = null;  
      const statusCode = lastDisconnect?.error?.output?.statusCode;  
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;  
  
      console.log(  
        `❌ Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`  
      );  
      botStatus = `❌ Disconnected (${statusCode})`;  
  
      if (shouldReconnect) {  
        setTimeout(() => startBot(), 5000);  
      } else {  
        botStatus = "🚫 Logged out. Delete auth_info and redeploy.";  
      }  
    } else if (connection === "open") {  
      // ✅ Connected! Clear QR  
      latestQR = null;  
      botStartTime = Date.now();  
      botStatus = "✅ ONLINE and running!";  
  
      console.log("═══════════════════════════════════");  
      console.log("✅ Bot is ONLINE and ready!");  
      console.log(`📋 Loaded ${keywordReplies.length} keyword groups`);  
      console.log(`⏰ ${new Date().toISOString()}`);  
      console.log("═══════════════════════════════════");  
    }  
  });  
  
  sock.ev.on("messages.upsert", async ({ messages, type }) => {  
    if (type !== "notify") return;  
    for (const msg of messages) {  
      await handleMessage(sock, msg);  
    }  
  });  
}  
  
async function handleMessage(sock, msg) {  
  if (!msg.message) return;  
  if (msg.key.remoteJid === "status@broadcast") return;  
  
  const sender = msg.key.remoteJid;  
  if (sender.endsWith("@g.us")) return;  
  if (msg.key.fromMe) return;  
  
  const msgTime = (msg.messageTimestamp || 0) * 1000;  
  if (msgTime < botStartTime) return;  
  
  const messageId = msg.key.id;  
  if (repliedMessages.has(messageId)) return;  
  
  const messageType = Object.keys(msg.message)[0];  
  if (  
    messageType === "protocolMessage" ||  
    messageType === "senderKeyDistributionMessage" ||  
    messageType === "messageContextInfo"  
  ) {  
    return;  
  }  
  
  const text =  
    msg.message.conversation ||  
    msg.message.extendedTextMessage?.text ||  
    "";  
  
  console.log(`📩 From ${sender}: ${text || `[${messageType}]`}`);  
  
  const reply = text ? getReply(text) : DEFAULT_REPLY;  
  
  try {  
    await new Promise((resolve) => setTimeout(resolve, 500));  
    await sock.sendMessage(sender, { text: reply });  
    repliedMessages.add(messageId);  
    console.log(`✅ Replied to ${sender}`);  
  } catch (error) {  
    console.error(`❌ Failed: ${error.message}`);  
  }  
  
  // Memory cleanup  
  if (repliedMessages.size > 10000) {  
    const arr = [...repliedMessages];  
    arr.slice(0, 5000).forEach((id) => repliedMessages.delete(id));  
  }  
}  
  
process.on("uncaughtException", (err) => {  
  console.error("Uncaught Exception:", err);  
});  
process.on("unhandledRejection", (err) => {  
  console.error("Unhandled Rejection:", err);  
});  
  
startBot();  
