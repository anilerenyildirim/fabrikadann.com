import type { AddressSnapshot } from "@/server/db/schema";

export type PaymentStartInput = {
  /** Bu ödeme denemesine özel tek kullanımlık kimlik (payments.token) */
  token: string;
  callbackUrl: string;
  order: {
    id: string;
    number: string;
    total: number;
    email: string;
    ip: string;
    address: AddressSnapshot;
    items: { name: string; sku: string; unitPrice: number; quantity: number }[];
  };
};

export interface PaymentProvider {
  readonly name: string;
  /** Müşterinin ödeme yapacağı adres ve (varsa) sağlayıcının ödeme oturumu kimliği. */
  start(input: PaymentStartInput): Promise<{ redirectUrl: string; providerSessionId?: string }>;
}
