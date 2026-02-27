
import { createClient } from "@supabase/supabase-js";

export function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function brand() {
  return process.env.BRAND_NAME || "NISKALA DIGITAL";
}

export function banner() {
  return process.env.BRAND_BANNER_URL || "";
}

export function qris() {
  return process.env.QRIS_IMAGE_URL;
}

export function admins() {
  return (process.env.TELEGRAM_ADMIN_IDS || "")
    .split(",")
    .map(x => Number(x.trim()));
}

export function isAdmin(id) {
  return admins().includes(Number(id));
}
