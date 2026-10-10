"""
Maintenance commands (run from the backend folder):

    python manage.py check       show where data is read from and what loads
    python manage.py reset-ops   delete the Operator Console database (issues, audit trail, snapshots)
                                 for a fresh demo; run together with the ingest API's `seed --reset`
"""
import sys

from app.config import Settings


def check():
    from app.lakehouse import load_tables
    from app.risk import RiskModel
    settings = Settings()
    print(f"lakehouse      {settings.lakehouse}")
    tables, source = load_tables(settings)
    print(f"source         {source}")
    print("rows           " + ", ".join(f"{t}={len(rows)}" for t, rows in tables.items()))
    model = RiskModel.load(settings.model_path, settings.metrics_path)
    print(f"risk model     {'loaded (' + model.info['model_type'] + ')' if model else 'missing - run python ../ml/train.py'}")
    print(f"ask provider   {settings.ask_provider}")
    print(f"ops            {'enabled, db ' + str(settings.ops_db) if settings.ops_enabled else 'disabled'}"
          + ("" if settings.ops_pin else "  (OPS_PIN not set: sign-in disabled)"))


def reset_ops():
    settings = Settings()
    removed = [p for p in (settings.ops_db, settings.ops_db.with_name(settings.ops_db.name + "-wal"),
                           settings.ops_db.with_name(settings.ops_db.name + "-shm")) if p.exists()]
    for p in removed:
        p.unlink()
    print(f"removed {', '.join(p.name for p in removed)}" if removed else "nothing to remove")
    print("Restart the API: it re-creates the issues and the baseline snapshots from the lakehouse.")


if __name__ == "__main__":
    commands = {"check": check, "reset-ops": reset_ops}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(__doc__)
        sys.exit(2)
    commands[sys.argv[1]]()
