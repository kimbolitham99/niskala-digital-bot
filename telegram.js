
import { Telegraf, Markup } from "telegraf";
import { nanoid } from "nanoid";
import { supabase, brand, qris } from "./_helpers.js";
import { branded, header } from "./_branding.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const db = supabase();

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛍️ Katalog", "CATALOG")],
    [Markup.button.callback("🧾 Riwayat", "HISTORY")]
  ]);
}

bot.start(async (ctx) => {
  await branded(ctx, header("Selamat Datang") + "\nPilih menu:", mainMenu());
});

bot.action("CATALOG", async (ctx) => {
  const { data } = await db.from("products").select("*").eq("is_active", true);
  if (!data || !data.length) return ctx.reply("Belum ada produk.");
  const rows = data.map(p => [Markup.button.callback(p.name + " - Rp" + p.price, "BUY_" + p.id)]);
  await branded(ctx, header("Katalog Produk"), Markup.inlineKeyboard(rows));
});

bot.action(/BUY_(.+)/, async (ctx) => {
  const id = ctx.match[1];
  const { data } = await db.from("products").select("*").eq("id", id).single();
  const orderCode = "NSK-" + nanoid(8).toUpperCase();

  await db.from("orders").insert({
    order_code: orderCode,
    telegram_id: ctx.from.id,
    product_id: id,
    amount: data.price,
    status: "PENDING"
  });

  await ctx.replyWithPhoto(qris(), {
    caption: header("Invoice") +
      "\nOrder: *" + orderCode + "*" +
      "\nTotal: Rp" + data.price +
      "\n\nSetelah bayar kirim bukti transfer.",
    parse_mode: "Markdown"
  });
});

bot.on("photo", async (ctx) => {
  await ctx.reply("Bukti diterima. Admin akan memverifikasi.");
});

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 200 };
  const update = JSON.parse(event.body);
  await bot.handleUpdate(update);
  return { statusCode: 200 };
}
