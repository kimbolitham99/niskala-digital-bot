
import { banner, brand } from "./_helpers.js";

export async function branded(ctx, text, extra = {}) {
  if (banner()) {
    try {
      return await ctx.replyWithPhoto(banner(), {
        caption: text,
        parse_mode: "Markdown",
        ...extra
      });
    } catch {}
  }
  return ctx.replyWithMarkdown(text, extra);
}

export function header(title) {
  return `*${brand()}*\n_${title}_\n`;
}
