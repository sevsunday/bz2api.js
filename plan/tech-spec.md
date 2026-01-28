# BZ2 Session Viewer - Technical Specification

A server-side implementation for viewing Battlezone 2: Combat Commander multiplayer sessions with full Steam/GOG player enrichment.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [bz2api.js Library Reference](#bz2apijs-library-reference)
3. [Data Enrichment](#data-enrichment)
4. [API Design](#api-design)
5. [Frontend Stack](#frontend-stack)
6. [Data Structures](#data-structures)

---

## System Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Next.js Frontend (shadcn/ui + tweakcn)                          │   │
│  │  - Session cards with player avatars                             │   │
│  │  - Real-time updates via TanStack Query                          │   │
│  │  - Dark/Light theme support                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        NODE.JS SERVER (API Routes)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  /api/sessions - Main endpoint                                   │   │
│  │  - Uses bz2api.js for parsing                                    │   │
│  │  - Enriches with Steam/GOG data                                  │   │
│  │  - Caches responses (in-memory or Redis)                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Rebellion API  │  │  Steam Web API  │  │   GOG API       │
│  (via bz2api.js)│  │  (API key req)  │  │   (public)      │
│                 │  │                 │  │                 │
│  - Sessions     │  │  - Avatars      │  │  - Avatars      │
│  - Players      │  │  - Names        │  │  - Usernames    │
│  - Maps         │  │  - Status       │  │  - Account age  │
│  - Mods         │  │  - Ownership    │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Why Server-Side?

| Aspect | Client-Side (Current Demo) | Server-Side (This Spec) |
|--------|---------------------------|-------------------------|
| CORS | Requires proxy fallbacks | Direct API access |
| API Keys | Cannot use (exposed) | Secure in env vars |
| Steam Data | Profile URLs only | Avatars, names, status |
| GOG Data | Profile URLs only | Avatars, usernames |
| Caching | Browser only | Shared server cache |
| Rate Limits | Per-user | Controlled server-side |

---

## bz2api.js Library Reference

### Installation

```javascript
// Node.js (CommonJS)
const BZ2API = require('./bz2api.js');

// Copy bz2api.js to your project's lib/ folder
```

### Core Functions

#### `fetchSessions(options?)`

Fetches and parses all active multiplayer sessions.

```typescript
interface FetchSessionsOptions {
  enrichMaps?: boolean;      // Fetch map images/names (default: false)
  enrichVsrMaps?: boolean;   // Add VSR map metadata (default: false)
  vsrMapData?: object[];     // Custom VSR data to merge/replace
  vsrMapDataMode?: 'merge' | 'replace';
  onStatus?: (status: StatusUpdate) => void;  // Progress callback
}

interface FetchSessionsResult {
  sessions: Session[];
  timestamp: string;         // ISO 8601
  rawResponse: object;       // Original API response
  dataCache: DataCache;      // Unique players/mods
  enrichedMaps: boolean;
  enrichedVsrMaps: boolean;
}
```

**Example:**

```javascript
const result = await BZ2API.fetchSessions({
  enrichMaps: true,
  enrichVsrMaps: true
});

console.log(`Found ${result.sessions.length} sessions`);
```

#### `fetchRaw(options?)`

Fetches raw API data without parsing.

```javascript
const raw = await BZ2API.fetchRaw();
console.log(raw.GET); // Array of raw session objects
```

#### `fetchMapData(mapFile, modId)`

Fetches metadata for a specific map.

```javascript
const mapData = await BZ2API.fetchMapData('rckcnynvsr', '1325933293');
// Returns: { name, description, image, teamNames, modNames }
```

### Exported Constants

```javascript
BZ2API.API_URL          // "http://battlezone99mp.webdev.rebellion.co.uk/lobbyServer"
BZ2API.MAP_API_BASE     // "https://gamelistassets.iondriver.com/bzcc"
BZ2API.VSR_MOD_ID       // "1325933293"
BZ2API.CORS_PROXIES     // Default proxy list (not needed server-side)
BZ2API.VSR_MAP_DATA_RAW // Built-in VSR map data
```

---

## Data Enrichment

### Steam Web API

**Required:** API key from https://steamcommunity.com/dev/apikey

#### GetPlayerSummaries

```
GET https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/
  ?key={STEAM_API_KEY}
  &steamids={comma_separated_ids}
```

**Response fields used:**

| Field | Description |
|-------|-------------|
| `steamid` | 64-bit Steam ID |
| `personaname` | Display name |
| `avatarfull` | 184x184 avatar URL |
| `personastate` | 0=Offline, 1=Online, 2=Busy, 3=Away, 4=Snooze, 5=Trading, 6=Playing |
| `loccountrycode` | ISO 3166-1 alpha-2 country code (if public) |
| `timecreated` | Account creation timestamp |

**Rate Limit:** 100,000 calls/day

#### GetOwnedGames (Optional)

Verify BZ2 ownership:

```
GET https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/
  ?key={STEAM_API_KEY}
  &steamid={steam_id}
  &appids_filter[0]=624970
```

BZ2 App ID: `624970`

### GOG Galaxy API

**No API key required** - Public endpoint

#### Get User Info

```
GET https://embed.gog.com/users/info/{gog_id}
```

**Response:**

```json
{
  "id": "48628349971017",
  "username": "PlayerName",
  "userSince": 1449237763,
  "avatars": {
    "small": "https://images.gog.com/{hash}_avs.jpg",
    "small2x": "https://images.gog.com/{hash}_avs2.jpg",
    "medium": "https://images.gog.com/{hash}_avm.jpg",
    "medium2x": "https://images.gog.com/{hash}_avm2.jpg",
    "large": "https://images.gog.com/{hash}_avl.jpg",
    "large2x": "https://images.gog.com/{hash}_avl2.jpg"
  }
}
```

**Note:** The `gog_id` from bz2api.js is the cleaned Galaxy ID (high bits removed). This should match the ID expected by the GOG API.

### Map Enrichment

GameListAssets API (no auth required):

```
GET https://gamelistassets.iondriver.com/bzcc/getdata.php
  ?map={mapFile}
  &mod={modId}
```

**Response fields:**

| Field | Description |
|-------|-------------|
| `name` | Human-readable map name |
| `description` | Map description |
| `image` | Preview image URL |
| `teamNames` | `{ team1, team2 }` custom names |
| `modNames` | Array of mod names |

### VSR Map Data

Built-in to bz2api.js for VSR (mod ID `1325933293`) maps:

| Field | Description |
|-------|-------------|
| `pools` | Number of biometal pools |
| `loose` | Loose scrap amount (-1 = unknown) |
| `author` | Map creator |
| `size` | Map dimensions (e.g., 1024 = 1024x1024) |
| `baseToBase` | Distance between starting bases |

---

## API Design

### Endpoints

#### `GET /api/sessions`

Main endpoint returning enriched session data.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `enrichMaps` | boolean | true | Include map metadata |
| `enrichVsr` | boolean | true | Include VSR data |
| `enrichPlayers` | boolean | true | Include Steam/GOG data |

**Response:**

```typescript
interface APIResponse {
  sessions: EnrichedSession[];
  timestamp: string;
  stats: {
    totalSessions: number;
    totalPlayers: number;
    inGame: number;
    inLobby: number;
  };
  cached: boolean;
  cacheAge?: number;  // seconds since cache
}
```

#### `GET /api/health`

Health check endpoint.

```json
{
  "status": "ok",
  "uptime": 3600,
  "lastFetch": "2026-01-24T10:30:00Z",
  "cacheSize": 3
}
```

#### `GET /api/sessions/:id` (Optional)

Get single session by ID with full details.

#### `WS /api/sessions/live` (Advanced)

WebSocket endpoint for real-time updates.

```typescript
// Client -> Server
{ type: 'subscribe' }
{ type: 'unsubscribe' }

// Server -> Client
{ type: 'update', sessions: Session[] }
{ type: 'diff', changes: SessionDiff[] }
```

### Caching Strategy

**Recommended TTLs:**

| Data | TTL | Reason |
|------|-----|--------|
| Sessions | 30-60s | Changes frequently |
| Steam profiles | 5-15 min | Relatively stable |
| GOG profiles | 15-30 min | Rarely changes |
| Map data | 1 hour+ | Static content |

**Implementation:**

```typescript
// Simple in-memory cache
const cache = new Map<string, { data: any; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.data;
}

function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}
```

For production, consider Redis for shared cache across instances.

### Error Handling

```typescript
interface APIError {
  error: string;
  code: 'FETCH_FAILED' | 'RATE_LIMITED' | 'INVALID_REQUEST';
  details?: string;
}
```

---

## Frontend Stack

### Technology Choices

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Next.js 14+ (App Router) | SSR, API routes, routing |
| UI | shadcn/ui | Component library |
| Theming | tweakcn | Theme customization |
| Data | TanStack Query | Caching, refetching |
| State | Zustand (optional) | Client state |

### shadcn/ui Components

| Component | Usage |
|-----------|-------|
| Card, CardHeader, CardContent | Session cards |
| Avatar, AvatarImage, AvatarFallback | Player avatars |
| Badge | State, game type, VSR indicators |
| Button | Actions, join button |
| Skeleton | Loading states |
| Tooltip | Field descriptions |
| Collapsible | Expandable session details |
| Sheet | Mobile session details |
| Tabs | Parsed/Raw JSON toggle |
| ScrollArea | Player lists |
| Separator | Section dividers |

### Theme Configuration (tweakcn)

```typescript
// Recommended color tokens
const theme = {
  // State colors
  statePreGame: 'hsl(220, 10%, 50%)',   // Gray
  stateInGame: 'hsl(142, 76%, 36%)',    // Green
  statePostGame: 'hsl(0, 84%, 60%)',    // Red
  
  // Team colors
  team1: 'hsl(217, 91%, 60%)',          // Blue
  team2: 'hsl(25, 95%, 53%)',           // Orange
  
  // Game type
  gameTypeDM: 'hsl(280, 87%, 65%)',     // Purple
  gameTypeStrat: 'hsl(280, 87%, 65%)',  // Purple
  
  // Balance
  balanceVSR: 'hsl(217, 91%, 60%)',     // Blue
  
  // Platform
  platformSteam: 'hsl(210, 100%, 50%)', // Steam blue
  platformGOG: 'hsl(280, 80%, 55%)',    // GOG purple
};
```

### Data Fetching Pattern

```typescript
// hooks/useSessions.ts
import { useQuery } from '@tanstack/react-query';

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetch('/api/sessions').then(r => r.json()),
    refetchInterval: 30000,  // 30 second auto-refresh
    staleTime: 10000,        // Consider fresh for 10s
  });
}
```

---

## Data Structures

### Session Object

```typescript
interface Session {
  // Identity
  id: string;                    // RakNet GUID (Base64)
  guid: string;                  // Decoded GUID (hex)
  name: string;                  // Session name
  
  // Game info
  version: string;               // e.g., "2.0.204.1"
  state: 'PreGame' | 'InGame' | 'PostGame';
  stateDetail: string;           // "waiting", "playing", "loading"
  gameType: 'DM' | 'STRAT';
  gameTypeName: string;          // "Deathmatch" or "Strategy"
  gameMode: string;              // "DM", "STRAT", "MPI", etc.
  gameModeName: string;          // Full name
  isTeamGame: boolean;
  gameBalance: 'Stock' | 'VSR';
  
  // Map
  mapFile: string;               // Filename without extension
  mapName?: string;              // Enriched name
  mapDescription?: string;       // Enriched description
  mapImageUrl?: string;          // Enriched preview image
  teamNames?: {
    team1: string;
    team2: string;
  };
  
  // VSR data (when enrichVsrMaps: true)
  vsrPools?: number | null;
  vsrLoose?: number | null;      // -1 = unknown
  vsrAuthor?: string | null;
  vsrMapSize?: number | null;
  vsrBaseToBase?: number | null;
  
  // Players
  players: Player[];
  playerCount: number;
  maxPlayers: number;
  commanders: string[];          // Commander names
  hiddenPlayers: string[];       // Hidden/spectator names
  
  // Mods
  mods: Mod[];
  primaryMod: string;            // Main mod ID
  isStock: boolean;
  
  // Settings
  hasPassword: boolean;
  isLocked: boolean;
  motd?: string;                 // Message of the day
  nat: NATInfo;
  steamJoinUrl?: string;         // steam://rungame/...
  
  // Limits
  tps: number;                   // Ticks per second
  maxPing: number;
  gameTimeMinutes: number;
  timeLimitMinutes?: number;
  killLimit?: number;
  respawn: 'One' | 'Race' | 'Any';
  vehicleOnly: boolean;
}
```

### Player Object

```typescript
interface Player {
  // Identity
  name: string;                  // In-game display name
  rawId: string;                 // Original ID (S... or G...)
  steamId?: string;              // Steam 64-bit ID
  gogId?: string;                // Cleaned GOG ID
  platform: 'Steam' | 'GOG';
  profileUrl?: string;           // Profile page URL
  
  // Stats (null if not in-game)
  kills?: number;
  deaths?: number;
  score?: number;
  
  // Team
  team?: 1 | 2;                  // null for DM
  teamSlot?: number;             // Raw slot (1-5, 6-10, 255)
  isTeamLeader: boolean;
  isCommander: boolean;          // Same as leader in STRAT
  isHost: boolean;
  isHidden: boolean;             // Spectator/glitched
  
  // Enriched (server-side only)
  avatar?: string;               // Avatar URL
  displayName?: string;          // Steam persona / GOG username
  onlineStatus?: number;         // Steam persona state
  countryCode?: string;          // ISO country code
  accountAge?: number;           // Timestamp
  ownsGame?: boolean;            // Verified BZ2 ownership
}
```

### Mod Object

```typescript
interface Mod {
  id: string;                    // Workshop ID or "0"
  name?: string;                 // Mod name (null unless enriched)
  workshopUrl?: string;          // Steam Workshop URL
}
```

### NAT Info

```typescript
interface NATInfo {
  id: number;                    // 0-7
  name: string;                  // Human-readable
  canDirectConnect: boolean;     // None or UPnP
  isSymmetric: boolean;          // Hardest to connect
}

// NAT Types:
// 0 = None (direct connect)
// 1 = Full Cone
// 2 = Address Restricted
// 3 = Port Restricted
// 4 = Symmetric
// 5 = Unknown
// 6 = Detection in Progress
// 7 = UPnP (equivalent to None)
```

### Data Cache

```typescript
interface DataCache {
  players: Record<string, {
    id: string;
    steamId?: string;
    gogId?: string;
    platform: string;
    profileUrl?: string;
  }>;
  mods: Record<string, {
    id: string;
    name?: string;
    workshopUrl?: string;
  }>;
}
```

---

## Appendix

### Environment Variables

```bash
# Required
STEAM_API_KEY=your_steam_api_key

# Optional
REDIS_URL=redis://localhost:6379
SESSION_CACHE_TTL=30000
STEAM_CACHE_TTL=300000
GOG_CACHE_TTL=900000
```

### BZ2 Game Constants

| Constant | Value |
|----------|-------|
| Steam App ID | 624970 |
| VSR Mod ID | 1325933293 |
| Max Players | 14 |
| Default TPS | 20 |

### Related Resources

- [bz2api.js Documentation](https://sevsunday.github.io/bz2api.js/docs/)
- [bz2api.js Demo](https://sevsunday.github.io/bz2api.js/demo/)
- [Steam Web API Docs](https://developer.valvesoftware.com/wiki/Steam_Web_API)
- [GOG API Docs](https://gogapidocs.readthedocs.io/)
- [shadcn/ui](https://ui.shadcn.com/)
- [tweakcn](https://tweakcn.com/)
