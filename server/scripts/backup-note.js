console.log(`To back up the database, run this in a terminal (needs the PostgreSQL tools, which come with the PostgreSQL installer):

  pg_dump "$DATABASE_URL" --no-owner --format=custom --file=gedt-backup.dump

To restore it into an empty database:

  pg_restore --no-owner --dbname="$DATABASE_URL" gedt-backup.dump

On Windows, replace $DATABASE_URL with the connection string in quotes.`);
