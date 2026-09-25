"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { homeSections } from "../../lib/constants/home-sections";
import {
  hexagonMark,
  hexagonOutline,
  hexagonPoints,
} from "../../lib/constants/hexagon";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const interpolate = (start: number, end: number, progress: number) =>
  start + (end - start) * progress;
const dockSize = 160;

export function HexagonDock() {
  const dockRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dock = dockRef.current;
    const source = document.querySelector<HTMLDivElement>(
      "#hexagon .hex-diagram",
    );
    const slot = document.querySelector<HTMLDivElement>(
      "#hexagon .hex-diagram-slot",
    );
    const contact = document.getElementById("contacto");
    const sections = homeSections.map(({ id }) => document.getElementById(id));
    if (
      !dock ||
      !source ||
      !slot ||
      !contact ||
      sections.some((section) => !section)
    )
      return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 1024px)");
    let frame = 0;
    let currentIndex = -1;

    const restoreSource = () => {
      for (const property of [
        "position",
        "left",
        "top",
        "width",
        "height",
        "margin",
        "z-index",
        "transform",
        "transform-origin",
        "opacity",
        "visibility",
        "pointer-events",
        "--hex-travel-copy-opacity",
      ]) {
        source.style.removeProperty(property);
      }
      source.removeAttribute("data-traveling");
      source.inert = false;
    };

    const update = () => {
      frame = 0;
      if (!desktop.matches) {
        restoreSource();
        dock.style.opacity = "0";
        dock.style.visibility = "hidden";
        dock.style.pointerEvents = "none";
        dock.inert = true;
        return;
      }

      const slotRect = slot.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const height = window.innerHeight;
      const scroll = window.scrollY;
      const slotDocumentTop = slotRect.top + scroll;
      // The slot keeps the hero layout stable while the same diagram travels to the dock.
      const startScroll = Math.max(
        0,
        slotDocumentTop + slotRect.height - height * 0.78,
      );
      const progress = reducedMotion.matches
        ? Number(scroll > startScroll + height * 0.56)
        : clamp((scroll - startScroll) / (height * 0.65));
      const eased = progress * progress * (3 - 2 * progress);
      const x = interpolate(slotRect.left, dockRect.left, eased);
      const y = interpolate(slotDocumentTop - startScroll, dockRect.top, eased);
      const scale = interpolate(1, dockSize / slotRect.width, eased);
      const dockEntrance = reducedMotion.matches
        ? progress
        : clamp((progress - 0.88) / 0.12);
      const contactTop = contact.getBoundingClientRect().top;
      const contactFade = clamp((contactTop - height * 0.3) / (height * 0.4));
      let nextIndex = 0;
      sections.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= height * 0.48)
          nextIndex = index;
      });

      if (reducedMotion.matches || progress === 0) {
        restoreSource();
        if (progress === 1) {
          source.style.visibility = "hidden";
          source.inert = true;
        }
      } else {
        source.dataset.traveling = "true";
        source.inert = true;
        source.style.position = "fixed";
        source.style.left = "0";
        source.style.top = "0";
        source.style.width = `${slotRect.width}px`;
        source.style.height = `${slotRect.height}px`;
        source.style.margin = "0";
        source.style.zIndex = "26";
        source.style.transformOrigin = "top left";
        source.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        source.style.opacity = String(1 - dockEntrance);
        source.style.visibility = dockEntrance < 0.99 ? "visible" : "hidden";
        source.style.pointerEvents = "none";
        source.style.setProperty(
          "--hex-travel-copy-opacity",
          String(clamp((0.6 - progress) / 0.4)),
        );
      }

      dock.style.opacity = String(dockEntrance * contactFade);
      dock.style.visibility =
        dockEntrance * contactFade > 0.01 ? "visible" : "hidden";
      dock.style.pointerEvents =
        dockEntrance > 0.98 && contactFade > 0.2 ? "auto" : "none";
      dock.inert = dockEntrance <= 0.98 || contactFade <= 0.2;
      dock.style.setProperty("--dock-surface-opacity", String(dockEntrance));

      if (nextIndex !== currentIndex) {
        currentIndex = nextIndex;
        setActiveIndex(nextIndex);
      }
    };

    const queueUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);
    reducedMotion.addEventListener("change", queueUpdate);
    desktop.addEventListener("change", queueUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      restoreSource();
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      reducedMotion.removeEventListener("change", queueUpdate);
      desktop.removeEventListener("change", queueUpdate);
    };
  }, []);

  return (
    <nav
      className="hex-dock"
      ref={dockRef}
      aria-label="Secciones de la página"
      inert
    >
      <div className="hex-dock-move">
        <div className="hex-dock-heading">EN ESTA PÁGINA</div>
        <div className="hex-dock-mark">
          <svg viewBox="0 0 600 600" aria-hidden="true">
            <defs>
              <linearGradient id="dock-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#2563eb" />
                <stop offset=".5" stopColor="#9333ea" />
                <stop offset="1" stopColor="#ea580c" />
              </linearGradient>
            </defs>
            <circle
              cx="300"
              cy="300"
              r="270"
              fill="none"
              stroke="#dce4ef"
              strokeDasharray="2 7"
            />
            <circle cx="300" cy="300" r="171" fill="none" stroke="#dce4ef" />
            <path
              d={hexagonOutline}
              stroke="url(#dock-gradient)"
              strokeWidth="3"
              fill="none"
            />
            <g
              className="hex-dock-rotor"
              style={
                { "--dock-angle": `${activeIndex * 12}deg` } as CSSProperties
              }
            >
              <g className="hex-rotor-bars">
                <path
                  d={hexagonMark}
                  transform="translate(0 -30)"
                  fill="none"
                  stroke="#1e40af"
                  strokeWidth="11"
                />
              </g>
            </g>
          </svg>
          <ol className="hex-dock-points">
            {homeSections.map((section, index) => (
              <li
                key={section.id}
                style={{
                  left: `${hexagonPoints[index]!.x}%`,
                  top: `${hexagonPoints[index]!.y}%`,
                }}
              >
                <a
                  href={`#${section.id}`}
                  aria-label={`Ir a ${section.label}`}
                  aria-current={activeIndex === index ? "location" : undefined}
                  title={section.label}
                >
                  <span>{index + 1}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
        <div className="hex-dock-caption" aria-live="off">
          <span>{String(activeIndex + 1).padStart(2, "0")} / 06</span>
          <strong>{homeSections[activeIndex]!.label}</strong>
        </div>
      </div>
    </nav>
  );
}
