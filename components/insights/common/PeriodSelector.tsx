"use client";

import { useRouter, usePathname } from "next/navigation";

import { PillSelect, type PillSelectOption } from "@/components/ui/pill-select";

const PERIOD_OPTIONS: PillSelectOption[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

interface PeriodSelectorProps {
  value?: string;
}

export function PeriodSelector({ value = "30d" }: PeriodSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <PillSelect
      options={PERIOD_OPTIONS}
      value={value}
      onValueChange={(v) => router.push(`${pathname}?period=${v}`)}
    />
  );
}
