# BZ2API.js

A zero-dependency JavaScript library for fetching and parsing multiplayer session data from the Battlezone 2: Combat Commander lobby server.

## Features

- **Zero dependencies** - Pure vanilla JavaScript, works in browsers and Node.js
- **Automatic CORS handling** - Falls back through multiple public proxies
- **Full data parsing** - Decodes Base64 names, RakNet GUIDs, game modes, team assignments
- **Steam/GOG integration** - Profile URLs, Workshop URLs, direct join protocol URLs
- **GOG ID cleaning** - Automatically masks high bits from GOG Galaxy IDs
- **VSR detection** - Identifies games using the Vet Strategy Recycler balance mod
- **Map data enrichment** - Opt-in integration with GameListAssets API for map names, descriptions, images, and team names
- **Data cache** - Consolidated cache of unique players and mods across all sessions

## Quick Start

### Browser

```html
<script src="bz2api.js"></script>
<script>
  BZ2API.fetchSessions().then(result => {
    console.log('Sessions:', result.sessions);
    console.log('Players:', result.dataCache.players);
    console.log('Mods:', result.dataCache.mods);
  });
</script>
```

### With Map Enrichment

```html
<script src="bz2api.js"></script>
<script>
  BZ2API.fetchSessions({ enrichMaps: true }).then(result => {
    result.sessions.forEach(session => {
      console.log(session.mapName);      // "VSR DM: Rocky Canyon"
      console.log(session.mapImageUrl);  // "https://gamelistassets.iondriver.com/..."
      console.log(session.teamNames);    // { team1: "ISDF", team2: "Scion" }
    });
  });
</script>
```

### Node.js

```javascript
const BZ2API = require('./bz2api.js');

const result = await BZ2API.fetchSessions();
console.log(result.sessions);
```

## API Reference

### Main Functions

#### `fetchSessions(options)`

Fetches and parses all active multiplayer sessions.

```javascript
const result = await BZ2API.fetchSessions({
  proxyUrl: 'https://corsproxy.io/?',  // Optional: specific CORS proxy
  apiUrl: 'http://custom-api.com/',     // Optional: custom API endpoint
  bustCache: true,                       // Optional: add cache-busting param (default: true)
  enrichMaps: false                      // Optional: fetch map metadata (default: false)
});
```

**Returns:**
```javascript
{
  sessions: [...],           // Array of parsed session objects
  timestamp: "ISO8601...",   // Fetch timestamp
  rawResponse: {...},        // Original API response
  dataCache: {
    players: {...},          // Unique players keyed by ID
    mods: {...}              // Unique mods keyed by ID
  },
  enrichedMaps: false        // Whether map enrichment was used
}
```

#### `fetchRaw(options)`

Fetches raw API response without parsing.

```javascript
const raw = await BZ2API.fetchRaw();
console.log(raw.GET); // Array of raw session objects
```

#### `parseSession(rawSession)`

Parses a single raw session object.

```javascript
const session = BZ2API.parseSession(rawSessionFromAPI);
```

#### `parsePlayer(rawPlayer, index, isTeamGame, isMPI, gameMode)`

Parses a single raw player object.

```javascript
const player = BZ2API.parsePlayer(rawPlayer, 0, true, false, 'STRAT');
```

#### `buildDataCache(sessions)`

Builds consolidated cache from parsed sessions.

```javascript
const cache = BZ2API.buildDataCache(parsedSessions);
```

### Map Enrichment Functions

#### `fetchMapData(mapFile, modId)`

Fetches map metadata from the GameListAssets API.

```javascript
const mapData = await BZ2API.fetchMapData('rckcnynvsr', '1325933293');
// Returns: { name, description, imageUrl, teamNames, ... }
```

#### `enrichSessionsWithMapData(sessions)`

Enriches an array of sessions with map data (mutates sessions in place).

```javascript
const sessions = rawData.GET.map(BZ2API.parseSession);
await BZ2API.enrichSessionsWithMapData(sessions);
```

#### `clearMapCache()`

Clears the in-memory map data cache.

```javascript
BZ2API.clearMapCache();
```

### Utility Functions

| Function | Description |
|----------|-------------|
| `decodeBase64Name(str)` | Decodes Base64 string using Windows-1252 encoding |
| `decodeRakNetGuid(str)` | Decodes RakNet custom Base64 GUID to BigInt |
| `cleanGogId(rawGogId)` | Masks high bits from GOG Galaxy IDs for valid profile URLs |
| `parseGameTypeAndMode(gt, gtd)` | Parses game type and mode from raw fields |
| `parseSessionState(si, players)` | Determines session state with smart override |
| `parseNATType(t)` | Parses NAT type to info object |
| `parseTimeLimit(gtm)` | Parses time limit field |
| `parseModIds(mm)` | Splits semicolon-separated mod string |
| `enrichMods(modIds)` | Converts mod IDs to objects with URLs |

### URL Builders

| Function | Description |
|----------|-------------|
| `buildSteamProfileUrl(steamId)` | Returns Steam profile URL |
| `buildGogProfileUrl(gogId)` | Returns GOG profile URL |
| `buildWorkshopUrl(modId)` | Returns Steam Workshop URL |
| `buildSteamJoinUrl(rawSession)` | Returns `steam://` protocol join URL |

### Constants

```javascript
BZ2API.ServerInfoMode   // { UNKNOWN: 0, OPEN_WAITING: 1, ... }
BZ2API.NATType          // { NONE: 0, FULL_CONE: 1, SYMMETRIC: 4, ... }
BZ2API.NATTypeNames     // { 0: 'None', 1: 'Full Cone', ... }
BZ2API.GameType         // { ALL: 0, DEATHMATCH: 1, STRATEGY: 2 }
BZ2API.GameMode         // { DM: 1, TEAM_DM: 2, KOTH: 3, MPI: 13, ... }
BZ2API.GameModeNames    // { 1: 'Deathmatch', 13: 'MPI', ... }
BZ2API.VSR_MOD_ID       // '1325933293' - Vet Strategy Recycler mod ID
BZ2API.DEFAULT_API_URL  // Rebellion lobby server URL
BZ2API.MAP_API_BASE_URL // GameListAssets API base URL
BZ2API.CORS_PROXIES     // Array of fallback CORS proxies
```

---

## Data Structures

### Session Object

```javascript
{
  // Identity
  id: "N5YHeRM@Wt",                    // RakNet GUID (Base64)
  guid: "0de00166e8462157",            // Decoded GUID (hex)
  name: "VSR Dedicated DM Server",     // Decoded session name

  // Game Info
  version: "2.0.204.1",
  gameType: "DM",                      // "DM" or "STRAT"
  gameTypeName: "Deathmatch",
  gameMode: "DM",                      // DM, TEAM_DM, KOTH, CTF, STRAT, MPI, etc.
  gameModeName: "Deathmatch",
  isTeamGame: false,
  respawn: "Any",                      // "One", "Race", or "Any"
  vehicleOnly: true,
  rawGameType: 1,
  rawGameSubType: 7267,

  // Game Balance
  gameBalance: "VSR",                  // "VSR" or null
  gameBalanceName: "Vet Strategy Recycler Variant",  // Full name or null

  // Map
  mapFile: "rckcnynvsr",
  mapUrl: null,
  
  // Map Enrichment (when enrichMaps: true)
  mapName: "VSR DM: Rocky Canyon",     // Human-readable name or null
  mapDescription: "Fight in a...",     // Description or null
  mapImageUrl: "https://...",          // Preview image URL or null
  teamNames: {                         // Team names from map data
    team1: "ISDF",
    team2: "Scion"
  },

  // Players
  players: [...],                      // Array of player objects
  playerCount: 2,
  maxPlayers: 14,
  commanders: ["PlayerName"],          // Commander names (STRAT/MPI)
  hiddenPlayers: [],                   // Spectators/glitched players

  // Mods
  mods: [
    { id: "1325933293", name: "Vet Strat Recycler Variant", workshopUrl: "https://..." }
  ],
  primaryMod: "1325933293",
  modHash: "Dx7b73",
  isStock: false,

  // State
  state: "InGame",                     // "PreGame", "InGame", "PostGame"
  stateDetail: "playing",              // "waiting", "full", "playing", "exiting"
  serverInfoMode: 3,
  hasOpenSlots: true,

  // Status
  isLocked: false,
  hasPassword: false,
  motd: null,

  // Network
  nat: {
    id: 1,
    name: "Full Cone",
    canDirectConnect: false,
    isSymmetric: false
  },
  steamJoinUrl: "steam://rungame/624970/...",
  tps: 20,
  maxPing: 750,
  worstPingObserved: 174,

  // Time
  gameTimeMinutes: 255,
  timeElapsedMinutes: ">255",
  timeLimitMinutes: null,
  killLimit: null,

  // Debug
  _raw: {...}                          // Original raw data
}
```

### Player Object

```javascript
{
  name: "Rapter",
  
  // IDs
  rawId: "S76561198002036575",
  steamId: "76561198002036575",
  gogId: null,
  gogIdRaw: null,                      // Raw GOG ID before cleaning (for debugging)
  platform: "Steam",
  profileUrl: "https://steamcommunity.com/profiles/76561198002036575/",

  // Stats
  kills: 24,
  deaths: 4,
  score: 111,

  // Team
  teamSlot: 2,                         // Raw slot (1-10 or 255)
  team: 1,                             // Parsed team (1 or 2)
  isTeamLeader: false,
  isCommander: false,                  // True for STRAT/MPI leaders
  teamIndex: 1,                        // 0-4 within team

  // Status
  isHost: false,
  isHidden: false
}
```

### DataCache Object

```javascript
{
  players: {
    "76561198002036575": {
      id: "76561198002036575",
      steamId: "76561198002036575",
      gogId: null,
      platform: "Steam",
      profileUrl: "https://steamcommunity.com/profiles/76561198002036575/"
    }
  },
  mods: {
    "1325933293": {
      id: "1325933293",
      name: "Vet Strat Recycler Variant",  // Enriched from map data, or null
      workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=1325933293"
    },
    "0": {
      id: "0",
      name: "Stock",
      workshopUrl: null
    }
  }
}
```

---

## Technical Details

### Character Encoding

The Rebellion API encodes names using **Windows-1252 (cp1252)** in Base64, not UTF-8. The library includes a full cp1252 decoder that handles the 0x80-0x9F range correctly.

### RakNet GUID Encoding

The `g` field uses a custom Base64 alphabet for encoding 64-bit RakNet GUIDs:
```
@123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_
```

### GOG ID Cleaning

GOG Galaxy user IDs have extra high bits that must be masked off for valid profile URLs:
```javascript
cleanedId = rawId & 0x00ffffffffffffff
```

### VSR Balance Detection

The library detects sessions using the **Vet Strategy Recycler (VSR)** balance mod by checking if mod ID `1325933293` is present in the mod list.

### Game Mode Bit Packing

The `gtd` field encodes multiple values:
- `gtd % 14` = Base game mode (1-13)
- `gtd / 14` = Detailed flags
  - Bits 0-7: Sub-mode (0=DM, 1=KOTH, 2=CTF, 3=Loot, 5=Race, 6=Race+VehOnly, 7=DM+VehOnly)
  - Bit 8 (256): Respawn same race
  - Bit 9 (512): Respawn any race

### Team Slot Mapping

| Slot | Team | Role |
|------|------|------|
| 1 | 1 | Leader/Commander |
| 2-5 | 1 | Member |
| 6 | 2 | Leader/Commander |
| 7-10 | 2 | Member |
| 255 | - | Hidden/Spectator |

### Session State Detection

The library improves on raw `si` values by checking player stats:
- If `si` indicates PreGame but players have kills/deaths/score, state is overridden to InGame

### CORS Proxy Fallback

When direct fetch fails, the library automatically tries:
1. `https://corsproxy.io/?`
2. `https://api.codetabs.com/v1/proxy?quest=`
3. `https://api.allorigins.win/raw?url=`

### Steam Join URL

The library can generate `steam://rungame/` protocol URLs for direct game joining:
- Only works for sessions without password or lock
- Encodes session name, mod list, and NAT address in hex format

### Map Data Enrichment

When `enrichMaps: true` is passed to `fetchSessions()`, the library fetches additional metadata from the GameListAssets API:

**API:** `https://gamelistassets.iondriver.com/bzcc/getdata.php?map={mapFile}&mod={modId}`

**Provides:**
- Human-readable map name
- Map description
- Preview image URL
- Team names (from map's netVars)
- Mod names (for Workshop items)

Map data is cached in memory to avoid redundant API calls. Use `clearMapCache()` to clear.

---

## Source API

**Endpoint:** `http://battlezone99mp.webdev.rebellion.co.uk/lobbyServer`

**Raw Response Format:**
```javascript
{
  "GET": [
    {
      "v": "2.0.204.1",    // Version
      "g": "N5YHeRM@Wt",   // RakNet GUID (custom Base64)
      "n": "VlNSIERl...",  // Name (Base64, cp1252)
      "m": "rckcnynvsr",   // Map file
      "mu": "",            // Map URL
      "gt": 1,             // Game type (1=DM, 2=STRAT)
      "gtd": 7267,         // Game sub-type (packed)
      "gtm": 255,          // Game time minutes
      "pm": 14,            // Max players
      "mm": "1325933293",  // Mod IDs (semicolon-separated)
      "d": "Dx7b73",       // Mod hash
      "t": 1,              // NAT type
      "l": 0,              // Locked
      "k": 0,              // Password
      "h": "",             // MOTD
      "si": 3,             // Server info mode
      "tps": 20,           // Ticks per second
      "pg": 174,           // Worst ping seen
      "pgm": 750,          // Max ping allowed
      "ti": null,          // Time limit
      "ki": null,          // Kill limit
      "pl": [              // Players
        {
          "i": "S76561...", // Player ID (S=Steam, G=GOG)
          "n": "UmFwdGVy",  // Name (Base64, cp1252)
          "t": 1,           // Team slot
          "k": 10,          // Kills
          "d": 5,           // Deaths
          "s": 45           // Score
        }
      ]
    }
  ]
}
```

---

## License

MIT
