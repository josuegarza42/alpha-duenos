"""Apply the tested additive schema and verify that application rows are preserved."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import psycopg2
from psycopg2 import sql

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
config = json.loads((root / '.private/database.json').read_text())
password = (root / '.private/supabase-database-password.txt').read_text().strip()
source = (root / 'supabase/schema.sql').read_text()
connection = psycopg2.connect(**config, password=password, sslmode='require', connect_timeout=20)
tables = ['responsibilities', 'motions', 'votes', 'resolution_votes', 'discussion_comments', 'agreements', 'measurements', 'incidents', 'events', 'partners']
def fingerprints(cursor, columns):
    result = {}
    for table in tables:
        # Compare the exact columns that existed before the additive migration.
        fields = sql.SQL(',').join(sql.Identifier(c) for c in columns[table])
        cursor.execute(sql.SQL("select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from (select {} from alpha_private.{}) t").format(fields, sql.Identifier(table)))
        result[table] = cursor.fetchone()
    return result
try:
    with connection:
        with connection.cursor() as cursor:
            cursor.execute("set local lock_timeout='10s'; set local statement_timeout='60s'")
            cursor.execute('select revision from alpha_private.board where id=1 for update')
            revision = cursor.fetchone()[0]
            columns = {}
            for table in tables:
                cursor.execute("select column_name from information_schema.columns where table_schema='alpha_private' and table_name=%s order by ordinal_position", (table,))
                columns[table] = [row[0] for row in cursor.fetchall()]
            before = fingerprints(cursor, columns)
            if not args.apply:
                print(json.dumps({'connected': True, 'revision': revision, 'rows': {k:v[0] for k,v in before.items()}, 'schema_sha256': hashlib.sha256(source.encode()).hexdigest()}))
            else:
                # Capture the latest votes while the same board lock used by alpha_api
                # prevents concurrent decisions. Never restore an earlier export.
                latest = {}
                for table in tables:
                    if table == 'partners':
                        continue
                    cursor.execute(sql.SQL("select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from alpha_private.{} t").format(sql.Identifier(table)))
                    latest[table] = cursor.fetchone()[0]
                stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
                latest_file = root / '.private' / f'backup-at-schema-migration-{stamp}.json'
                latest_file.write_text(json.dumps(latest, ensure_ascii=False, indent=2))
                latest_file.chmod(0o600)
                cursor.execute("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='alpha_private' or (n.nspname='public' and p.proname='alpha_api') order by p.oid")
                old_functions = '\n'.join(row[0] for row in cursor.fetchall())
                backup = root / '.private' / f'schema-before-migration-{stamp}.sql'
                backup.write_text(old_functions)
                backup.chmod(0o600)
                cursor.execute(source)
                after = fingerprints(cursor, columns)
                if after != before:
                    raise RuntimeError('Application data changed unexpectedly; rolling back migration.')
                cursor.execute('update alpha_private.board set revision=revision+1 where id=1')
                print(json.dumps({'applied': True, 'rows_preserved': {k:v[0] for k,v in after.items()}, 'schema_sha256': hashlib.sha256(source.encode()).hexdigest()}))
finally:
    connection.close()
