import { beforeEach, expect, test, vi } from "vitest";
import type { ValidSession } from "@/server/auth/session";

// Oturum ve yönlendirme çerez/istek gerektirir; burada yalnızca karar mantığı sınanır
const session = vi.hoisted(() => ({ current: null as ValidSession | null }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

vi.mock("@/server/auth/current", () => ({
  getSession: async () => session.current,
  requireUser: async (returnTo: string) => {
    if (!session.current) throw new Error(`REDIRECT /giris?sonra=${encodeURIComponent(returnTo)}`);
    return session.current.user;
  },
}));

const { requireAccountUser } = await import("@/components/account/guard");

function sessionFor(role: "customer" | "admin", secondFactor: boolean): ValidSession {
  return {
    user: { id: "u1", email: "a@ornek.com", firstName: "A", lastName: "B", phone: null, role },
    secondFactor,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

beforeEach(() => {
  session.current = null;
});

test("oturum yoksa giriş sayfasına, dönüş adresiyle", async () => {
  await expect(requireAccountUser("/hesabim/adresler")).rejects.toThrow("REDIRECT /giris?sonra=%2Fhesabim%2Fadresler");
});

test("müşteri oturumu geçer", async () => {
  session.current = sessionFor("customer", false);
  expect((await requireAccountUser("/hesabim")).id).toBe("u1");
});

test("yalnızca parolayla açılmış yönetici oturumu hesap verilerine erişemez, ikinci adıma gönderilir", async () => {
  session.current = sessionFor("admin", false);
  await expect(requireAccountUser("/hesabim/profil")).rejects.toThrow("REDIRECT /yonetim/iki-adim");
});

test("iki adımı geçmiş yönetici oturumu geçer", async () => {
  session.current = sessionFor("admin", true);
  expect((await requireAccountUser("/hesabim")).role).toBe("admin");
});
