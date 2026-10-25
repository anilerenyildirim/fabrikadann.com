#!/bin/sh
# Uygulamanın kısıtlı veritabanı rolü (yalnızca ilk kurulumda, boş veri klasöründe çalışır).
# Uygulama bu rolle bağlanır: tablo silme/TRUNCATE/şema değişikliği yapamaz. Migration'lar sahip rolle çalışır.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE fabrikadann_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO fabrikadann_app;
GRANT USAGE ON SCHEMA public TO fabrikadann_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fabrikadann_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fabrikadann_app;
SQL
