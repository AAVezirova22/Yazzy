# Warm-idle fuel compensation change

Version: warm-idle-median-v1. Status: experimental, no validated diagnostic performance.

The production-domain rule uses valid speed ≤1 km/h, RPM ≥500 and coolant ≥70 °C samples within 15 seconds of the trim reading. A session needs at least three comparable observations. The first ten qualifying session medians form a stable reference. Three consecutive recent session residuals must exceed max(5 percentage points, 4 × 1.4826 × MAD). A finding freezes the reference and retains immutable evidence. A service record can start a new reference version.

These are engineering defaults, not vehicle-specific clinical or diagnostic thresholds. The enrolled car may already have a problem. The current context model does not control ambient temperature, engine load, fuel composition or engine family. No real-car specificity, sensitivity or false-alert rate is established. It must not identify a failed part, a repair price, fitment, a failure date or a numerical probability.

Demo findings are synthetic and excluded from real-car baselines. A synthetic fuel/trip classifier benchmark is provided to test data splits and evaluation, with promotion disabled. Prospective labelled drives and technician-reviewed evidence are required before supported public diagnostic claims.
