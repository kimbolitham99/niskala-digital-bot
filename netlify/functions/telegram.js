import { Telegraf, Markup } from "telegraf";
import { nanoid } from "nanoid";
import { supabase, brand, qris, isAdmin } from "./_helpers.js";
import { branded, header } from "./_branding.js";

/**
 * NISKALA DIGITAL — Telegram Bot (Netlify Functions)
 * Improvements:
 * - Saat user kirim bukti (photo): status order -> WAITING_APPROVAL + notifikasi ke admin (photo + tombol Approve/Reject)
 * - Admin bisa /admin untuk cek pending & statistik
 * - Approve otomatis kirim link digital / tambah credit
 * - Optional verifikasi webhook secret (TELEGRAM_WEBHOOK_SECRET)
 */

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const db = supabase();

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ""; // optional

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛍️ Katalog", "CATALOG")],
    [Markup.button.callback("🧾 Riwayat", "HISTORY")],
    [Markup.button.callback("🆘 Bantuan", "HELP")]
  ]);
}

function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏳ Pending", "ADMIN_PENDING")],
    [Markup.button.callback("📊 Statistik", "ADMIN_STATS")]
  ]);
}

function parseAdminIds() {
  const raw = process.env.TELEGRAM_ADMIN_IDS || "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number(s))
    .filter(n => Number.isFinite(n));
}

function rupiah(n) {
  return Number(n || 0).toLocaleString("id-ID");
}

async function upsertUser(ctx) {
  const t = ctx.from;
  const telegram_id = Number(t.id);
  const telegram_username = t.username || null;

  const { data: existing, error: e1 } = await db
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  if (e1) throw e1;

  if (existing) {
    try {
      await db.from("users").update({ telegram_username }).eq("telegram_id", telegram_id);
    } catch {}
    return existing;
  }

  const { data, error } = await db
    .from("users")
    .insert({ telegram_id, telegram_username, credit_balance: 0 })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function getActiveProducts() {
  const { data, error } = await db.from("products").select("*").eq("is_active", true);
  if (error) throw error;
  return data || [];
}

async function createOrder(ctx, product) {
  const order_code = "NSK-" + nanoid(8).toUpperCase();
  const { data, error } = await db
    .from("orders")
    .insert({
      order_code,
      telegram_id: ctx.from.id,
      product_id: product.id,
      amount: product.price,
      status: "PENDING"
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function getRecentPendingOrder(telegramId) {
  const { data, error } = await db
    .from("orders")
    .select("*, products(*)")
    .eq("telegram_id", Number(telegramId))
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getOrderById(orderId) {
  const { data, error } = await db
    .from("orders")
    .select("*, products(*)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listPendingOrders(limit = 10) {
  const { data, error } = await db
    .from("orders")
    .select("*, products(*)")
    .eq("status", "WAITING_APPROVAL")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function insertProof(orderId, fileId) {
  // If payment_proofs table exists, save it. If not, ignore.
  try {
    await db.from("payment_proofs").insert({ order_id: orderId, telegram_file_id: fileId });
  } catch {}
}

/** ---------------- Commands ---------------- */
bot.start(async (ctx) => {
  await upsertUser(ctx);
  await branded(ctx, header("Selamat Datang") + "\nPilih menu:", mainMenu());
});

bot.command("menu", async (ctx) => {
  await upsertUser(ctx);
  await branded(ctx, header("Menu") + "\nPilih menu:", mainMenu());
});

bot.command("admin", async (ctx) => {
  await upsertUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("Akses ditolak.");
  await branded(ctx, header("Panel Admin") + "\nPilih menu admin:", adminMenu());
});

/** ---------------- User Menus ---------------- */
bot.action("HELP", async (ctx) => {
  await ctx.answerCbQuery();
  const text =
    header("Bantuan") +
    "\n1) Klik *Katalog* lalu pilih produk.\n" +
    "2) Bot kirim *Invoice + QRIS*.\n" +
    "3) Setelah bayar, kirim *foto bukti pembayaran*.\n" +
    "4) Admin approve → produk dikirim otomatis.\n";
  await branded(ctx, text, mainMenu());
});

bot.action("HISTORY", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);

  const { data, error } = await db
    .from("orders")
    .select("order_code, amount, status, created_at, products(name)")
    .eq("telegram_id", Number(ctx.from.id))
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw error;

  if (!data || !data.length) {
    return branded(ctx, header("Riwayat") + "\nBelum ada transaksi.", mainMenu());
  }

  const lines = data
    .map(o => {
      const dt = new Date(o.created_at).toLocaleString("id-ID");
      return `• ${o.order_code} — ${o.products?.name || "-"} — Rp${rupiah(o.amount)} — *${o.status}* — ${dt}`;
    })
    .join("\n");

  return branded(ctx, header("Riwayat (10 terakhir)") + "\n" + lines, mainMenu());
});

bot.action("CATALOG", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);

  const products = await getActiveProducts();
  if (!products.length) return ctx.reply("Belum ada produk.");

  const rows = products.map(p => [
    Markup.button.callback(`${p.name} — Rp${rupiah(p.price)}`, "BUY_" + p.id)
  ]);

  await branded(ctx, header("Katalog Produk") + "\nPilih produk:", Markup.inlineKeyboard(rows));
});

bot.action(/BUY_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);

  const id = ctx.match[1];
  const { data: product, error } = await db.from("products").select("*").eq("id", id).single();
  if (error) throw error;

  const order = await createOrder(ctx, product);

  const invoiceText =
    header("Invoice") +
    `\nOrder: *${order.order_code}*` +
    `\nProduk: *${product.name}*` +
    `\nTotal: *Rp${rupiah(product.price)}*` +
    "\n\nSilakan scan QRIS untuk pembayaran." +
    "\nSetelah bayar, kirim *foto bukti pembayaran* di chat ini.";

  try {
    await ctx.replyWithPhoto(qris(), { caption: invoiceText, parse_mode: "Markdown" });
  } catch {
    await branded(ctx, invoiceText + "\n\n(⚠️ QRIS_IMAGE_URL tidak bisa dibuka. Pastikan HTTPS publik)", mainMenu());
  }
});

/** ---------------- Proof upload (photo) ---------------- */
bot.on("photo", async (ctx) => {
  await upsertUser(ctx);

  const order = await getRecentPendingOrder(ctx.from.id);
  if (!order) {
    return ctx.reply("Aku tidak menemukan order *PENDING* kamu. Silakan checkout dulu dari Katalog.", { parse_mode: "Markdown" });
  }

  const photos = ctx.message.photo || [];
  const best = photos[photos.length - 1];
  const fileId = best.file_id;

  // status -> WAITING_APPROVAL
  const { error: e1 } = await db.from("orders").update({ status: "WAITING_APPROVAL" }).eq("id", order.id);
  if (e1) throw e1;

  await insertProof(order.id, fileId);

  await ctx.reply("✅ Bukti diterima. Admin akan memverifikasi.");

  // notify admins
  const adminIds = parseAdminIds();
  if (!adminIds.length) return;

  const caption =
    header("Bukti Pembayaran Masuk") +
    `\nOrder: *${order.order_code}*` +
    `\nProduk: *${order.products?.name || "-"}*` +
    `\nTotal: *Rp${rupiah(order.amount)}*` +
    `\nUser: @${ctx.from.username || "-"} (ID: ${ctx.from.id})` +
    "\n\nKlik tombol di bawah untuk proses.";

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Approve", `ADMIN_APPROVE_${order.id}`),
      Markup.button.callback("❌ Reject", `ADMIN_REJECT_${order.id}`)
    ]
  ]);

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendPhoto(adminId, fileId, { caption, parse_mode: "Markdown", ...kb });
    } catch {
      try {
        await bot.telegram.sendMessage(adminId, caption, { parse_mode: "Markdown", ...kb });
      } catch {}
    }
  }
});

/** ---------------- Admin ---------------- */
bot.action("ADMIN_PENDING", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("Akses ditolak.");

  const orders = await listPendingOrders(10);
  if (!orders.length) return branded(ctx, header("Pending") + "\nTidak ada order pending.", adminMenu());

  for (const o of orders) {
    const text =
      header("Pending") +
      `\nOrder: *${o.order_code}*` +
      `\nProduk: *${o.products?.name || "-"}*` +
      `\nTotal: *Rp${rupiah(o.amount)}*` +
      `\nUser ID: ${o.telegram_id}`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Approve", `ADMIN_APPROVE_${o.id}`),
        Markup.button.callback("❌ Reject", `ADMIN_REJECT_${o.id}`)
      ]
    ]);

    await branded(ctx, text, kb);
  }

  await branded(ctx, header("Panel Admin") + "\nSelesai memuat pending.", adminMenu());
});

bot.action("ADMIN_STATS", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("Akses ditolak.");

  const [{ count: usersCount }, { count: paidCount }] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("orders").select("*", { count: "exact", head: true }).eq("status", "PAID")
  ]);

  await branded(
    ctx,
    header("Statistik") + `\nUsers: *${usersCount ?? 0}*\nOrders PAID: *${paidCount ?? 0}*`,
    adminMenu()
  );
});

async function deliverToUser(order) {
  const product = order.products;
  if (!product) return;

  if (product.type === "DIGITAL") {
    const link = product.delivery_payload || "(link belum diisi admin)";
    await bot.telegram.sendMessage(
      order.telegram_id,
      `✅ Pembayaran diterima!\n\n📦 Produk: ${product.name}\n🔗 Link download: ${link}\n\nTerima kasih — ${brand()}`
    );
    return;
  }

  if (product.type === "CREDIT") {
    const add = Number(product.credit_amount || 0);
    if (add <= 0) {
      await bot.telegram.sendMessage(order.telegram_id, `✅ Pembayaran diterima untuk topup ${product.name}. (credit_amount belum diisi admin)`);
      return;
    }

    const { data: u, error: e1 } = await db.from("users").select("credit_balance").eq("telegram_id", Number(order.telegram_id)).single();
    if (e1) throw e1;

    const newBal = Number(u.credit_balance || 0) + add;
    const { error: e2 } = await db.from("users").update({ credit_balance: newBal }).eq("telegram_id", Number(order.telegram_id));
    if (e2) throw e2;

    await bot.telegram.sendMessage(order.telegram_id, `✅ Topup berhasil!\n+${add} credit\nSaldo baru: ${rupiah(newBal)} credit\n\n${brand()}`);
  }
}

bot.action(/ADMIN_APPROVE_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("Akses ditolak.");

  const orderId = ctx.match[1];
  const order = await getOrderById(orderId);
  if (!order) return ctx.reply("Order tidak ditemukan.");

  if (order.status !== "WAITING_APPROVAL") return ctx.reply("Order ini tidak dalam status WAITING_APPROVAL.");

  const { error } = await db.from("orders").update({ status: "PAID" }).eq("id", orderId);
  if (error) throw error;

  await ctx.reply(`✅ Approve berhasil untuk ${order.order_code}.`);
  await deliverToUser(order);
});

bot.action(/ADMIN_REJECT_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("Akses ditolak.");

  const orderId = ctx.match[1];
  const order = await getOrderById(orderId);
  if (!order) return ctx.reply("Order tidak ditemukan.");

  if (order.status !== "WAITING_APPROVAL") return ctx.reply("Order ini tidak dalam status WAITING_APPROVAL.");

  const { error } = await db.from("orders").update({ status: "REJECTED" }).eq("id", orderId);
  if (error) throw error;

  await ctx.reply(`❌ Reject berhasil untuk ${order.order_code}.`);
  try {
    await bot.telegram.sendMessage(order.telegram_id, `❌ Pembayaran untuk order ${order.order_code} ditolak. Jika ini kesalahan, hubungi admin.`);
  } catch {}
});

/** ---------------- Netlify Function handler ---------------- */
export async function handler(event) {
  if (WEBHOOK_SECRET) {
    const secret = event.headers["x-telegram-bot-api-secret-token"];
    if (secret !== WEBHOOK_SECRET) return { statusCode: 401, body: "Unauthorized" };
  }

  if (event.httpMethod !== "POST") return { statusCode: 200, body: "OK" };

  try {
    const update = JSON.parse(event.body || "{}");
    await bot.handleUpdate(update);
    return { statusCode: 200, body: "OK" };
  } catch (e) {
    console.error("Webhook error:", e);
    return { statusCode: 500, body: "Internal Error" };
  }
}
