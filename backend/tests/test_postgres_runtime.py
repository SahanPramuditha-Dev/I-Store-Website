from sqlalchemy import create_engine


def test_postgres_driver_is_installed():
    engine = create_engine("postgresql://user:password@localhost/database")
    try:
        assert engine.dialect.driver == "psycopg2"
    finally:
        engine.dispose()
