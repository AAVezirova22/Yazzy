"""Run against a dedicated disposable PostgreSQL database supplied by TEST_POSTGRES_URL."""

import os

import psycopg

url = os.environ["TEST_POSTGRES_URL"]
with psycopg.connect(url) as db:
    db.execute("CREATE ROLE yazzy_test_runtime NOSUPERUSER NOBYPASSRLS")
    db.execute("GRANT USAGE ON SCHEMA public TO yazzy_test_runtime")
    db.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yazzy_test_runtime"
    )
    db.execute(
        "INSERT INTO organisations VALUES ('rls-a','RLS A',false),('rls-b','RLS B',false)"
    )
    for tid in ["rls-a", "rls-b"]:
        db.execute(
            "INSERT INTO vehicles(id,tenant_id,name,make,model,fuel_type,powertrain,origin,archived,version,capabilities,created_at) VALUES(%s,%s,'Test','','','PETROL','ICE','REAL',false,1,'{}',0)",
            (tid + "-car", tid),
        )
    db.execute("SET LOCAL ROLE yazzy_test_runtime")
    assert db.execute("SELECT count(*) FROM vehicles").fetchone()[0] == 0
    db.execute("SELECT set_config('app.tenant_id','rls-a',true)")
    assert db.execute("SELECT id FROM vehicles").fetchall() == [("rls-a-car",)]
    assert (
        db.execute(
            "UPDATE vehicles SET name='wrong tenant' WHERE tenant_id='rls-b'"
        ).rowcount
        == 0
    )
    try:
        with db.transaction():
            db.execute(
                "INSERT INTO fuel_entries(id,tenant_id,vehicle_id,litres,total_paid,currency,odometer_km,full_tank,observed_at,idempotency_key) VALUES('bad','rls-a','rls-b-car',10,20,'EUR',100,false,0,'bad')"
            )
    except psycopg.errors.ForeignKeyViolation:
        pass
    else:
        raise AssertionError("Cross-tenant insert unexpectedly allowed")
    db.rollback()
    assert db.execute("SELECT current_setting('app.tenant_id',true)").fetchone()[0] in (
        "",
        None,
    )
print(
    "RLS enforced with non-owner role; cross-tenant reads/writes denied; transaction context reset."
)
