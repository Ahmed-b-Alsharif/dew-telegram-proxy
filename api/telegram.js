export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const order = req.body;
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({ error: 'Missing environment variables on proxy' });
    }

    const c = order.customer || {};
    const lines = (order.lines || []).map(l => `• ${l.qty}x ${l.name} - EGP ${l.total}`).join('\n');
    
    const msg = `🛍️ *New Order!* (${order.number})\n\n` +
      `*Items:*\n${lines}\n\n` +
      `*Items Total:* EGP ${order.itemsTotal}\n` +
      `*Delivery:* EGP ${order.delivery}\n` +
      `*Total:* EGP ${order.total} (COD)\n\n` +
      `*Customer Details:*\n` +
      `👤 *Name:* ${c.first || ''} ${c.last || ''}\n` +
      `📞 *Phone:* ${c.phone || ''}\n` +
      `💬 *WhatsApp:* ${c.whatsapp || ''}\n` +
      `📍 *Area:* ${order.area === 'alex' ? 'Alexandria' : 'Cairo & Giza'}\n` +
      `🏠 *Address:* ${c.address || ''}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
    });

    const data = await tgRes.json();
    if (!tgRes.ok) return res.status(500).json({ error: data.description });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
