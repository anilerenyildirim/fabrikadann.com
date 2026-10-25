"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const ADMIN_NAV = [
  { href: "/yonetim", label: "Pano" },
  { href: "/yonetim/siparisler", label: "Siparişler" },
  { href: "/yonetim/urunler", label: "Ürünler" },
  { href: "/yonetim/kategoriler", label: "Kategoriler" },
  { href: "/yonetim/stok", label: "Stok" },
  { href: "/yonetim/musteriler", label: "Müşteriler" },
  { href: "/yonetim/ayarlar", label: "Ayarlar" },
  { href: "/yonetim/gunluk", label: "İşlem günlüğü" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/yonetim" ? pathname === "/yonetim" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobilde üstte yatay kayan şerit, geniş ekranda dikey yan menü. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Yönetim menüsü">
      <ul className="rail gap-1 px-2 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0">
        {ADMIN_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`label flex min-h-11 items-center whitespace-nowrap px-3 lg:px-6 ${
                  active ? "bg-ink text-paper" : "text-graphite hover:text-ink lg:hover:bg-fog"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
