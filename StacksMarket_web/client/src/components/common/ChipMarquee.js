import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaFire, FaStar } from "react-icons/fa";

/**
 * items: [{ type: 'category'|'tag'|'author'|'trending'|'featured', label: string }]
 * speedPxPerSec: velocidad base usada para calcular la duración según el ancho
 * fadeEdges: si true, aplica un “mask” sutil en los bordes
 * className: clases extra para el contenedor
 */
const ChipMarquee = ({
  items = [],
  speedPxPerSec = 60,
  fadeEdges = false,
  className = "",
}) => {
  const containerRef = useRef(null);
  const trackRef = useRef(null);
  const [duration, setDuration] = useState(16);
  const [paused, setPaused] = useState(false);

  // Duplicamos los items para el bucle infinito
  const doubled = useMemo(() => [...items, ...items], [items]);

  // Recalcular duración en función del ancho (mitad del track)
  useEffect(() => {
    if (!trackRef.current || !containerRef.current) return;
    const halfWidth =
      trackRef.current.scrollWidth / 2 || containerRef.current.clientWidth;
    const pxPerSec = Math.max(30, speedPxPerSec);
    const d = Math.max(10, halfWidth / pxPerSec);
    setDuration(d);
  }, [items, speedPxPerSec]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden w-full ${fadeEdges ? "mask-fade-x" : ""} ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ height: 32 }}
    >
      <div
        ref={trackRef}
        className="absolute inset-0 flex items-center gap-2 whitespace-nowrap chip-marquee"
        style={{
          //  Longhand (soluciona el warning)
          animationName: "bw-marquee",
          animationDuration: `${duration}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        {doubled.map((it, idx) => (
          <Chip key={`${it?.type || "tag"}-${it?.label}-${idx}`} type={it.type} label={it.label} />
        ))}
      </div>
    </div>
  );
};

const Chip = ({ type, label = "" }) => {
  if (type === "category") {
    return (
      <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
        {label}
      </span>
    );
  }
  if (type === "author") {
    return (
      <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
        @{label.replace(/^@/, "")}
      </span>
    );
  }
  if (type === "trending") {
    return (
      <span className="px-2 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
        <FaFire className="w-3 h-3" />
        Trending
      </span>
    );
  }
  if (type === "featured") {
    return (
      <span className="px-2 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 bg-stacks-100 text-stacks-700 dark:bg-stacks-900/40 dark:text-stacks-300">
        <FaStar className="w-3 h-3" />
        Featured
      </span>
    );
  }
  // tag por defecto
  return (
    <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
      #{label.replace(/^#/, "")}
    </span>
  );
};

export default ChipMarquee;
