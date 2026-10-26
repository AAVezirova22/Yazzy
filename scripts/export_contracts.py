import json
from pathlib import Path

from yazzy.api.main import app
from yazzy.modules.telemetry.contracts import TelemetryBatch

root = Path(__file__).resolve().parents[1]
(root / "contracts/openapi.json").write_text(
    json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
)
(root / "contracts/telemetry-v1.schema.json").write_text(
    json.dumps(
        TelemetryBatch.model_json_schema(by_alias=True), indent=2, sort_keys=True
    )
    + "\n"
)
print("Exported OpenAPI and canonical telemetry schema")
