# PowerShell Commands for Odds on Deck

## NFL Roster Fetch

**PowerShell (Windows):**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/nfl/roster" -Method POST
```

**Or using curl alias (if available):**
```powershell
curl.exe -X POST http://localhost:3000/api/nfl/roster
```

**Note:** The `curl` command in PowerShell is an alias for `Invoke-WebRequest`, which doesn't support the `-X` flag. Use `Invoke-WebRequest` with `-Method POST` instead.

## Odds Fetching

**NHL:**
```powershell
node scripts/fetch-live-odds.js nhl --cache-fresh
```

**NFL:**
```powershell
node scripts/fetch-live-odds.js nfl --cache-fresh
```

## Testing API Endpoints

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/nfl/roster" -Method POST | ConvertFrom-Json
```

**Get response content:**
```powershell
$response = Invoke-WebRequest -Uri "http://localhost:3000/api/nfl/roster" -Method POST
$response.Content
```




