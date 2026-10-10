"""Operator-facing vocabulary: labels, Spot parts, recommended actions and evidence images."""
from __future__ import annotations

SEVERITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
STATUS_RANK = {"normal": 0, "watch": 1, "action": 2}

ACTION_LABELS = {
    "NAVIGATION": "navigation", "VISUAL_INSPECTION": "visual inspection", "THERMAL_INSPECTION": "thermal inspection",
    "ACOUSTIC_INSPECTION": "acoustic inspection", "GAUGE_READING": "gauge reading",
}
SENSOR_TYPES = {
    "NAVIGATION": "navigation", "VISUAL_INSPECTION": "visual", "THERMAL_INSPECTION": "thermal",
    "ACOUSTIC_INSPECTION": "acoustic", "GAUGE_READING": "gauge",
}
MEASUREMENTS = {
    "TEMPERATURE_C": ("Temperature", "°C", "higher"),
    "PRESSURE_PSI": ("Pressure", " psi", "either"),
    "SOUND_DB": ("Sound level", " dB", "higher"),
    "VISUAL_SCORE": ("Visual condition score", "/100", "lower"),
    "LOCALIZATION_CONFIDENCE_PCT": ("Localization confidence", "%", "lower"),
}


def humanize(code: str | None) -> str:
    return (code or "").replace("_", " ").lower()


# What each part of the robot measured (Product Vision table in TODO.md).
PARTS = {
    "thermal_camera": {"name": "Thermal camera (Spot CAM+IR)", "plain": "measures how hot equipment is",
                       "measurement_types": ["TEMPERATURE_C"]},
    "ptz_camera": {"name": "PTZ / visual camera", "plain": "photographs equipment and reads gauges",
                   "measurement_types": ["VISUAL_SCORE", "PRESSURE_PSI"]},
    "microphone": {"name": "Microphone / acoustic sensor", "plain": "listens for unusual noise or vibration",
                   "measurement_types": ["SOUND_DB"]},
    "legs_and_body_cameras": {"name": "Legs + body stereo cameras", "plain": "walk the route and keep track of where Spot is",
                              "measurement_types": ["LOCALIZATION_CONFIDENCE_PCT"]},
    "radio": {"name": "Radio / comms payload", "plain": "keeps Spot connected to the network",
              "measurement_types": []},
    "battery": {"name": "Battery", "plain": "powers the mission", "measurement_types": []},
}
RADIO_CODES = {"COMMUNICATION_LOSS", "SIGNAL_DEGRADATION"}


def spot_part(action: dict, anomaly: dict | None) -> str:
    action_type = action["action_type"]
    if action_type == "THERMAL_INSPECTION":
        return "thermal_camera"
    if action_type in {"VISUAL_INSPECTION", "GAUGE_READING"}:
        return "ptz_camera"
    if action_type == "ACOUSTIC_INSPECTION":
        return "microphone"
    if action.get("failure_type") in RADIO_CODES or (anomaly and anomaly["anomaly_type"] in RADIO_CODES):
        return "radio"
    return "legs_and_body_cameras"


ANOMALY_ACTIONS = {
    "ABNORMAL_TEMPERATURE": "Schedule a manual thermal check of {asset} and compare it with its recent readings.",
    "ABNORMAL_VIBRATION": "Send a technician to check {asset} for loose parts or bearing wear.",
    "GAUGE_OUT_OF_RANGE": "Verify the gauge on {asset} by hand and check the process pressure.",
    "VISUAL_DEFECT": "Inspect {asset} in person for the reported defect and log photos.",
    "SIGNAL_DEGRADATION": "Check wireless coverage at {location}; a repeater may be needed.",
    "NAVIGATION_OBSTRUCTION": "Clear the route at {location} and re-run the inspection.",
    "LOCALIZATION_ISSUE": "Re-record the Autowalk route near {location} or add fiducials.",
}
FAILURE_ACTIONS = {
    "OBSTACLE_DETECTION": "Clear the path at {location} and re-run the inspection.",
    "PATH_BLOCKED": "Clear the path at {location} and re-run the inspection.",
    "LOCALIZATION_FAILURE": "Add or re-check fiducials at {location}.",
    "COMMUNICATION_LOSS": "Check network coverage at {location}.",
    "SENSOR_TIMEOUT": "Re-run the {action}; if it times out again, check Spot's {sensor} payload.",
    "READING_UNRELIABLE": "Re-take the {action} or verify {asset} by hand.",
    "TARGET_NOT_DETECTED": "Check that {asset} is visible from the inspection pose and re-capture it.",
    "SIGNAL_NOISE": "Re-take the acoustic reading of {asset} when the area is quieter.",
}

# Reference images from the kit (assets/inspection-images), served under /static.
ANOMALY_IMAGES = {
    "ABNORMAL_TEMPERATURE": "thermal_pump_bearing_01.jpg", "ABNORMAL_VIBRATION": "acoustic_valve_01.jpg",
    "GAUGE_OUT_OF_RANGE": "gauge_pressure_01.jpg", "VISUAL_DEFECT": "visual_pump_motor_01.jpg",
}
SENSOR_IMAGES = {
    "thermal": "thermal_pump_bearing_01.jpg", "acoustic": "acoustic_valve_01.jpg", "gauge": "gauge_pressure_01.jpg",
    "visual": "visual_pump_motor_01.jpg", "navigation": "pipe_gallery_01.jpg",
}


def evidence_image(sensor: str, anomaly: dict | None) -> str:
    name = ANOMALY_IMAGES.get(anomaly["anomaly_type"], "pipe_gallery_01.jpg") if anomaly else SENSOR_IMAGES[sensor]
    return f"/static/inspection-images/{name}"
