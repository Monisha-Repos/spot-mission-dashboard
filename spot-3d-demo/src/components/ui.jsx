import React from "react";
import { batteryState } from "../lib/display.js";

export function Icon({ name, size = 19, ...props }) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    replay: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4Z" />
      </>
    ),
    live: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M7 15l4-5 4 2 6-8" />
      </>
    ),
    notes: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 3h6v3H9ZM9 11h6M9 15h6" />
      </>
    ),
    robot: (
      <>
        <path d="M4 8h15v7H4ZM6 15l-2 6M16 15l3 6M19 10h3M8 5v3M5 11h1" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="m7 17 10-10M7 7h10v10" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    reset: <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    flag: (
      <>
        <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8ZM2 12l10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    spark: (
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" />
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v.5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    filter: (
      <>
        <path d="M4 7h16M7 12h10M10 17h4" />
      </>
    ),
    cube: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8Z" />
        <path d="m3 8 9 5 9-5M12 13v9" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.dashboard}
    </svg>
  );
}

export function BatteryGauge({
  value,
  compact = false,
  label = "Remaining battery",
}) {
  const { percent, tone } = batteryState(value);
  return (
    <span
      className={`battery-gauge ${tone} ${compact ? "compact" : ""}`}
      role={percent === null ? undefined : "meter"}
      aria-label={percent === null ? `${label}: unavailable` : label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? undefined : `${percent}%`}
    >
      <span className="battery-shell" aria-hidden="true">
        <span className="battery-track">
          <span
            className="battery-fill"
            style={{ width: `${percent ?? 0}%` }}
          />
        </span>
      </span>
      <span className="battery-number">
        {percent === null ? "—" : `${percent}%`}
      </span>
    </span>
  );
}

export function Badge({ value, children }) {
  const tone = ["CRITICAL", "FAILED"].includes(value)
    ? "danger"
    : ["HIGH", "MEDIUM", "REVIEW", "VERIFY", "QUESTIONABLE"].includes(value)
      ? "warning"
      : ["RUNNING", "IN_PROGRESS"].includes(value)
        ? "active"
        : ["SUCCESS", "COMPLETED", "GOOD"].includes(value)
          ? "good"
          : "neutral";
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children ||
        String(value || "Unknown")
          .toLowerCase()
          .replaceAll("_", " ")}
    </span>
  );
}

export function Button({ icon, children, className = "", ...props }) {
  return (
    <button className={`button ${className}`} {...props}>
      {icon && <Icon name={icon} size={16} />} {children}
    </button>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <Icon name="spark" size={25} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
