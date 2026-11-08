#!/bin/sh
# Nightly consistent copy of the database. Run from cron:  0 2 * * * /opt/kcportal/backup.sh
set -e
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T portal node -e "const D=require('better-sqlite3');new D(process.env.DATA_DIR+'/portal.db').backup('/data/backup-tmp.db').then(()=>process.exit(0))"
mv data/backup-tmp.db "backups/portal-$STAMP.db"
gzip "backups/portal-$STAMP.db"
find backups -name 'portal-*.db.gz' -mtime +30 -delete
echo "backup ok: backups/portal-$STAMP.db.gz"
