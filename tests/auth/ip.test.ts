import { expect, test } from "vitest";
import { normalizeIp } from "@/server/auth/current";

test("IP normalleştirme", () => {
  expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
  expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  expect(normalizeIp("2001:db8:abcd:12:1:2:3:4")).toBe("2001:0db8:abcd:0012::/64");
  expect(normalizeIp("2001:db8:abcd:12::99")).toBe("2001:0db8:abcd:0012::/64");
  expect(normalizeIp("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
  expect(normalizeIp("uydurma")).toBe("gecersiz");
  expect(normalizeIp("1.2.3.4, 5.6.7.8")).toBe("gecersiz");
});
