function safeText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function escapeMarkdown(value) {
  return safeText(value).replace(/([_*\[\]()`])/g, "\\$1");
}

function validMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 10000000;
}

function validSecret(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string" || !expected || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expectedSecret = process.env.TELEGRAM_PROXY_SECRET;
  const receivedSecret = req.headers["x-dew-proxy-secret"];
  if (!validSecret(receivedSecret, expectedSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: "Telegram proxy is not configured" });
  }

  try {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(rawBody, "utf8") > 12000) {
      return res.status(413).json({ error: "Request too large" });
    }

    const order = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      return res.status(400).json({ error: "Invalid order payload" });
    }
    if (!/^DEW#\d{1,12}$/.test(String(order.number || ""))) {
      return res.status(400).json({ error: "Invalid order number" });
    }
    if (!order.customer || typeof order.customer !== "object" || Array.isArray(order.customer)) {
      return res.status(400).json({ error: "Invalid customer details" });
    }
    if (!Array.isArray(order.lines) || order.lines.length < 1 || order.lines.length > 40) {
      return res.status(400).json({ error: "Invalid order items" });
    }
    if (![order.itemsTotal, order.delivery, order.total].every(validMoney)) {
      return res.status(400).json({ error: "Invalid order totals" });
    }

    const lines = [];
    for (const line of order.lines) {
      const qty = Number(line?.qty);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99 || !validMoney(line?.total)) {
        return res.status(400).json({ error: "Invalid order item" });
      }
      const name = escapeMarkdown(line?.name || "Product").slice(0, 120);
      lines.push(`• ${qty}x ${name} - EGP ${Number(line.total).toFixed(2)}`);
    }

    const c = order.customer;
    const area = escapeMarkdown(order.area || order.areaName || order.areaId || "Not specified");
    const paymentMethod = String(order.paymentMethod || "cod").trim().toLowerCase();
    const paymentLabel = paymentMethod === "instapay" ? "InstaPay" : "Cash on delivery";
    const msg = `🛍️ *New Order!* (${escapeMarkdown(order.number)})\n\n` +
      `*Items:*\n${lines.join("\n")}\n\n` +
      `*Items Total:* EGP ${Number(order.itemsTotal).toFixed(2)}\n` +
      `*Delivery:* EGP ${Number(order.delivery).toFixed(2)}\n` +
      `*Total:* EGP ${Number(order.total).toFixed(2)} (${paymentLabel})\n\n` +
      `*Customer Details:*\n` +
      `👤 *Name:* ${escapeMarkdown(c.first)} ${escapeMarkdown(c.last)}\n` +
      `📞 *Phone:* ${escapeMarkdown(c.phone)}\n` +
      `💬 *WhatsApp:* ${escapeMarkdown(c.whatsapp || c.phone)}\n` +
      `📍 *Area:* ${area}\n` +
      `🏠 *Address:* ${escapeMarkdown(c.address)}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "Markdown" })
    });

    const data = await tgRes.json();
    if (!tgRes.ok || !data.ok) {
      console.error("Telegram sendMessage failed", tgRes.status);
      return res.status(502).json({ error: "Telegram could not send the notification" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Telegram proxy request failed", err);
    return res.status(400).json({ error: "Invalid request" });
  }
}
