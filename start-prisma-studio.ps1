# PowerShell script to start Prisma Studio with DATABASE_URL set
$env:DATABASE_URL = "file:./prisma/dev.db"
npx prisma studio --port 5555

