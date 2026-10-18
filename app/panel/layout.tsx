import PanelApp from "@/components/panel/PanelApp";

// El layout se conserva al navegar entre /panel/…: por eso el panel vive acá y no en las páginas.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (<><PanelApp />{children}</>);
}
