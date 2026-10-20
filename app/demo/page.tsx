import type { Metadata } from "next";
import EntrarDemo from "@/components/panel/EntrarDemo";

export const metadata: Metadata = { title: "Demo en vivo · Go Fluxo", robots: { index: false, follow: false } };

export default function Demo() {
  return <EntrarDemo />;
}
