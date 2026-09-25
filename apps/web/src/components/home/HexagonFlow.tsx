"use client";

import { useState, type CSSProperties } from "react";
import { ArrowDownRight } from "lucide-react";
import { phases } from "../../lib/constants/phases";
import {
  hexagonMark,
  hexagonOutline,
  hexagonPoints,
} from "../../lib/constants/hexagon";
import { trackEvent } from "../../lib/utils/tracking";

export function HexagonFlow() {
  const [active, setActive] = useState<number | null>(null);
  const phase = active === null ? null : phases[active];
  return (
    <div className="hex-panel" id="hexagon">
      <div className="hex-panel-header">
        <span>TODO CONECTADO EN AETHER</span>
      </div>
      <div className="hex-diagram-slot">
        <div className="hex-diagram" data-exploring={active !== null}>
          <svg
            viewBox="0 0 600 600"
            width="600"
            height="600"
            className="hex-geometry"
            role="img"
            aria-label="Hexágono del ciclo de seis fases de Aether"
          >
            <defs>
              <linearGradient id="phase-gradient" x1="0" y1="0" x2="1" y2="1">
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
              stroke="url(#phase-gradient)"
              strokeWidth="2"
              fill="none"
            />
            <g className="hex-spokes" stroke="#cbd5e1" strokeDasharray="3 5">
              {hexagonPoints.map((point, index) => (
                <path
                  key={index}
                  data-active={active === index}
                  d={`M300 300 ${point.x * 6} ${point.y * 6}`}
                />
              ))}
            </g>
            <g
              className="hex-connections"
              fill="none"
              strokeWidth="3"
              aria-hidden="true"
            >
              {hexagonPoints.map((point, index) => {
                const next = hexagonPoints[(index + 1) % hexagonPoints.length]!;
                return (
                  <path
                    key={index}
                    pathLength="1"
                    data-active={active === index}
                    style={
                      {
                        "--connection-color": phases[index]!.color,
                      } as CSSProperties
                    }
                    d={`M${point.x * 6} ${point.y * 6} ${next.x * 6} ${next.y * 6}`}
                  />
                );
              })}
            </g>
            <g className="hex-rotor">
              <g className="hex-rotor-bars">
                <path
                  d={hexagonMark}
                  transform="translate(0 -30)"
                  fill="none"
                  stroke="#1e40af"
                  strokeWidth="9"
                />
              </g>
            </g>
          </svg>
          <div className="hex-center" aria-hidden="true">
            <span>AETHER</span>
          </div>
          <ol className="hex-nodes" aria-label="Explorar fases">
            {phases.map((item, index) => {
              const point = hexagonPoints[index]!;
              const Icon = item.icon;
              return (
                <li
                  key={item.id}
                  data-active={active === index}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  style={
                    {
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                      "--phase-color": item.color,
                    } as CSSProperties
                  }
                >
                  <a
                    href={`#phase-${item.id}`}
                    className="hex-node"
                    aria-label={`Fase ${index + 1}: ${item.name}`}
                    aria-describedby={
                      active === index ? `tooltip-${item.id}` : undefined
                    }
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setActive(null);
                    }}
                    onClick={() => {
                      setActive(null);
                      trackEvent("phase_select", item.id);
                    }}
                  >
                    <span className="hex-node-number">{index + 1}</span>
                    <span className="hex-node-label">{item.name}</span>
                  </a>
                  {active === index && (
                    <div
                      className="hex-tooltip"
                      role="tooltip"
                      id={`tooltip-${item.id}`}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>
                        {item.name}
                        <small>{item.output}</small>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="hex-panel-footer">
        <span>
          <ArrowDownRight size={16} aria-hidden="true" />
          {phase ? phase.name : "Explora cada fase del ciclo"}
        </span>
      </div>
    </div>
  );
}
