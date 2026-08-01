import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Icon from "./Icon";
import type { ReactNode } from "react";
import { buttonClass } from "./Button";

/** The sticky page header, previously copy-pasted byte-identically into five
 * pages. `children` is the sub-row slot (balance pills, tabs, stat grid).
 *
 * `measure` must match the page's own content width. The header used to run
 * edge to edge while every page centred its content in a narrower column, so
 * on a wide screen the title sat hard against the window while the first line
 * of content started hundreds of pixels inward — the two never lined up.
 * The bar still spans the full width (it is a surface); only what is written
 * on it is constrained.
 */
export default function AppHeader({
  title,
  back,
  actions,
  children,
  gold = false,
  measure = "max-w-2xl",
}: {
  title: ReactNode;
  back?: string;
  actions?: ReactNode;
  children?: ReactNode;
  gold?: boolean;
  measure?: string;
}) {
  return (
    <header
      className={`sticky top-0 z-10 border-b border-line bg-surface-base/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur ${
        gold ? "hairline-gold" : ""
      }`}
    >
      <div className={`mx-auto w-full ${measure}`}>
        <div className="flex h-14 items-center justify-between gap-3">
          <h1 className="flex shrink-0 items-center gap-2 text-[19px] font-semibold tracking-[-0.015em]">
            {title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {back && (
              <Link href={back} className={buttonClass("ghost", "sm")}>
                <Icon as={ArrowLeft} size={14} />
                chat
              </Link>
            )}
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
