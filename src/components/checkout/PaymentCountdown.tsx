"use client";

import { useEffect, useState } from "react";

const minutesLeft = (deadline: number) => Math.max(0, Math.ceil((deadline - Date.now()) / 60_000));

/**
 * Ödeme için kalan dakika. İlk çizim sunucunun hesapladığı değerle yapılır (hidrasyon
 * uyuşmazlığı olmasın), sonra yarım dakikada bir güncellenir.
 */
export function PaymentCountdown({ deadline, initialMinutes }: { deadline: number; initialMinutes: number }) {
  const [minutes, setMinutes] = useState(initialMinutes);

  useEffect(() => {
    const tick = () => setMinutes(minutesLeft(deadline));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (minutes <= 0) return <>Ödeme süresi doldu. Güncel durumu görmek için sayfayı yenileyin.</>;
  return <>Kalan süre: yaklaşık {minutes} dakika.</>;
}
