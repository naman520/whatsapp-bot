const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const http = require("http");
const pino = require("pino");
const fs = require("fs");
const { Boom } = require("@hapi/boom"); // Add this import

// ============================================
// CONFIGURATION
// ============================================
const ADMIN_NUMBER = "918920563009@s.whatsapp.net"; // Replace with your admin number (include country code, no +)
const AUTH_DIR = "./auth_info";
const INACTIVITY_MS = 3 * 60 * 1000; // 3 minutes

// ============================================
// STORE LATEST QR FOR WEB PAGE
// ============================================
let latestQR = null;
let botStatus = "⏳ Starting...";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================
// WEB SERVER
// ============================================
const PORT = process.env.PORT || 3000;

// Keep-alive for web server (prevents Railway from sleeping)
setInterval(
  () => {
    http
      .get(`http://localhost:${PORT}/health`, (res) => {
        // Just a ping to keep the server alive
      })
      .on("error", (err) => {
        // Ignore errors
      });
  },
  5 * 60 * 1000,
); // Every 5 minutes

http
  .createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/qr") {
      res.writeHead(200, { "Content-Type": "text/html" });

      if (latestQR) {
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
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "running", bot: botStatus }));
    } else {
      res.writeHead(302, { Location: "/" });
      res.end();
    }
  })
  .listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

// ============================================
// AUTH DIRECTORY
// ============================================
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
// HELPER FUNCTIONS
// ============================================
function formatPhoneNumber(jid) {
  return jid.split("@")[0];
}

async function notifyAdmin(sock, message) {
  try {
    await sock.sendMessage(ADMIN_NUMBER, { text: message });
    console.log(`📢 Admin notified: ${message.substring(0, 50)}...`);
  } catch (error) {
    console.error("Failed to notify admin:", error.message);
  }
}

function startInactivityTimer(sock, sender) {
  const session = userSessions.get(sender) || {};
  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
  }

  const timer = setTimeout(async () => {
    const currentSession = userSessions.get(sender);
    if (!currentSession || !currentSession.step) {
      try {
        await sock.sendMessage(sender, {
          text: `Hi! 👋
Just checking in, did you get the information you needed about Dholera plots?
Reply ADVISOR if you would like to discuss further or MENU to explore more options.
We are here to help! 😊`,
        });
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
  {
    keywords: ["hi", "hello", "hey", "start", "menu"],
    reply: `Hi there! 👋
Thanks for reaching out to Dholera Times.

How can we help you today?

Reply with:
📍 DHOLERA - Learn about Dholera Smart City
🏘️ INVEST - Explore premium residential plots
🏗️ PROJECT - Know about WestWyn Estate
💬 OTHER - Something else`,
  },
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
🔗 https://www.dholeratimes.com/dholera-updates/latest-updates

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

🔗 https://www.DholeraTimes.com/dholera-sir

Reply MENU to return to main options or ADVISOR to speak with our team.`,
  },
  {
    keywords: ["videos"],
    reply: `Watch Dholera's real progress:

🚁 Live Drone Footage
🎥 Expert Analysis & Market Insights

👉 Visit our YouTube channel: https://www.youtube.com/@dholeratimes

Reply MENU to return to main options.`,
  },
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

🔗 https://www.DholeraTimes.com/dholera-residential-plots/westwyn-estate

Reply CALL for personalized guidance or VISIT to schedule site inspection.`,
  },
  {
    keywords: ["call"],
    reply: `Perfect! Our investment advisor will call you within 24 hours.

Please share your details. You can use either format:

📝 *Simple format* (just type one after another):
naman
9999999999
evening

📝 *Detailed format* (with labels):
Name: naman
Phone: 9999999999
Time: evening

Our team will reach out to you soon!`,
    nextStep: "collect_contact",
  },
  {
    keywords: ["visit"],
    reply: `Great! We offer free guided site visits every week.

You will receive a callback within 24 hours to confirm your visit booking.

Please share your details. You can use either format:

📝 *Simple format* (just type one after another):
naman
9999999999
next Monday

📝 *Detailed format* (with labels):
Name: naman
Phone: 9999999999
Date: next Monday`,
    nextStep: "collect_visit",
  },
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
    reply: `Dholera Times - Dholera Experts

📞 Phone: +91 99 58 99 35 49
📧 Email: info@dholeraimes.com
🌐 Website: www.DholeraTimes.com

🏢 Office:
620, JMD Megapolis, Sector 48,
Gurugram, Haryana 122001

Business Hours:
Mon-Sat, 10 AM - 7 PM

Reply MENU to return to main options.`,
  },
 /*  {
    keywords: ["hiring"],
    reply: `Interested in joining Dholera Times?

Send resume to:
📧 hr@DholeraTimes.com

Or call HR:
📞 +91 97 17 67 11 12`,
  }, */
  {
    keywords: ["channel"],
    reply: `Interested in becoming a Channel Partner? 🤝

Benefits:
✅ High commission structure
✅ Marketing support
✅ Dedicated relationship manager
✅ Timely payouts

Apply here:
https://www.DholeraTimes.com/channel-partner

Or call:
📞 +91 99 58 99 35 49`,
  },
  {
    keywords: ["question"],
    reply: `Sure! Please type your question.

Our team responds within 1-2 hours during business hours (Mon-Sat, 10 AM - 7 PM).

For urgent queries:
📞 +91 99 58 99 35 49`,
  },
  {
    keywords: ["advisor", "Advisor"],
    reply: `Our investment advisor will contact you shortly.

Please share your details. You can use either format:

📝 *Simple format* (just type one after another):
naman
9999999999
evening

📝 *Detailed format* (with labels):
Name: naman
Phone: 9999999999
Time: evening

Our team will reach out to you soon!`,
    nextStep: "collect_contact",
  },
  {
    keywords: ["other"],
    reply: `No problem! How else can we assist you?

Reply with:
📞 CONTACT - Office address & phone number
🌐 HIRING - Join our team
📲 CHANNEL - Become a channel partner
❓ QUESTION - Ask anything specific`,
  },
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
// BOT START WITH IMPROVED CONNECTION HANDLING
// ============================================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const logger = pino({ level: "silent" });

  // Get latest version
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger: logger,
    printQRInTerminal: false, // We'll handle QR manually
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    // Add these options for better connection
    keepAliveIntervalMs: 30000, // Send keep-alive every 30 seconds
    retryRequestDelayMs: 500,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 60000,
    maxMsgRetryCount: 5,
    shouldIgnoreJid: (jid) => jid === "status@broadcast",
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      botStatus = "📱 Waiting for QR scan...";
      reconnectAttempts = 0; // Reset reconnect attempts on new QR
      console.log("\n📱 QR Code received!");
      console.log("👉 Open your Railway URL in browser to scan!\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      latestQR = null;

      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect?.error?.output?.statusCode
          : lastDisconnect?.error?.message;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS;

      console.log(
        `❌ Connection closed. Status: ${statusCode}. Attempt: ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`,
      );

      botStatus = `❌ Disconnected (${statusCode}) - Attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`;

      if (shouldReconnect) {
        reconnectAttempts++;
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
        console.log(`🔄 Reconnecting in ${delay / 1000} seconds...`);
        setTimeout(() => startBot(), delay);
      } else if (statusCode === DisconnectReason.loggedOut) {
        botStatus = "🚫 Logged out. Delete auth_info and restart.";
        console.log(
          "🚫 Logged out. Please delete auth_info folder and restart.",
        );
        // Optionally delete auth folder on logout
        // fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      } else {
        botStatus = "❌ Max reconnection attempts reached. Restart manually.";
        console.log(
          "❌ Max reconnection attempts reached. Please restart manually.",
        );
      }
    } else if (connection === "open") {
      latestQR = null;
      botStartTime = Date.now();
      botStatus = "✅ ONLINE and running!";
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection

      console.log("═══════════════════════════════════");
      console.log("✅ Bot is ONLINE and ready!");
      console.log(`📋 Loaded ${keywordReplies.length} keyword groups`);
      console.log(`⏰ ${new Date().toISOString()}`);
      console.log("═══════════════════════════════════");

      // Notify admin that bot is online
      notifyAdmin(sock, "🤖 WhatsApp Bot is now ONLINE and ready to respond!");

      // Set up keep-alive ping
      setInterval(() => {
        if (sock.ws && sock.ws.readyState === 1) {
          // WebSocket.OPEN
          sock.sendPresenceUpdate("available");
        }
      }, 60000); // Send presence every minute
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleMessage(sock, msg);
    }
  });

  return sock;
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
    msg.message.conversation || msg.message.extendedTextMessage?.text || "";

  if (!text) return;

  const session = userSessions.get(sender) || {};
  const senderNumber = formatPhoneNumber(sender);

  // ── STEP: Collecting contact details (for call requests) ──
  if (session.step === "collect_contact") {
    // Cancel inactivity timer
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    // Parse the user's message to extract name, phone, and time
    const lines = text
      .split("\n")
      .map((l) => (l ? l.trim() : ""))
      .filter((l) => l.length > 0);

    let name = "Not provided";
    let phone = "Not provided";
    let time = "Not specified";

    try {
      // Check if this is a simple format (just name and phone on separate lines)
      if (
        lines.length >= 2 &&
        !lines[0].toLowerCase().includes("name:") &&
        !lines[0].toLowerCase().includes("phone:")
      ) {
        // Simple format: first line is name, second line is phone
        name = lines[0] || "Not provided";
        phone = lines[1] || "Not provided";

        // If there's a third line, treat it as preferred time
        if (lines.length >= 3) {
          time = lines[2] || "Not specified";
        }
      } else {
        // Try to extract labeled information
        for (const line of lines) {
          if (!line) continue;

          const lowerLine = line.toLowerCase();
          if (lowerLine.includes("name:")) {
            const parts = line.split("name:");
            if (parts.length > 1) name = parts[1].trim() || name;
          } else if (
            lowerLine.includes("phone:") ||
            lowerLine.includes("mobile:") ||
            lowerLine.includes("number:")
          ) {
            const parts = line.split(/phone:|mobile:|number:/i);
            if (parts.length > 1) phone = parts[1].trim() || phone;
          } else if (
            lowerLine.includes("time:") ||
            lowerLine.includes("preferred time:")
          ) {
            const parts = line.split(/time:|preferred time:/i);
            if (parts.length > 1) time = parts[1].trim() || time;
          }
        }

        // If labeled parsing didn't find name and phone, try to extract from lines
        if (name === "Not provided" && phone === "Not provided") {
          // Try to identify which line is phone number (contains digits)
          let phoneLineIndex = -1;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Check if line contains digits (phone number)
            if (/\d{10,}/.test(line.replace(/[\s\-+]/g, ""))) {
              phoneLineIndex = i;
              phone = line;
              break;
            }
          }

          // If we found a phone line, assume the first non-phone line is name
          if (phoneLineIndex > -1) {
            // Look for name in other lines
            for (let i = 0; i < lines.length; i++) {
              if (
                i !== phoneLineIndex &&
                lines[i] &&
                !lines[i].includes("time:")
              ) {
                name = lines[i];
                break;
              }
            }
          } else if (lines.length > 0) {
            // No phone number found, just use first line as name
            name = lines[0] || "Not provided";
          }
        }
      }

      // Clean up phone number (remove spaces, dashes, etc.)
      if (phone !== "Not provided") {
        phone = phone.replace(/[\s\-+()]/g, "");
      }
    } catch (parseError) {
      console.error("Error parsing contact details:", parseError.message);
      // If parsing fails, use the whole message as fallback
      if (lines.length > 0) {
        name = lines[0] || "Not provided";
        if (lines.length > 1) phone = lines[1] || "Not provided";
        if (lines.length > 2) time = lines[2] || "Not specified";
      }
    }

    // Send confirmation to user
    await sock.sendMessage(sender, {
      text: `Thank you, *${name}*! ✅

Your details have been recorded:
📱 Phone: ${phone}
⏰ Preferred Time: ${time}

Our advisor will contact you soon.

For immediate assistance, call us:
📞 +91 99 58 99 35 49`,
    });

    // Send admin notification
    const adminMessage = `📞 *New Callback Request*
━━━━━━━━━━━━━━━━━━
👤 *Name:* ${name}
📱 *Phone:* ${phone}
⏰ *Preferred Time:* ${time}
📱 *User WhatsApp:* ${senderNumber}

Please contact them within 24 hours.`;

    await notifyAdmin(sock, adminMessage);

    // Clear session and restart inactivity timer
    userSessions.set(sender, {});
    startInactivityTimer(sock, sender);
    repliedMessages.add(messageId);
    return;
  }

  // ── STEP: Collecting visit details ──
  if (session.step === "collect_visit") {
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    // Safely split and filter lines
    const lines = text
      .split("\n")
      .map((l) => (l ? l.trim() : ""))
      .filter((l) => l.length > 0);

    let name = "Not provided";
    let phone = "Not provided";
    let date = "Not specified";

    try {
      // Check if this is a simple format
      if (
        lines.length >= 2 &&
        !lines[0].toLowerCase().includes("name:") &&
        !lines[0].toLowerCase().includes("phone:")
      ) {
        // Simple format: first line is name, second line is phone
        name = lines[0] || "Not provided";
        phone = lines[1] || "Not provided";

        // If there's a third line, treat it as preferred date
        if (lines.length >= 3) {
          date = lines[2] || "Not specified";
        }
      } else {
        // Try to extract labeled information
        for (const line of lines) {
          if (!line) continue;

          const lowerLine = line.toLowerCase();
          if (lowerLine.includes("name:")) {
            const parts = line.split("name:");
            if (parts.length > 1) name = parts[1].trim() || name;
          } else if (
            lowerLine.includes("phone:") ||
            lowerLine.includes("mobile:")
          ) {
            const parts = line.split(/phone:|mobile:/i);
            if (parts.length > 1) phone = parts[1].trim() || phone;
          } else if (
            lowerLine.includes("date:") ||
            lowerLine.includes("preferred date:")
          ) {
            const parts = line.split(/date:|preferred date:/i);
            if (parts.length > 1) date = parts[1].trim() || date;
          }
        }

        // If labeled parsing didn't find name and phone, try to extract from lines
        if (name === "Not provided" && phone === "Not provided") {
          let phoneLineIndex = -1;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/\d{10,}/.test(line.replace(/[\s\-+]/g, ""))) {
              phoneLineIndex = i;
              phone = line;
              break;
            }
          }

          if (phoneLineIndex > -1) {
            for (let i = 0; i < lines.length; i++) {
              if (
                i !== phoneLineIndex &&
                lines[i] &&
                !lines[i].includes("date:")
              ) {
                name = lines[i];
                break;
              }
            }
          } else if (lines.length > 0) {
            name = lines[0] || "Not provided";
          }
        }
      }

      // Clean up phone number
      if (phone !== "Not provided") {
        phone = phone.replace(/[\s\-+()]/g, "");
      }
    } catch (parseError) {
      console.error("Error parsing visit details:", parseError.message);
      if (lines.length > 0) {
        name = lines[0] || "Not provided";
        if (lines.length > 1) phone = lines[1] || "Not provided";
        if (lines.length > 2) date = lines[2] || "Not specified";
      }
    }

    await sock.sendMessage(sender, {
      text: `Thank you, *${name}*! ✅

Your site visit request for *${date}* has been recorded.

Our team will contact you on *${phone}* within 24 hours to confirm your visit.`,
    });

    const adminMessage = `📍 *New Site Visit Request*
━━━━━━━━━━━━━━━━━━
👤 *Name:* ${name}
📱 *Phone:* ${phone}
📅 *Preferred Date:* ${date}
📱 *User WhatsApp:* ${senderNumber}

Please contact them to confirm the visit.`;

    await notifyAdmin(sock, adminMessage);

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

      // Notify admin about source
      notifyAdmin(
        sock,
        `📊 *Lead Source Update*\nUser ${senderNumber} heard about us via *SOCIAL MEDIA*`,
      );
    } else if (lower.includes("google")) {
      sourceReply = `Thanks for letting us know! 🔍 Glad you found us on Google.\n\nReply MENU to explore more options.`;

      // Notify admin about source
      notifyAdmin(
        sock,
        `📊 *Lead Source Update*\nUser ${senderNumber} heard about us via *GOOGLE SEARCH*`,
      );
    } else {
      sourceReply = `Thanks for sharing! 😊\n\nReply MENU to explore our options.`;
    }

    await sock.sendMessage(sender, { text: sourceReply });
    userSessions.set(sender, {});
    startInactivityTimer(sock, sender);
    repliedMessages.add(messageId);
    return;
  }

  console.log(`📩 From ${senderNumber}: ${text}`);

  // Reset inactivity timer on every message
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

  const entry = getReplyEntry(text);

  if (!entry) {
    // If no keyword match and not in a flow, send default reply
    await sock.sendMessage(sender, { text: DEFAULT_REPLY });
    repliedMessages.add(messageId);
    startInactivityTimer(sock, sender);
    return;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sock.sendMessage(sender, { text: entry.reply });
    repliedMessages.add(messageId);
    console.log(`✅ Replied to ${senderNumber}`);

    // If this keyword triggers a multi-step flow, set the session step
    if (entry.nextStep) {
      userSessions.set(sender, { step: entry.nextStep });
    } else {
      userSessions.set(sender, {});
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

// Start the bot
startBot().catch(console.error);
