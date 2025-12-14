# Weekly Backups

This directory contains compressed weekly backups of the dataset and profiles files.

Backups are automatically created every Sunday at 4 AM UTC and kept for 4 weeks.

## Files
- `canadian_flights_2026_details.jsonl.YYYY-MM-DD.gz` - Flight data backup
- `canadian_user_profiles.json.YYYY-MM-DD.gz` - Pilot profiles backup

## Recovery
To restore from a backup:
```bash
gunzip -c backups/canadian_flights_2026_details.jsonl.YYYY-MM-DD.gz > canadian_flights_2026_details.jsonl
gunzip -c backups/canadian_user_profiles.json.YYYY-MM-DD.gz > canadian_user_profiles.json
```

