import { useState, useEffect, useRef } from "react";

export function useVirtualList({ items, itemHeight = 48, overscan = 5 }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  };

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex).map((item, i) => ({
    item,
    index: startIndex + i,
    style: {
      position: "absolute",
      top: (startIndex + i) * itemHeight,
      height: itemHeight,
      left: 0,
      right: 0,
    },
  }));

  return {
    containerRef,
    onScroll: handleScroll,
    totalHeight,
    visibleItems,
    startIndex,
    endIndex,
  };
}
