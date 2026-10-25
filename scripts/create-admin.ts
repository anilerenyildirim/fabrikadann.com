// Yönetici hesabı oluşturur ya da günceller; iki adımlı doğrulama (TOTP) anahtarını kurar.
//
//   npm run admin:create -- <e-posta> <ad> <soyad> [--reset-totp]
//   ADMIN_PASSWORD='...' npm run admin:create -- <e-posta> <ad> <soyad>
//   npm run admin:create -- <e-posta> --unlock
//
// Canlıda (Docker): docker compose ... run --rm app npx tsx scripts/create-admin.ts <e-posta> <ad> <soyad>
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool, schema } from "@/server/db";
import { hashPassword, passwordProblem } from "@/server/auth/password";
import { clearRateLimit } from "@/server/auth/rate-limit";
import { deleteUserSessions } from "@/server/auth/session";
import { generateTotpSecret, totpUri } from "@/server/auth/totp";
import { sealSecret } from "@/server/auth/crypto";
import { audit } from "@/server/services/audit";

const USAGE = `
Kullanım:
  npm run admin:create -- <e-posta> <ad> <soyad> [--reset-totp]
  npm run admin:create -- <e-posta> --unlock

  Hesap yoksa yönetici olarak oluşturulur. Parola ADMIN_PASSWORD ortam değişkeninden alınır;
  verilmezse güçlü bir parola üretilip bir kez ekrana yazılır.
  Hesap müşteri hesabı olarak zaten varsa yalnızca --promote ile yönetici yapılır ve parolası
  yenilenir (e-posta sahipliği doğrulanmadığı için eski parola güvenilir sayılmaz).
  İki adımlı doğrulama anahtarı yoksa ya da --reset-totp verildiyse yeni anahtar üretilir ve
  ekrana yazılır. Anahtarı Google Authenticator, 1Password ya da benzeri bir uygulamaya ekleyin.
  --unlock: "Çok fazla deneme" yüzünden giriş yapamıyorsanız bu hesabın giriş ve doğrulama kodu
  deneme sınırlarını sıfırlar (parola ve anahtar değişmez). Biri hesabınızı deniyor olabilir:
  işlem günlüğündeki başarısız girişlere bakın.

Örnek:
  ADMIN_PASSWORD='uzun-ve-tahmin-edilemez-bir-parola' npm run admin:create -- siz@fabrikadann.com Ayşe Yılmaz
`;

function fail(message: string): never {
  console.error(`\nHata: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const unknown = [...flags].filter((f) => !["--reset-totp", "--unlock", "--help", "--promote"].includes(f));

if (flags.has("--help")) {
  console.log(USAGE);
  process.exit(0);
}
if (unknown.length > 0) fail(`Bilinmeyen seçenek: ${unknown.join(", ")}`);
const unlock = flags.has("--unlock");
if (unlock && flags.has("--reset-totp")) fail("--unlock ve --reset-totp birlikte kullanılamaz.");
if (unlock ? positional.length !== 1 && positional.length !== 3 : positional.length !== 3) {
  fail(unlock ? "E-posta gerekli." : "E-posta, ad ve soyad gerekli.");
}

const input = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Geçerli bir e-posta adresi yazın.")),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
  })
  .safeParse({ email: positional[0], firstName: positional[1] ?? "-", lastName: positional[2] ?? "-" });
if (!input.success) fail(input.error.issues.map((i) => i.message).join(" "));

const { email, firstName, lastName } = input.data;
const resetTotp = flags.has("--reset-totp");

/** Giriş (e-posta anahtarı) ve TOTP deneme sınırlarını sıfırlar; anahtarlar services/admin/auth.ts ile aynı. */
async function unlockAccount() {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
    columns: { id: true, role: true },
  });
  if (!user || user.role !== "admin") fail(`${email} adresinde yönetici hesabı yok.`);
  await clearRateLimit(`yonetim-giris:eposta:${email}`);
  await clearRateLimit(`giris:eposta:${email}`);
  await clearRateLimit(`totp:${user.id}`);
  await clearRateLimit(`totp:gun:${user.id}`);
  await audit({ action: "admin.cli.unlock", actorId: user.id, target: email });
  console.log(`\nDeneme sınırları sıfırlandı: ${email}`);
  console.log("IP adresi sınırı (15 dakika) sürüyorsa başka bir ağdan deneyin ya da bekleyin.\n");
}

async function main() {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  let userId: string;
  let generatedPassword: string | null = null;
  let totpSecret: string | null = existing?.totpSecret ?? null;
  const lines: string[] = [];

  if (!existing) {
    let password = process.env.ADMIN_PASSWORD ?? "";
    if (!password) {
      password = randomBytes(18).toString("base64url");
      generatedPassword = password;
    }
    const problem = passwordProblem(password, { email });
    if (problem) fail(`ADMIN_PASSWORD uygun değil: ${problem}`);
    totpSecret = generateTotpSecret();
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(password),
        firstName,
        lastName,
        role: "admin",
        totpSecret: sealSecret(totpSecret),
        totpLastStep: null,
      })
      .returning({ id: schema.users.id });
    userId = created!.id;
    await audit({ action: "admin.cli.create", actorId: userId, target: email });
    lines.push(`Yönetici hesabı oluşturuldu: ${email}`);
  } else {
    userId = existing.id;
    if (existing.role !== "admin") {
      if (!flags.has("--promote")) {
        fail(`${email} bir müşteri hesabı. Yönetici yapmak için --promote ekleyin (parolası yenilenir).`);
      }
      // Hesabı kimin açtığı bilinmiyor: parola her durumda yenilenir
      let password = process.env.ADMIN_PASSWORD ?? "";
      if (!password) {
        password = randomBytes(18).toString("base64url");
        generatedPassword = password;
      }
      const problem = passwordProblem(password, { email });
      if (problem) fail(`ADMIN_PASSWORD uygun değil: ${problem}`);
      await db
        .update(schema.users)
        .set({ role: "admin", passwordHash: await hashPassword(password) })
        .where(eq(schema.users.id, userId));
      // Müşteri olarak açılmış (30 günlük) oturumlar yönetici yetkisiyle devam etmesin
      await deleteUserSessions(userId);
      await audit({ action: "admin.cli.promote", actorId: userId, target: email });
      lines.push(`Mevcut hesap yönetici yapıldı: ${email} (açık oturumları kapatıldı, parolası yenilendi)`);
    } else {
      lines.push(`Hesap zaten yönetici: ${email}`);
    }
    if (process.env.ADMIN_PASSWORD && existing.role === "admin") {
      lines.push("Not: Hesap zaten yönetici; ADMIN_PASSWORD yok sayıldı.");
    }
    if (!totpSecret || resetTotp) {
      totpSecret = generateTotpSecret();
      await db
        .update(schema.users)
        .set({ totpSecret: sealSecret(totpSecret), totpLastStep: null })
        .where(eq(schema.users.id, userId));
      await deleteUserSessions(userId);
      await audit({ action: "admin.cli.totp_reset", actorId: userId, target: email });
      lines.push(resetTotp ? "İki adımlı doğrulama anahtarı yenilendi; eski anahtar artık çalışmaz." : "İki adımlı doğrulama kuruldu.");
    } else {
      lines.push("İki adımlı doğrulama zaten kurulu. Yeni anahtar için --reset-totp ekleyin.");
      totpSecret = null; // mevcut anahtar yeniden ekrana yazılmaz
    }
  }

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log("");
  for (const l of lines) console.log(l);

  if (generatedPassword) {
    console.log("");
    console.log("Parola (yalnızca bu kez gösterilir, bir parola yöneticisine kaydedin):");
    console.log(`  ${generatedPassword}`);
  }

  if (totpSecret) {
    console.log("");
    console.log("İki adımlı doğrulama — uygulamanıza (Google Authenticator, 1Password …) ekleyin:");
    console.log(`  Anahtar (elle giriş): ${totpSecret}`);
    console.log(`  otpauth adresi (QR üreticisine verilebilir): ${totpUri(totpSecret, email)}`);
    console.log("  Bu anahtar yalnızca bu kez gösterilir; kaybederseniz --reset-totp ile yenileyin.");
  }

  console.log("");
  console.log("Giriş:");
  console.log(`  1. ${appUrl}/yonetim/giris adresinde e-posta ve parolayla giriş yapın.`);
  console.log("  2. Uygulamadaki 6 haneli kodu girin.");
  console.log("");
}

try {
  await (unlock ? unlockAccount() : main());
} finally {
  await pool.end();
}
