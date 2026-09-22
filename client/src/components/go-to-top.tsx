import { useEffect, useState } from "react";

/**
 * Floating "go to top" button, anchored to the bottom-right corner.
 *
 * The client portal scrolls inside `<main class="overflow-y-auto">`, not the
 * window, so `window.scrollTo` has no effect there. The button finds the nearest
 * scrollable ancestor of its own anchor instead, which keeps working if the page
 * that renders it changes its scroll region.
 */
function findScrollContainer(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function GoToTop({ threshold = 300 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  // Resolve the scroll container once the anchor is mounted.
  useEffect(() => {
    if (!anchor) return;
    setContainer(findScrollContainer(anchor));
  }, [anchor]);

  useEffect(() => {
    if (!container) return;

    const onScroll = () => setVisible(container.scrollTop > threshold);
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [container, threshold]);

  const scrollToTop = () => {
    (container ?? document.documentElement).scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div ref={setAnchor} className="pointer-events-none fixed bottom-6 right-6 z-40">
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Go to top"
        data-testid="button-go-to-top"
        className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-all duration-300 hover:bg-accent hover:text-accent-foreground hover:shadow-xl ${
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
