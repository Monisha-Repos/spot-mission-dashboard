/** SPOTlight deterministic analytics. All inputs retain the supplied source IDs.
 * No numeric safety thresholds or model confidence scores are inferred.
 * Timestamps are source-local ISO strings, intentionally never time-zone converted.
 */
export const SEVERITY_RANK = Object.freeze({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 });
const TERMINAL_EVENTS = new Set(['ACTION_COMPLETED', 'ACTION_FAILED']);
const EMPTY = Object.freeze([]);
const indexes = new WeakMap();
const pct = (numerator, denominator) => denominator ? 100 * numerator / denominator : null;
const before = (timestamp, asOf) => !asOf || Boolean(timestamp && timestamp <= asOf);
const groupBy = (rows, key) => {
  const result = new Map();
  for (const row of rows || EMPTY) {
    const value = row[key];
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  }
  return result;
};

export function humanize(value = '') {
  return String(value).toLowerCase().replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
}

export function formatTimestamp(timestamp, { date = true, seconds = false } = {}) {
  if (!timestamp) return 'Not available';
  const match = String(timestamp).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return String(timestamp);
  const [, year, month, day, hour, minute, second = '00'] = match;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const time = `${hour}:${minute}${seconds ? ':' + second : ''}`;
  return date ? `${months[Number(month) - 1]} ${Number(day)}, ${year} · ${time}` : time;
}

export function createIndex(data) {
  if (indexes.has(data)) return indexes.get(data);
  const index = {
    missions: new Map((data.missions || EMPTY).map(row => [row.mission_id, row])),
    actions: new Map((data.actions || EMPTY).map(row => [row.action_id, row])),
    locations: new Map((data.locations || EMPTY).map(row => [row.location_id, row])),
    assets: new Map((data.assets || EMPTY).map(row => [row.asset_id, row])),
    actionsByMission: groupBy(data.actions, 'mission_id'),
    readingsByAction: groupBy(data.readings, 'action_id'),
    anomaliesByAction: groupBy(data.anomalies, 'action_id'),
    eventsByMission: groupBy(data.replay, 'mission_id'),
  };
  indexes.set(data, index);
  return index;
}

/** Explicitly distinguish source quality, numeric localization telemetry and unavailable limits. */
export function assessReading(reading) {
  return {
    quality: reading.quality || 'UNSPECIFIED',
    needsVerification: reading.quality === 'QUESTIONABLE',
    numericConfidence: null,
    threshold: null,
    thresholdStatus: 'NOT_PROVIDED',
    explanation: reading.measurement_type === 'LOCALIZATION_CONFIDENCE_PCT'
      ? 'This value describes robot localization confidence only; it is not confidence in other inspection readings.'
      : reading.quality === 'QUESTIONABLE'
        ? 'The supplied reading quality is QUESTIONABLE. Verify the measurement before relying on it.'
        : 'Quality is a label supplied by the kit. No numeric operating limit or confidence probability is provided.',
  };
}

export function classifyAction(action, readings = [], anomalies = []) {
  const sorted = [...anomalies].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const highest = sorted[0];
  const reasons = [];
  if (highest) reasons.push(`${humanize(highest.severity)} source flag: ${humanize(highest.anomaly_type).toLowerCase()}`);
  if (action.status === 'FAILED') reasons.push(`Action failed: ${humanize(action.failure_type || 'Unspecified failure').toLowerCase()}`);
  const questionable = readings.filter(reading => reading.quality === 'QUESTIONABLE').length;
  if (questionable) reasons.push(`${questionable} reading${questionable === 1 ? '' : 's'} marked QUESTIONABLE`);
  if (action.locationMismatch) reasons.push('Recorded waypoint differs from the asset registry');
  const requiresAttention = reasons.length > 0;
  let priority = highest?.severity || (action.status === 'FAILED' ? 'REVIEW' : questionable ? 'VERIFY' : action.locationMismatch ? 'MAPPING' : 'NONE');
  let rank = SEVERITY_RANK[priority] || (priority === 'REVIEW' ? 2.5 : priority === 'VERIFY' ? 0.8 : priority === 'MAPPING' ? 0.5 : 0);
  // A failed inspection remains visible even when accompanied by a lower-severity flag.
  if (action.status === 'FAILED') rank = Math.max(rank, 2.5);
  return {
    label: highest ? `${humanize(highest.severity)} flag` : action.status === 'FAILED' ? 'Inspection gap' : questionable ? 'Verify reading' : action.locationMismatch ? 'Verify location' : action.status === 'RUNNING' ? 'In progress' : 'No source flag',
    tone: highest?.severity === 'CRITICAL' || highest?.severity === 'HIGH' ? 'danger' : requiresAttention ? 'warning' : action.status === 'RUNNING' ? 'info' : 'success',
    priority, rank, reasons, requiresAttention,
    highestSeverity: highest?.severity || null,
    operatorReviewRequired: anomalies.some(anomaly => anomaly.operator_review_required === true),
    questionableReadings: questionable,
    evidenceQuality: !readings.length ? 'NO_READING' : questionable ? 'QUESTIONABLE' : readings.every(reading => reading.quality === 'GOOD') ? 'GOOD' : 'UNSPECIFIED',
  };
}

function joinAction(index, action, { asOf, completed = true, reconstructed = false, reconstruct = true } = {}) {
  const asset = index.assets.get(action.asset_id) || null;
  const location = index.locations.get(action.location_id) || null;
  const readings = completed && reconstruct ? (index.readingsByAction.get(action.action_id) || EMPTY)
    .filter(row => before(row.timestamp, asOf))
    .map(row => ({ ...row, reconstructed, assessment: assessReading(row) })) : [];
  const anomalies = completed && reconstruct ? (index.anomaliesByAction.get(action.action_id) || EMPTY)
    .filter(row => before(row.timestamp, asOf)).map(row => ({ ...row, reconstructed })) : [];
  const joined = { ...action, asset, location, readings, anomalies, locationMismatch: Boolean(asset && action.location_id !== asset.location_id) };
  return { ...joined, classification: classifyAction(joined, readings, anomalies) };
}

function summarizeRows(actions, readings, anomalies, missionRows = []) {
  const successfulActions = actions.filter(action => action.status === 'SUCCESS').length;
  const failedActions = actions.filter(action => action.status === 'FAILED').length;
  const terminalActions = successfulActions + failedActions;
  const completedMissions = missionRows.filter(mission => mission.mission_status === 'COMPLETED').length;
  const terminalMissions = missionRows.filter(mission => ['COMPLETED', 'FAILED'].includes(mission.mission_status)).length;
  const withReadings = actions.filter(action => action.readings.length).length;
  return {
    totalActions: actions.length,
    terminalActions,
    successfulActions,
    failedActions,
    runningActions: actions.filter(action => action.status === 'RUNNING').length,
    successRate: pct(successfulActions, terminalActions),
    readingsCount: readings.length,
    questionableReadings: readings.filter(reading => reading.quality === 'QUESTIONABLE').length,
    goodReadings: readings.filter(reading => reading.quality === 'GOOD').length,
    anomalyCount: anomalies.length,
    criticalAnomalies: anomalies.filter(anomaly => anomaly.severity === 'CRITICAL').length,
    highAnomalies: anomalies.filter(anomaly => anomaly.severity === 'HIGH').length,
    reviewRequired: anomalies.filter(anomaly => anomaly.operator_review_required === true).length,
    locationMismatchCount: actions.filter(action => action.locationMismatch).length,
    missingReadings: actions.filter(action => ['SUCCESS', 'FAILED'].includes(action.status) && !action.readings.length).length,
    actionsWithReadings: withReadings,
    coverageRate: pct(withReadings, terminalActions),
    attentionCount: actions.filter(action => action.classification.requiresAttention).length,
    missionCount: missionRows.length,
    completedMissionCount: completedMissions,
    missionCompletionRate: pct(completedMissions, terminalMissions),
  };
}

/**
 * Build a time-consistent mission view. eventIndex is inclusive within the chosen
 * mission's event list, preserving START/COMPLETED distinction at equal timestamps.
 * replay:false uses the archived CSV. replay:true uses only observed event outcomes.
 * Pass reconstruct:false for a live stream with no separately received sensor data.
 */
export function missionSnapshot(data, missionId, asOf = null, options = {}) {
  const index = createIndex(data);
  const sourceMission = index.missions.get(missionId) || null;
  const allEvents = (options.events ?? index.eventsByMission.get(missionId) ?? EMPTY).filter(event => event.mission_id === missionId);
  const boundedEvents = options.eventIndex == null ? allEvents : allEvents.slice(0, Math.max(0, options.eventIndex + 1));
  const events = boundedEvents.filter(event => before(event.timestamp, asOf));
  const observationCutoff = asOf || (options.replay ? events.at(-1)?.timestamp || null : null);
  let missionStatus;
  let actions;
  let mission;
  if (options.replay) {
    const observed = new Map();
    let started = null;
    let ended = null;
    for (const event of events) {
      const details = event.details || {};
      if (event.event_type === 'MISSION_STARTED') started = event;
      if (event.event_type === 'MISSION_COMPLETED') ended = event;
      if ((event.event_type === 'ACTION_STARTED' || TERMINAL_EVENTS.has(event.event_type)) && details.action_id) {
        const sourceAction = index.actions.get(details.action_id);
        const previous = observed.get(details.action_id);
        const isTerminal = TERMINAL_EVENTS.has(event.event_type);
        // Historical fields are used for identity/context, never for an unobserved outcome.
        const base = previous || {
          ...(sourceAction || {}), action_id: details.action_id, mission_id: missionId,
          timestamp: event.timestamp, status: 'RUNNING', failure_type: '',
          duration_sec: null, sourceStatus: null,
        };
        observed.set(details.action_id, {
          ...base, ...details,
          status: isTerminal ? (details.status || (event.event_type === 'ACTION_FAILED' ? 'FAILED' : 'SUCCESS')) : previous?.status || 'RUNNING',
          failure_type: isTerminal ? details.failure_type || '' : previous?.failure_type || '',
          duration_sec: isTerminal ? sourceAction?.duration_sec ?? null : base.duration_sec,
          sourceStatus: isTerminal ? details.status || (event.event_type === 'ACTION_FAILED' ? 'FAILED' : 'SUCCESS') : null,
          lastEventId: event.event_id,
          observedTerminal: isTerminal || previous?.observedTerminal || false,
        });
      }
    }
    missionStatus = ended ? ended.details?.status || 'COMPLETED' : started ? 'IN_PROGRESS' : 'NOT_STARTED';
    mission = sourceMission || started ? {
      ...(sourceMission || { mission_id: missionId, mission_name: missionId }),
      ...(started?.details || {}),
      mission_status: missionStatus,
      start_time: started?.timestamp || null,
      end_time: ended?.timestamp || null,
      end_battery_pct: ended?.details?.end_battery_pct ?? null,
      duration_min: ended ? sourceMission?.duration_min ?? null : null,
    } : null;
    actions = [...observed.values()].map(action => joinAction(index, action, {
      asOf: observationCutoff, completed: action.observedTerminal, reconstructed: true, reconstruct: options.reconstruct !== false,
    }));
  } else {
    missionStatus = !sourceMission || (asOf && asOf < sourceMission.start_time) ? 'NOT_STARTED'
      : asOf && asOf < sourceMission.end_time ? 'IN_PROGRESS' : sourceMission.mission_status;
    mission = sourceMission ? { ...sourceMission, mission_status: missionStatus } : null;
    actions = (index.actionsByMission.get(missionId) || EMPTY)
      .filter(action => before(action.timestamp, asOf))
      .map(action => joinAction(index, { ...action, sourceStatus: action.status }, { asOf }));
  }
  actions.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || (a.sequence || 0) - (b.sequence || 0));
  const readings = actions.flatMap(action => action.readings);
  const anomalies = actions.flatMap(action => action.anomalies);
  const currentAction = actions.at(-1) || null;
  const lastTerminalEvent = [...events].reverse().find(event => event.event_type === 'MISSION_COMPLETED');
  const batteryPct = options.replay
    ? lastTerminalEvent?.details?.end_battery_pct ?? currentAction?.battery_pct ?? events.find(event => event.event_type === 'MISSION_STARTED')?.details?.battery_pct ?? null
    : ['COMPLETED', 'FAILED'].includes(missionStatus) ? sourceMission?.end_battery_pct ?? null : currentAction?.battery_pct ?? (missionStatus === 'NOT_STARTED' ? null : sourceMission?.start_battery_pct ?? null);
  return {
    mission, missionStatus, asOf: observationCutoff, actions, readings, anomalies, events, currentAction,
    latestLocationId: currentAction?.location_id || null,
    batteryPct,
    summary: summarizeRows(actions, readings, anomalies, mission && missionStatus !== 'NOT_STARTED' ? [mission] : []),
    replayCoverage: data.metadata?.replayCoverage?.find(row => row.mission_id === missionId) || {
      mission_id: missionId, eventCount: allEvents.length,
      coverage: allEvents.some(event => event.event_type === 'MISSION_COMPLETED') ? 'complete' : allEvents.length ? 'partial' : 'unavailable',
    },
    source: options.replay ? 'replay' : 'history',
    reconstructed: Boolean(options.replay && options.reconstruct !== false),
  };
}

function scopedSnapshots(data, options = {}) {
  const ids = options.missionId ? [options.missionId] : (data.missions || EMPTY).map(mission => mission.mission_id);
  return ids.map(id => missionSnapshot(data, id, options.asOf ?? null, options));
}

export function summarize(data, options = {}) {
  const snapshots = scopedSnapshots(data, options);
  return summarizeRows(
    snapshots.flatMap(snapshot => snapshot.actions),
    snapshots.flatMap(snapshot => snapshot.readings),
    snapshots.flatMap(snapshot => snapshot.anomalies),
    snapshots.filter(snapshot => snapshot.missionStatus !== 'NOT_STARTED' && snapshot.mission).map(snapshot => snapshot.mission),
  );
}

export function recommendNextStep(item) {
  const types = (item.anomalies || []).map(anomaly => anomaly.anomaly_type);
  const severity = item.classification?.highestSeverity;
  const prefix = severity === 'CRITICAL' ? 'Prioritize review with the responsible operator. ' : '';
  if (types.includes('ABNORMAL_TEMPERATURE')) return prefix + 'Review the flagged asset and available thermal evidence; verify the reading against approved site limits before deciding on a response.';
  if (types.includes('GAUGE_OUT_OF_RANGE')) return prefix + 'Verify the gauge reading against the approved operating range and arrange an independent reading if needed.';
  if (types.includes('ABNORMAL_VIBRATION')) return prefix + 'Review the vibration flag and request a confirming inspection using the site procedure.';
  if (types.includes('VISUAL_DEFECT')) return prefix + 'Review the visual defect flag and arrange a closer inspection; this kit does not attach an image to this record.';
  if (types.includes('NAVIGATION_OBSTRUCTION') || ['OBSTACLE_DETECTION', 'PATH_BLOCKED'].includes(item.failure_type)) return prefix + 'Check the recorded waypoint for an obstruction and have an operator confirm a safe route before retrying.';
  if (types.includes('LOCALIZATION_ISSUE') || item.failure_type === 'LOCALIZATION_FAILURE') return prefix + 'Verify the robot location and waypoint context before relying on the inspection or repeating the route.';
  if (types.includes('SIGNAL_DEGRADATION') || ['SIGNAL_NOISE', 'COMMUNICATION_LOSS'].includes(item.failure_type)) return prefix + 'Check signal quality and the affected inspection evidence; verify the result before relying on it.';
  if (item.status === 'FAILED') return 'Review the failure reason, confirm the target is accessible, and arrange a retry or manual inspection according to the site procedure.';
  if ((item.readings || []).some(reading => reading.quality === 'QUESTIONABLE')) return 'Obtain a confirming measurement or review the inspection setup. A QUESTIONABLE reading is not sufficient to clear the asset.';
  if (item.locationMismatch) return 'Compare the action waypoint with the asset registry and verify the mapping before dispatching follow-up work.';
  return 'Review the source evidence and use the approved site procedure for follow-up.';
}

export function buildQueue(data, options = {}) {
  return scopedSnapshots(data, options).flatMap(snapshot => snapshot.actions)
    .filter(action => action.classification.requiresAttention)
    .map(action => {
      const topAnomaly = [...action.anomalies].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0))[0];
      return {
        ...action, id: action.action_id,
        title: topAnomaly ? humanize(topAnomaly.anomaly_type) : action.status === 'FAILED' ? humanize(action.failure_type || 'Inspection failed') : action.classification.label,
        priority: action.classification.priority,
        reason: action.classification.reasons.join(' · '),
        recommendation: recommendNextStep(action),
        evidenceIds: [action.action_id, ...action.readings.map(row => row.reading_id), ...action.anomalies.map(row => row.anomaly_id)],
      };
    })
    .sort((a, b) => b.classification.rank - a.classification.rank || Number(b.classification.operatorReviewRequired) - Number(a.classification.operatorReviewRequired) || String(b.timestamp).localeCompare(String(a.timestamp)) || a.action_id.localeCompare(b.action_id));
}

export function locationSummary(data, options = {}) {
  const actions = scopedSnapshots(data, options).flatMap(snapshot => snapshot.actions);
  return (data.locations || EMPTY).map(location => {
    const locationActions = actions.filter(action => action.location_id === location.location_id);
    const anomalies = locationActions.flatMap(action => action.anomalies);
    const readings = locationActions.flatMap(action => action.readings);
    const summary = summarizeRows(locationActions, readings, anomalies);
    const top = [...anomalies].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0))[0];
    return { ...location, actions: locationActions, summary, highestSeverity: top?.severity || null, visited: locationActions.length > 0 };
  });
}

export function compareConfigurations(data) {
  const index = createIndex(data);
  const groups = [...new Set((data.missions || EMPTY).map(mission => mission.configuration_version))];
  const configurations = groups.map(configuration => {
    const missions = (data.missions || EMPTY).filter(mission => mission.configuration_version === configuration);
    const ids = new Set(missions.map(mission => mission.mission_id));
    const actions = (data.actions || EMPTY).filter(action => ids.has(action.mission_id)).map(action => joinAction(index, action));
    const summary = summarizeRows(actions, actions.flatMap(action => action.readings), actions.flatMap(action => action.anomalies), missions);
    const completedWithGaps = missions.filter(mission => mission.mission_status === 'COMPLETED' && actions.some(action => action.mission_id === mission.mission_id && action.status === 'FAILED')).length;
    return { configuration, scenario: missions[0]?.scenario || '', ...summary, completedWithGaps };
  });
  const baseline = configurations.find(row => row.configuration === 'V1') || configurations[0] || null;
  const improved = configurations.find(row => row.configuration === 'V2') || configurations[1] || null;
  return {
    configurations, baseline, improved,
    actionSuccessDeltaPp: baseline?.successRate != null && improved?.successRate != null ? improved.successRate - baseline.successRate : null,
    missionCompletionDeltaPp: baseline?.missionCompletionRate != null && improved?.missionCompletionRate != null ? improved.missionCompletionRate - baseline.missionCompletionRate : null,
    caveat: 'Observed difference in supplied synthetic runs. Configurations have different sample sizes and inspection mixes; this comparison does not establish causality.',
  };
}

export function reliabilityInsights(data) {
  const actions = data.actions || EMPTY;
  const byType = [...groupBy(actions, 'action_type')].map(([actionType, rows]) => ({ actionType, total: rows.length, failed: rows.filter(row => row.status === 'FAILED').length, successRate: pct(rows.filter(row => row.status === 'SUCCESS').length, rows.length) })).sort((a, b) => a.successRate - b.successRate);
  const navigation = actions.filter(action => action.location_id === 'WP05' && action.action_type === 'NAVIGATION');
  const batteryBands = [[0, 20], [20, 40], [40, 60], [60, 101]].map(([lower, upper]) => {
    const rows = actions.filter(action => Number.isFinite(action.battery_pct) && action.battery_pct >= lower && action.battery_pct < upper);
    return { label: upper === 101 ? '60–100%' : `${lower}–${upper - 1}%`, lower, upper, total: rows.length, failed: rows.filter(row => row.status === 'FAILED').length, failureRate: pct(rows.filter(row => row.status === 'FAILED').length, rows.length) };
  });
  return {
    byType, batteryBands,
    waypoint05Navigation: { total: navigation.length, failed: navigation.filter(action => action.status === 'FAILED').length, failureRate: pct(navigation.filter(action => action.status === 'FAILED').length, navigation.length) },
    caveat: 'Descriptive associations only. Battery bands are display groups, not safety limits or causal explanations.',
  };
}

export function buildHandover(data, options = {}, reviews = {}) {
  const summary = summarize(data, options);
  const queue = buildQueue(data, options);
  const missionLabel = options.missionId || 'All missions';
  const lines = [
    `SPOTlight shift handover — ${missionLabel}`,
    'SYNTHETIC CHALLENGE DATA — operator review aid',
    `View: ${options.replay ? 'Replay / observed events' : 'Archived mission report'}`,
    `As of: ${options.asOf || 'End of supplied report'} (source time zone not specified)`,
    '',
    `${summary.successfulActions}/${summary.terminalActions} completed actions succeeded; ${summary.failedActions} failed; ${summary.runningActions} in progress.`,
    `${summary.anomalyCount} source anomaly flags; ${summary.criticalAnomalies} critical; ${summary.questionableReadings} questionable readings.`,
    'Mission completion is separate from inspection success.',
    '', 'FOLLOW-UP QUEUE',
  ];
  for (const item of queue) {
    const review = reviews[item.id];
    const status = typeof review === 'string' ? review : review?.status || 'New';
    lines.push(`[${item.priority}] ${item.title} — ${item.asset?.asset_name || item.asset_id || 'Unknown asset'} at ${item.location?.location_name || item.location_id || 'Unknown waypoint'}`);
    lines.push(`  ${item.timestamp} · ${item.mission_id} · ${item.evidenceIds.join(', ')} · Local workflow: ${status}`);
    lines.push(`  Why: ${item.reason}`);
    lines.push(`  Next: ${item.recommendation}`);
    if (review?.note) lines.push(`  Operator note: ${review.note}`);
  }
  if (!queue.length) lines.push('No source flags, failed actions, questionable readings or registry mismatches in this view. This is not a safety clearance.');
  lines.push('', 'ASSUMPTIONS', 'No operating thresholds or per-reading confidence probabilities are provided.', 'Local workflow acknowledgements do not establish that equipment issues are resolved.', 'Images in the challenge kit are examples, not record-linked inspection evidence.');
  return lines.join('\n');
}
