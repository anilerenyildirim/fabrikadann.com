"use client";

import { Button } from "@/components/ui/form";

export function PrintButton({ label = "Yazdır" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="min-h-11 px-4">
      {label}
    </Button>
  );
}
