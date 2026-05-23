"use client";

import { PillSelect, type PillSelectOption } from "@/components/ui/pill-select";

const PERIOD_OPTIONS: PillSelectOption[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

interface PeriodSelectorProps {
  defaultValue?: string;
  onChange?: (value: string) => void;
}

export function PeriodSelector({ defaultValue = "30d", onChange }: PeriodSelectorProps) {
  return (
    <PillSelect
      options={PERIOD_OPTIONS}
      value={defaultValue}
      onValueChange={onChange ?? (() => {})}
    />
  );
}
