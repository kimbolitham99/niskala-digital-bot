
export async function handler() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const site = process.env.URL || process.env.DEPLOY_URL;

  const res = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: site + "/.netlify/functions/telegram"
    })
  });

  const data = await res.json();
  return { statusCode: 200, body: JSON.stringify(data) };
}
