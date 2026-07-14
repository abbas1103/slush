import { cn } from "@/lib/utils/cn";
import { formatPence, type FormatOpts } from "@/lib/utils/money";

interface MoneyProps extends FormatOpts {
  /** Amount in integer pence. */
  pence: number;
  className?: string;
}

/** Render integer pence as a GBP string with tabular figures. */
export function Money({ pence, stripZeros, grouped, className }: MoneyProps) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatPence(pence, { stripZeros, grouped })}
    </span>
  );
}
