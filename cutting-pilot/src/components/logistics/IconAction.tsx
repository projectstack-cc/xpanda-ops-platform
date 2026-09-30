// src/components/logistics/IconAction.tsx
// lgx-rows-01: the one icon-only action primitive for the v2 logistics row actions (BolActions,
// LoadingSheetButton order mode, SignedBolButton). 38x38 square, icon at 16. Label is the tooltip +
// aria-label; when disabledReason is set the action is grayed, inert, and the tooltip shows the reason.
// href -> <a> (a <span> when disabled); onClick -> <button>. Tokens only.
import type { LucideIcon } from "lucide-react";

interface IconActionProps {
  icon: LucideIcon;
  label: string;
  disabledReason?: string | null;
  variant?: "default" | "primary";
  href?: string;
  onClick?: () => void;
}

const base = "w-[38px] h-[38px] inline-flex items-center justify-center rounded-lg shrink-0 no-underline";

const variantCls = {
  default: "border border-[var(--border)] bg-[var(--surface)] text-text",
  primary: "bg-[var(--brand)] text-white shadow-sm",
} as const;

const hoverCls = {
  default: "hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer",
  primary: "hover:opacity-90 transition-opacity cursor-pointer",
} as const;

export default function IconAction({
  icon: Icon,
  label,
  disabledReason,
  variant = "default",
  href,
  onClick,
}: IconActionProps) {
  const icon = <Icon size={16} aria-hidden="true" />;

  if (disabledReason) {
    const cls = `${base} ${variantCls[variant]} opacity-40 cursor-not-allowed`;
    if (href !== undefined) {
      return (
        <span className={cls} role="link" aria-label={label} aria-disabled="true" title={disabledReason}>
          {icon}
        </span>
      );
    }
    return (
      <button type="button" className={cls} aria-label={label} aria-disabled="true" title={disabledReason}>
        {icon}
      </button>
    );
  }

  const cls = `${base} ${variantCls[variant]} ${hoverCls[variant]}`;
  if (href) {
    return (
      <a href={href} className={cls} aria-label={label} title={label}>
        {icon}
      </a>
    );
  }
  return (
    <button type="button" className={cls} aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  );
}
