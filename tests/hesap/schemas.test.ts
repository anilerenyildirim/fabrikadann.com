import { describe, expect, test } from "vitest";
import {
  changePasswordSchema,
  formatPhone,
  isTokenFormat,
  loginSchema,
  readFields,
  registerSchema,
  resetSchema,
  returnPath,
  profileSchema,
  tooManyAttempts,
} from "@/components/account/schemas";
import { companyInfo, isFilled, placeholder, shippingTerms, telHref } from "@/components/legal/company";
import { randomToken } from "@/server/auth/crypto";
import { computeShipping } from "@/server/services/cart";
import { defaultSettings } from "@/server/services/settings";

describe("readFields", () => {
  test("yalnızca istenen alanları alır, eksikleri boş dize yapar, dosyaları yok sayar", () => {
    const form = new FormData();
    form.set("email", "a@b.com");
    form.set("$ACTION_ID_x", "1");
    form.set("role", "admin");
    form.set("password", new Blob(["x"]), "x.txt");
    expect(readFields(form, ["email", "password", "sonra"])).toEqual({ email: "a@b.com", password: "", sonra: "" });
  });
});

describe("returnPath", () => {
  test("site içi yolları kabul eder", () => {
    expect(returnPath("/odeme")).toBe("/odeme");
    expect(returnPath("/urun/siyah-bot?renk=2")).toBe("/urun/siyah-bot?renk=2");
  });

  test("açık yönlendirme girişimlerini varsayılana çevirir", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      `/${"a".repeat(400)}`,
    ]) {
      expect(returnPath(bad)).toBe("/hesabim");
    }
    expect(returnPath("//evil.com", "/")).toBe("/");
  });

  test("filtrelenen yol tarayıcıda da aynı siteye çözülür", () => {
    for (const p of ["/odeme", "/%09/evil.com", "/.//evil.com", "/%2F%2Fevil.com"]) {
      expect(new URL(returnPath(p), "https://fabrikadann.com").host).toBe("fabrikadann.com");
    }
  });
});

describe("token biçimi", () => {
  test("randomToken çıktısı geçerli, diğerleri geçersiz", () => {
    expect(isTokenFormat(randomToken())).toBe(true);
    expect(isTokenFormat("a".repeat(43))).toBe(true);
    expect(isTokenFormat("a".repeat(42))).toBe(false);
    expect(isTokenFormat("a".repeat(44))).toBe(false);
    expect(isTokenFormat(`${"a".repeat(42)}=`)).toBe(false);
    expect(isTokenFormat(`${"a".repeat(41)}/+`)).toBe(false);
    expect(isTokenFormat("../../etc/passwd")).toBe(false);
    expect(isTokenFormat(undefined)).toBe(false);
    expect(isTokenFormat(123)).toBe(false);
  });
});

test("hız sınırı mesajı dakikaya yuvarlanır", () => {
  expect(tooManyAttempts(1)).toBe("Çok fazla deneme. 1 dakika sonra tekrar deneyin.");
  expect(tooManyAttempts(61)).toBe("Çok fazla deneme. 2 dakika sonra tekrar deneyin.");
  expect(tooManyAttempts(900)).toBe("Çok fazla deneme. 15 dakika sonra tekrar deneyin.");
  expect(tooManyAttempts(0)).toBe("Çok fazla deneme. 1 dakika sonra tekrar deneyin.");
});

describe("giriş şeması", () => {
  test("e-postayı normalize eder", () => {
    const r = loginSchema.parse({ email: "  Ayse@Ornek.COM ", password: "x", sonra: "" });
    expect(r.email).toBe("ayse@ornek.com");
  });

  test("boş alanlar Türkçe hata verir", () => {
    const r = loginSchema.safeParse({ email: "", password: "" });
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message);
    expect(messages).toContain("Geçerli bir e-posta adresi girin.");
    expect(messages).toContain("Parolanızı girin.");
  });

  test("aşırı uzun parola argon2'ye gitmeden reddedilir", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(129) }).success).toBe(false);
  });
});

describe("kayıt şeması", () => {
  const valid = { firstName: "Ayşe", lastName: "Yılmaz", email: "ayse@ornek.com", password: "Kuvvetli-Parola-42", kvkk: "on" };

  test("geçerli girdi", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  test("KVKK onayı zorunlu", () => {
    for (const kvkk of ["", "off", "true", undefined]) {
      const r = registerSchema.safeParse({ ...valid, kvkk });
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.path).toEqual(["kvkk"]);
      expect(r.error!.issues[0]!.message).toMatch(/KVKK/);
    }
  });

  test("kısa parola ve boş ad reddedilir", () => {
    const r = registerSchema.safeParse({ ...valid, firstName: " ", password: "kisa" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("firstName");
    expect(paths).toContain("password");
  });
});

describe("parola sıfırlama şeması", () => {
  const token = randomToken();

  test("parolalar eşleşmeli", () => {
    const r = resetSchema.safeParse({ token, password: "Kuvvetli-Parola-42", passwordRepeat: "Kuvvetli-Parola-43" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["passwordRepeat"]);
  });

  test("bozuk token reddedilir", () => {
    const r = resetSchema.safeParse({ token: "x", password: "Kuvvetli-Parola-42", passwordRepeat: "Kuvvetli-Parola-42" });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === "token")).toBe(true);
  });

  test("geçerli girdi", () => {
    expect(
      resetSchema.safeParse({ token, password: "Kuvvetli-Parola-42", passwordRepeat: "Kuvvetli-Parola-42" }).success,
    ).toBe(true);
  });
});

describe("profil şeması", () => {
  test("telefon isteğe bağlı ve normalize edilir", () => {
    expect(profileSchema.parse({ firstName: "A", lastName: "B", phone: "" }).phone).toBeNull();
    expect(profileSchema.parse({ firstName: "A", lastName: "B", phone: "0555 111 22 33" }).phone).toBe("05551112233");
    expect(profileSchema.safeParse({ firstName: "A", lastName: "B", phone: "12345" }).success).toBe(false);
  });
});

test("parola değiştirme şeması tekrarı kontrol eder", () => {
  const r = changePasswordSchema.safeParse({
    currentPassword: "eski-parola-1",
    newPassword: "Yeni-Kuvvetli-77",
    newPasswordRepeat: "Yeni-Kuvvetli-78",
  });
  expect(r.success).toBe(false);
  expect(r.error!.issues[0]!.path).toEqual(["newPasswordRepeat"]);
});

test("telefon gösterimi", () => {
  expect(formatPhone("05551112233")).toBe("0555 111 22 33");
  expect(formatPhone(null)).toBe("");
  expect(formatPhone("abc")).toBe("abc");
});

describe("şirket bilgileri", () => {
  test("boş ayarlar görünür yer tutucuyla gösterilir", () => {
    const c = companyInfo({ ...defaultSettings, companyName: "", phone: "  " });
    expect(c.name).toBe("[Şirket unvanı — yönetim panelinde Ayarlar'dan girilecek]");
    expect(c.phone).toBe(placeholder("Telefon numarası"));
    expect(isFilled(c.phone)).toBe(false);
    expect(c.email).toBe(defaultSettings.email);
    expect(isFilled(c.email)).toBe(true);
  });

  test("boş MERSİS yer tutucu olmadan boş kalır", () => {
    expect(companyInfo({ ...defaultSettings, mersisNumber: " " }).mersis).toBe("");
    expect(companyInfo({ ...defaultSettings, mersisNumber: "0123456789000015" }).mersis).toBe("0123456789000015");
  });

  test("dolu ayarlar olduğu gibi kullanılır", () => {
    const c = companyInfo({ ...defaultSettings, companyName: "Fabrikadan Ltd. Şti.", phone: "0212 555 00 00" });
    expect(c.name).toBe("Fabrikadan Ltd. Şti.");
    expect(telHref(c.phone)).toBe("tel:02125550000");
  });
});

describe("kargo koşulu metni", () => {
  test("eşik ve ücret verilmişse ikisi de yazılır", () => {
    expect(shippingTerms({ shippingFee: 9990, freeShippingThreshold: 150000 })).toBe(
      "Kargo ücreti 99,90 TL’dir; 1.500,00 TL ve üzerindeki siparişlerde kargo ücretsizdir.",
    );
  });

  test("sepet hesabıyla aynı kural: ücret ya da eşik 0 ise her sipariş ücretsiz", () => {
    for (const s of [
      { shippingFee: 0, freeShippingThreshold: 150000 },
      { shippingFee: 9990, freeShippingThreshold: 0 },
    ]) {
      expect(shippingTerms(s)).toBe("Kargo ücretsizdir.");
      expect(computeShipping(1, s)).toBe(0);
    }
  });
});
