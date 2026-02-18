import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";

const AUTH_DIR = fs.existsSync("/data") ? "/data/baileys_auth" : "./baileys_auth";
const WA_PHONE = (process.env.WA_PHONE || "").replace(/\D/g, ""); // digits only

let pairingRequested = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: !WA_PHONE, // QR only if phone not provided
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Local QR (only if WA_PHONE not set)
    if (qr && !WA_PHONE) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("❌ Connection closed. Reconnect?", shouldReconnect, "code:", code);
      if (shouldReconnect) startBot();
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected!");
    }

    // Pairing code flow (best for Railway)
    if (!sock.authState.creds.registered && WA_PHONE && !pairingRequested) {
      pairingRequested = true;

      // small delay helps avoid 428 in many cases
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(WA_PHONE);
          console.log("🔗 Pairing Code:", code);
          console.log("WhatsApp → Linked Devices → Link with phone number → enter code");
        } catch (err) {
          pairingRequested = false; // allow retry on next update
          console.error("❌ Failed to get pairing code:", err?.output?.statusCode, err?.message || err);
        }
      }, 2500);
    }
  });

  // your message handler (keep yours)
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;

    const sender = msg.key.remoteJid;
    if (sender.endsWith("@g.us")) return;
    if (msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    console.log(`📩 Message from ${sender}: ${text}`);

    await sock.sendMessage(sender, {
      text: "Thanks for your message! We'll reply shortly.",
    });
  });
}

startBot();
