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
const userSessions = new Map();

// ============================================
// INACTIVITY TIMER — 3 minutes
// ============================================
const INACTIVITY_MS = 3 * 60 * 1000; // 3 minutes

function startInactivityTimer(sock, sender) {
  // Clear any existing inactivity timer for this user
  const session = userSessions.get(sender) || {};
  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
  }

  const timer = setTimeout(async () => {
    // Only send if user has no active step (not mid-flow)
    const currentSession = userSessions.get(sender);
    if (!currentSession || !currentSession.step) {
      try {
        await sock.sendMessage(sender, {
          text: `Just checking in! 😊

By the way, how did you hear about us?

Reply with:
📱 *SOCIAL* - Social Media
🔍 *GOOGLE* - Google Search`,
        });
        // Mark that we've asked the source question
        userSessions.set(sender, { ...currentSession, step: "asked_source" });
      } catch (err) {
        console.error("Inactivity message failed:", err.message);
      }
    }
  }, INACTIVITY_MS);

  userSessions.set(sender, { ...session, inactivityTimer: timer });
}

// ============================================
// KEYWORD REPLIES
// ============================================
const keywordReplies = [
  // ===== MAIN GREETING =====
  {
    keywords: ["hi", "hello", "hey", "start", "menu"],
    reply: `Hi there! 👋
Thanks for reaching out to BookMyAssets.

How can we help you today?

Reply with:
📍 DHOLERA - Learn about Dholera Smart City
🏘️ INVEST - Explore premium residential plots
🏗️ PROJECT - Know about WestWyn Estate
💬 OTHER - Something else`,
  },

  // ===== DHOLERA FLOW =====
  {
    keywords: ["dholera"],
    reply: `Dholera Smart City is India's first greenfield smart city under the Delhi-Mumbai Industrial Corridor (DMIC).

Located 100 km from Ahmedabad, it is becoming a major industrial & semiconductor hub with ₹2+ lakh crore corporate commitments, including Tata's ₹91,000 crore semiconductor plant.

What would you like to explore?

Reply with:
📰 NEWS - Latest updates
🏗️ PROJECTS - Mega infrastructure updates
🎥 VIDEOS - Drone footage & expert insights`,
  },

  {
    keywords: ["news"],
    reply: `Here are this week's top Dholera updates:
🔗 https://www.bookmyassets.com/dholera-sir-updates

Reply MENU to return to main options or ADVISOR to speak with our team.`,
  },

  {
    keywords: ["projects"],
    reply: `Dholera's Mega Infrastructure Projects:

✈️ Dholera International Airport (Under construction)
🛣️ Ahmedabad-Dholera Expressway (Operational)
🏭 Tata Semiconductor Plant (Production 2027)
🚇 Proposed Metro Rail Network
⚡ 5,000 MW Asia's Largest Solar Park

🔗 https://www.bookmyassets.com/about-dholera-sir

Reply MENU to return to main options or ADVISOR to speak with our team.`,
  },

  {
    keywords: ["videos"],
    reply: `Watch Dholera's real progress:

🚁 Live Drone Footage
🎥 Expert Analysis & Market Insights

👉 Visit our YouTube channel: https://www.youtube.com/@BookMyAssets

Reply MENU to return to main options.`,
  },

  // ===== INVEST FLOW =====
  {
    keywords: ["invest"],
    reply: `Excellent choice! 🏘️

We offer premium NA-approved residential plots in Dholera starting at just ₹10 Lakh.

What interests you?

Reply with:
✅ PLOTS - View plot options
📞 CALL - Get advisor callback
📍 VISIT - Schedule site visit`,
  },

  {
    keywords: ["plots"],
    reply: `Our flagship project: WestWyn Estate

📍 Location: Vadhela-Navda Highway, near Hebatpur Industrial Zone (TP5)
💰 Starting Price: ₹10 Lakh
✅ NA Approved | Title Clear | AUDA Approved
🛡️ Gated Community | 24/7 Security | EV Charging

🔗 https://www.bookmyassets.com/dholera-residential-plots/westwyn-estate

Reply CALL for personalized guidance or VISIT to schedule site inspection.`,
  },

  {
    keywords: ["call"],
    reply: `Perfect! Our investment advisor will call you within 24 hours.

Please share your details so we can reach you:

👤 *Name:*
📱 *Phone Number:*

_(Reply with your name and phone number)_`,
    nextStep: "collect_contact",
  },

  {
    keywords: ["visit"],
    reply: `Great! We offer free guided site visits every week.

You will receive a callback within 24 hours to confirm your visit booking.`,
  },

  // ===== PROJECT FLOW =====
  {
    keywords: ["project", "westwyn"],
    reply: `WestWyn Estate - Premium Residential Plotting Project 🏘️

📍 Location: Vadhela-Navda Highway, near Hebatpur Industrial Zone (TP5)
💰 Starting Price: ₹10 Lakh
✅ NA Approved | Gated Community | 24/7 Security | EV Charging

Why WestWyn?
• 0 km from Dholera SIR boundary
• 5 min from Ahmedabad-Dholera Expressway
• Near TP5 (2nd largest industrial zone)

Reply ADVISOR for personalized guidance or VISIT to schedule site inspection.`,
  },

  {
    keywords: ["contact"],
    reply: `BookMyAssets - Dholera Experts

📞 Phone: +91 81 30 37 16 47
📧 Email: info@bookmyassets.com
🌐 Website: www.bookmyassets.com

🏢 Office:
620, JMD Megapolis, Sector 48,
Gurugram, Haryana 122001

Business Hours:
Mon-Sat, 10 AM - 7 PM

Reply MENU to return to main options.`,
  },

  {
    keywords: ["hiring"],
    reply: `Interested in joining BookMyAssets?

Send resume to:
📧 hr@bookmyassets.com

Or call HR:
📞 +91 97 17 67 11 12`,
  },

  {
    keywords: ["channel"],
    reply: `Interested in becoming a Channel Partner? 🤝

Benefits:
✅ High commission structure
✅ Marketing support
✅ Dedicated relationship manager
✅ Timely payouts

Apply here:
https://www.bookmyassets.com/channel-partner

Or call:
📞 +91 81 30 37 16 47`,
  },

  {
    keywords: ["question"],
    reply: `Sure! Please type your question.

Our team responds within 1-2 hours during business hours (Mon-Sat, 10 AM - 7 PM).

For urgent queries:
📞 +91 81 30 37 16 47`,
  },

  // ===== ADVISOR KEYWORD =====
  {
    keywords: ["advisor", "Advisor"],
    reply: `Our investment advisor will contact you shortly.

Please share your details:

👤 *Name:*
📱 *Phone Number:*

_(Reply with your name and phone number)_`,
    nextStep: "collect_contact",
  },

  // ===== OTHER FLOW =====
  {
    keywords: ["other"],
    reply: `No problem! How else can we assist you?

Reply with:
📞 CONTACT - Office address & phone number
🌐 HIRING - Join our team
📲 CHANNEL - Become a channel partner
❓ QUESTION - Ask anything specific`,
  },

  // ===== SOURCE TRACKING =====
  {
    keywords: ["social"],
    reply: `Thanks for letting us know! 📱 Social media is a great way to stay updated.

Is there anything else we can help you with?
Reply MENU to explore our options.`,
  },
  {
    keywords: ["google"],
    reply: `Thanks for letting us know! 🔍 Glad you found us on Google.

Is there anything else we can help you with?
Reply MENU to explore our options.`,
  },
];

const DEFAULT_REPLY = `Sorry, I didn't understand that. 😅

Reply with one of these keywords:
DHOLERA | INVEST | PROJECT | OTHER | MENU`;

function getReplyEntry(text) {
  const lowerText = text.toLowerCase().trim();
  const words = lowerText.split(/\s+/);

  for (const entry of keywordReplies) {
    for (const keyword of entry.keywords) {
      if (words.includes(keyword.toLowerCase())) {
        return entry;
      }
    }
  }
  return null;
}

// ============================================
// BOT START
// ============================================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    auth: state,
    logger: logger,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      botStatus = "📱 Waiting for QR scan...";
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

  if (!text) return;

  const session = userSessions.get(sender) || {};

  // ── STEP: Collecting name & phone ──
  if (session.step === "collect_contact") {
    // Cancel inactivity timer
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || "Not provided";
    const phone = lines[1] || "Not provided";

    await sock.sendMessage(sender, {
      text: `Thank you, *${name}*! ✅

Our advisor will contact you soon on *${phone}*.

Please share your preferred call time:
🌅 Morning
☀️ Afternoon  
🌙 Evening

Or call us directly:
📞 +91 81 30 37 16 47`,
    });

    // Clear session and restart inactivity timer
    userSessions.set(sender, {});
    startInactivityTimer(sock, sender);
    repliedMessages.add(messageId);
    return;
  }

  // ── STEP: User replied to "where did you hear about us" ──
  if (session.step === "asked_source") {
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    const lower = text.toLowerCase().trim();
    let sourceReply = "";

    if (lower.includes("social")) {
      sourceReply = `Thanks for letting us know! 📱 Social media is a great way to stay connected.\n\nReply MENU to explore more options.`;
    } else if (lower.includes("google")) {
      sourceReply = `Thanks for letting us know! 🔍 Glad you found us on Google.\n\nReply MENU to explore more options.`;
    } else {
      sourceReply = `Thanks for sharing! 😊\n\nReply MENU to explore our options.`;
    }

    await sock.sendMessage(sender, { text: sourceReply });
    userSessions.set(sender, {});
    startInactivityTimer(sock, sender);
    repliedMessages.add(messageId);
    return;
  }

  console.log(`📩 From ${sender}: ${text}`);

  // Reset inactivity timer on every message
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

  const entry = getReplyEntry(text);
  const reply = entry ? entry.reply : DEFAULT_REPLY;

  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sock.sendMessage(sender, { text: reply });
    repliedMessages.add(messageId);
    console.log(`✅ Replied to ${sender}`);

    // If this keyword triggers a multi-step flow, set the session step
    if (entry?.nextStep) {
      userSessions.set(sender, { step: entry.nextStep });
      // Don't start inactivity timer during active flows
    } else {
      // Start/reset inactivity timer for normal replies
      startInactivityTimer(sock, sender);
    }
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