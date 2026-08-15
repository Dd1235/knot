// Every route announced as "Knot", so a screen-reader user got no signal
// that navigation had happened. The pages are client components and
// cannot export metadata themselves; a layout can.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investments · Knot" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
