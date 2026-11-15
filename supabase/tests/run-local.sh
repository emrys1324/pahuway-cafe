#!/usr/bin/env bash
# Runs the database scenario tests against the local Supabase stack (npm run db:start first).
# It resets the DB, runs scenarios (which create test users/orders), then resets again.
set -euo pipefail
cd "$(dirname "$0")/../.."
npx supabase db reset >/dev/null
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
if command -v psql >/dev/null; then
  RUN() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
else
  RUN() { docker exec -i supabase_db_pahuway-cafe psql -U postgres -v ON_ERROR_STOP=1 -q < "$1"; }
fi
RUN supabase/tests/scenarios.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_mobile.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_payments.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_team.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_rentals.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_stays.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
RUN supabase/tests/scenarios_tours.sql 2>&1 | grep -E "ok|FAIL|PASSED|ERROR"
npx supabase db reset >/dev/null
echo "Database reset to seed data. Re-run: npm run seed:users"
