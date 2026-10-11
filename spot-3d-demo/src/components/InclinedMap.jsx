import React from 'react';
import { Segmented } from './ui.jsx';
import { tone } from '../lib/format.js';

const FLOORS = [1, 2];

/** Waypoints on one floor plane. x/y come from locations.csv (0–100, y up). */
export function FloorPlane({ waypoints, selected, onSelect, pulse, compact = false }) {
  const route = waypoints.map(w => `${w.x},${100 - w.y}`).join(' ');
  return (
    <div className={`plane${compact ? ' plane-compact' : ''}`}>
      <svg className="plane-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="minor" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" className="grid-minor" /></pattern>
          <pattern id="major" width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="url(#minor)" /><path d="M25 0H0V25" fill="none" className="grid-major" /></pattern>
        </defs>
        <rect width="100" height="100" fill="url(#major)" />
        {waypoints.length > 1 && <polyline points={route} className="route" />}
      </svg>
      {waypoints.map(w => (
        <button
          key={w.id}
          type="button"
          className={`wp tone-${tone(w.status)}${selected === w.id ? ' is-selected' : ''}${pulse === w.id ? ' is-pulsing' : ''}`}
          style={{ left: `${w.x}%`, top: `${100 - w.y}%` }}
          onClick={onSelect ? () => onSelect(selected === w.id ? null : w.id) : undefined}
          tabIndex={onSelect ? 0 : -1}
          aria-pressed={onSelect ? selected === w.id : undefined}
          aria-label={`${w.id} ${w.name}: ${w.status || 'unknown'}`}
        >
          <span className="wp-pin" aria-hidden="true" />
          <span className="wp-label">{w.id}</span>
        </button>
      ))}
    </div>
  );
}

/** Both floors as tilted planes; the toggle slides the active one forward. */
export default function InclinedMap({ waypoints, floor, onFloor, selected, onSelect, pulse }) {
  return (
    <div className="map">
      <div className="map-toolbar">
        <Segmented label="Floor" options={FLOORS.map(f => [f, `Floor ${f}`])} value={floor} onChange={onFloor} />
        <ul className="legend" aria-label="Status colours">
          <li><span className="dot tone-ok" />Normal</li>
          <li><span className="dot tone-warn" />Watch</li>
          <li><span className="dot tone-bad" />Action</li>
        </ul>
      </div>
      <div className="map-stage">
        <div className="floors">
          {FLOORS.map(f => {
            const offset = f - floor;
            return (
              <div
                key={f}
                className={`floor${offset === 0 ? ' is-active' : ''}`}
                style={{ '--offset': offset }}
                aria-hidden={offset !== 0}
                inert={offset !== 0}
              >
                <span className="floor-tag">Floor {f}</span>
                <FloorPlane waypoints={waypoints.filter(w => w.floor === f)} selected={selected} onSelect={onSelect} pulse={pulse} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
