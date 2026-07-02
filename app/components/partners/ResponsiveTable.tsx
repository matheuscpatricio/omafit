import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ResponsiveTableProps = {
  children: ReactNode;
  className?: string;
  minWidth?: number;
};

/** Tabela com scroll horizontal em telas estreitas. */
export function ResponsiveTable({
  children,
  className,
  minWidth = 520,
}: ResponsiveTableProps) {
  return (
    <div
      className={cn(
        "omafit-partners-table-scroll w-full max-w-[100vw] overflow-x-auto",
        className,
      )}
    >
      <div className="w-full" style={{ minWidth: `${minWidth}px` }}>
        {children}
      </div>
    </div>
  );
}
