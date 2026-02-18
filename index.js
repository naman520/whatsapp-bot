const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
    } = require("@whiskeysockets/baileys");
    const P = require("pino");

    async function startSock() {
      const { state, saveCreds } = await useMultiFileAuthState("auth_info");

      const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        browser: ["Railway Bot", "Chrome", "1.0.0"],
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("✅ WhatsApp Connected");
        }

        if (connection === "close") {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut;

          if (shouldReconnect) {
            startSock();
          }
        }

        if (connection === "connecting" && !sock.authState.creds.registered) {
          const phone = process.env.PHONE;
          const code = await sock.requestPairingCode(phone);
          console.log("🔐 Pairing Code:", code);
        }
      });
    }

    startSock();
  });

  // MESSAGE LISTENER
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];

    if (!msg.message) return;
    if (msg.key.remoteJid === "status@broadcast") return;

    const sender = msg.key.remoteJid;

    // ❌ Ignore groups
    if (sender.endsWith("@g.us")) return;

    // ❌ Ignore self messages
    if (msg.key.fromMe) return;

    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    console.log(`📩 Message from ${sender}: ${text}`);

    // ✅ Reply once per incoming message
    await sock.sendMessage(sender, {
      text: "Thanks for your message! We'll reply shortly.",
    });
  });
}

startBot();
