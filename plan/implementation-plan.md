# BZ2 Session Viewer - Implementation Plan

Step-by-step guide for building a server-side BZ2 session viewer with Steam/GOG enrichment.

## Table of Contents

1. [Phase 1: Project Setup](#phase-1-project-setup)
2. [Phase 2: Backend API Routes](#phase-2-backend-api-routes)
3. [Phase 3: Frontend Components](#phase-3-frontend-components)
4. [Phase 4: Advanced Features](#phase-4-advanced-features)
5. [Phase 5: Deployment](#phase-5-deployment)

---

## Phase 1: Project Setup

### 1.1 Initialize Next.js Project

```bash
npx create-next-app@latest bz2-viewer --typescript --tailwind --eslint --app --src-dir
cd bz2-viewer
```

### 1.2 Install Dependencies

```bash
# shadcn/ui
npx shadcn@latest init

# Select: TypeScript, Default style, CSS variables, tailwind.config.ts, @/components, @/lib/utils

# Add components
npx shadcn@latest add card badge button avatar skeleton tooltip tabs collapsible sheet separator scroll-area

# TanStack Query
npm install @tanstack/react-query

# Optional: Zustand for state
npm install zustand
```

### 1.3 Copy bz2api.js

```bash
# Create lib folder and copy the library
mkdir -p src/lib
cp /path/to/bz2api.js src/lib/bz2api.js
```

### 1.4 Configure Environment Variables

Create `.env.local`:

```bash
# Required
STEAM_API_KEY=your_steam_api_key_here

# Optional
SESSION_CACHE_TTL=30000
STEAM_CACHE_TTL=300000
GOG_CACHE_TTL=900000
```

### 1.5 Set Up tweakcn Theme

Create `src/styles/theme.ts`:

```typescript
export const gameTheme = {
  colors: {
    // State colors
    state: {
      preGame: 'hsl(220, 10%, 50%)',
      inGame: 'hsl(142, 76%, 36%)',
      postGame: 'hsl(0, 84%, 60%)',
    },
    // Team colors
    team: {
      1: 'hsl(217, 91%, 60%)',
      2: 'hsl(25, 95%, 53%)',
    },
    // Platform colors
    platform: {
      steam: 'hsl(210, 100%, 50%)',
      gog: 'hsl(280, 80%, 55%)',
    },
    // Game balance
    balance: {
      vsr: 'hsl(217, 91%, 60%)',
      stock: 'hsl(220, 10%, 50%)',
    },
  },
};
```

Update `tailwind.config.ts` to include custom colors.

### 1.6 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── sessions/
│   │   │   └── route.ts        # Main API endpoint
│   │   └── health/
│   │       └── route.ts        # Health check
│   ├── layout.tsx
│   ├── page.tsx
│   └── providers.tsx           # Query provider
├── components/
│   ├── sessions/
│   │   ├── SessionCard.tsx
│   │   ├── SessionList.tsx
│   │   ├── PlayerList.tsx
│   │   ├── PlayerRow.tsx
│   │   └── StatsBar.tsx
│   ├── ui/                     # shadcn components
│   └── theme-toggle.tsx
├── hooks/
│   ├── useSessions.ts
│   └── useAutoRefresh.ts
├── lib/
│   ├── bz2api.js               # Copy of library
│   ├── steam.ts                # Steam API client
│   ├── gog.ts                  # GOG API client
│   ├── cache.ts                # Caching utilities
│   └── utils.ts
├── types/
│   └── index.ts                # TypeScript interfaces
└── styles/
    └── theme.ts
```

---

## Phase 2: Backend API Routes

### 2.1 Type Definitions

Create `src/types/index.ts`:

```typescript
export interface EnrichedPlayer {
  // Base fields from bz2api.js
  name: string;
  rawId: string;
  steamId?: string;
  gogId?: string;
  platform: 'Steam' | 'GOG';
  profileUrl?: string;
  kills?: number;
  deaths?: number;
  score?: number;
  team?: 1 | 2;
  isTeamLeader: boolean;
  isCommander: boolean;
  isHost: boolean;
  isHidden: boolean;
  
  // Enriched fields
  avatar?: string;
  displayName?: string;
  onlineStatus?: number;
  countryCode?: string;
  accountAge?: number;
  ownsGame?: boolean;
}

export interface EnrichedSession {
  // ... all session fields
  players: EnrichedPlayer[];
}

export interface APIResponse {
  sessions: EnrichedSession[];
  timestamp: string;
  stats: {
    totalSessions: number;
    totalPlayers: number;
    inGame: number;
    inLobby: number;
  };
  cached: boolean;
  cacheAge?: number;
}
```

### 2.2 Cache Utility

Create `src/lib/cache.ts`:

```typescript
interface CacheEntry<T> {
  data: T;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlMs,
    });
  }

  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return Math.floor((Date.now() - (entry.expires - this.getTTL(key))) / 1000);
  }

  private getTTL(key: string): number {
    // Default TTLs based on key prefix
    if (key.startsWith('sessions')) return 30000;
    if (key.startsWith('steam')) return 300000;
    if (key.startsWith('gog')) return 900000;
    return 60000;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const cache = new MemoryCache();
```

### 2.3 Steam API Client

Create `src/lib/steam.ts`:

```typescript
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_CACHE_TTL = parseInt(process.env.STEAM_CACHE_TTL || '300000');

interface SteamPlayer {
  steamid: string;
  personaname: string;
  avatarfull: string;
  personastate: number;
  loccountrycode?: string;
  timecreated?: number;
}

interface SteamPlayerSummary {
  avatar: string;
  displayName: string;
  onlineStatus: number;
  countryCode?: string;
  accountAge?: number;
}

export async function getSteamPlayerSummaries(
  steamIds: string[]
): Promise<Record<string, SteamPlayerSummary>> {
  if (!STEAM_API_KEY || steamIds.length === 0) {
    return {};
  }

  // Check cache first
  const cacheKey = `steam:${steamIds.sort().join(',')}`;
  const cached = cache.get<Record<string, SteamPlayerSummary>>(cacheKey);
  if (cached) return cached;

  // Steam API allows max 100 IDs per request
  const batches: string[][] = [];
  for (let i = 0; i < steamIds.length; i += 100) {
    batches.push(steamIds.slice(i, i + 100));
  }

  const results: Record<string, SteamPlayerSummary> = {};

  for (const batch of batches) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${batch.join(',')}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`Steam API error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      for (const player of data.response?.players || []) {
        results[player.steamid] = {
          avatar: player.avatarfull,
          displayName: player.personaname,
          onlineStatus: player.personastate,
          countryCode: player.loccountrycode,
          accountAge: player.timecreated,
        };
      }
    } catch (error) {
      console.error('Steam API fetch error:', error);
    }
  }

  // Cache results
  cache.set(cacheKey, results, STEAM_CACHE_TTL);
  
  return results;
}

// Optional: Check game ownership
export async function checkGameOwnership(steamId: string): Promise<boolean> {
  if (!STEAM_API_KEY) return false;
  
  const BZ2_APP_ID = 624970;
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&appids_filter[0]=${BZ2_APP_ID}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    return (data.response?.games?.length || 0) > 0;
  } catch {
    return false;
  }
}
```

### 2.4 GOG API Client

Create `src/lib/gog.ts`:

```typescript
const GOG_CACHE_TTL = parseInt(process.env.GOG_CACHE_TTL || '900000');

interface GOGUserInfo {
  id: string;
  username: string;
  userSince: number;
  avatars: {
    small: string;
    medium: string;
    large: string;
  };
}

interface GOGPlayerSummary {
  avatar: string;
  displayName: string;
  accountAge: number;
}

export async function getGOGPlayerSummaries(
  gogIds: string[]
): Promise<Record<string, GOGPlayerSummary>> {
  if (gogIds.length === 0) return {};

  const results: Record<string, GOGPlayerSummary> = {};

  // GOG API doesn't support batch requests, fetch individually
  // Consider rate limiting for many players
  const fetchPromises = gogIds.map(async (gogId) => {
    // Check cache first
    const cacheKey = `gog:${gogId}`;
    const cached = cache.get<GOGPlayerSummary>(cacheKey);
    if (cached) {
      results[gogId] = cached;
      return;
    }

    try {
      const url = `https://embed.gog.com/users/info/${gogId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`GOG API error for ${gogId}: ${response.status}`);
        return;
      }

      const data: GOGUserInfo = await response.json();
      
      const summary: GOGPlayerSummary = {
        avatar: data.avatars?.medium || data.avatars?.small,
        displayName: data.username,
        accountAge: data.userSince,
      };
      
      results[gogId] = summary;
      cache.set(cacheKey, summary, GOG_CACHE_TTL);
    } catch (error) {
      console.error(`GOG API fetch error for ${gogId}:`, error);
    }
  });

  // Limit concurrent requests
  const BATCH_SIZE = 5;
  for (let i = 0; i < fetchPromises.length; i += BATCH_SIZE) {
    await Promise.all(fetchPromises.slice(i, i + BATCH_SIZE));
  }

  return results;
}
```

### 2.5 Main Sessions API Route

Create `src/app/api/sessions/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { cache } from '@/lib/cache';
import { getSteamPlayerSummaries } from '@/lib/steam';
import { getGOGPlayerSummaries } from '@/lib/gog';

// Import bz2api.js (CommonJS module)
const BZ2API = require('@/lib/bz2api.js');

const SESSION_CACHE_TTL = parseInt(process.env.SESSION_CACHE_TTL || '30000');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enrichPlayers = searchParams.get('enrichPlayers') !== 'false';
  const enrichMaps = searchParams.get('enrichMaps') !== 'false';
  const enrichVsr = searchParams.get('enrichVsr') !== 'false';

  try {
    // Check cache
    const cacheKey = `sessions:${enrichMaps}:${enrichVsr}`;
    let result = cache.get<any>(cacheKey);
    let fromCache = !!result;

    if (!result) {
      // Fetch fresh data
      result = await BZ2API.fetchSessions({
        enrichMaps,
        enrichVsrMaps: enrichVsr,
      });
      cache.set(cacheKey, result, SESSION_CACHE_TTL);
    }

    // Enrich with player data
    if (enrichPlayers) {
      await enrichPlayersWithPlatformData(result.sessions);
    }

    // Calculate stats
    const stats = {
      totalSessions: result.sessions.length,
      totalPlayers: result.sessions.reduce((sum: number, s: any) => sum + s.playerCount, 0),
      inGame: result.sessions.filter((s: any) => s.state === 'InGame').length,
      inLobby: result.sessions.filter((s: any) => s.state === 'PreGame').length,
    };

    return NextResponse.json({
      sessions: result.sessions,
      timestamp: result.timestamp,
      stats,
      cached: fromCache,
      cacheAge: fromCache ? cache.getAge(cacheKey) : 0,
    });
  } catch (error) {
    console.error('Sessions API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions', code: 'FETCH_FAILED' },
      { status: 500 }
    );
  }
}

async function enrichPlayersWithPlatformData(sessions: any[]) {
  // Collect all unique player IDs
  const steamIds = new Set<string>();
  const gogIds = new Set<string>();

  for (const session of sessions) {
    for (const player of session.players) {
      if (player.steamId) steamIds.add(player.steamId);
      if (player.gogId) gogIds.add(player.gogId);
    }
  }

  // Fetch platform data in parallel
  const [steamData, gogData] = await Promise.all([
    getSteamPlayerSummaries([...steamIds]),
    getGOGPlayerSummaries([...gogIds]),
  ]);

  // Enrich players
  for (const session of sessions) {
    for (const player of session.players) {
      if (player.steamId && steamData[player.steamId]) {
        const data = steamData[player.steamId];
        player.avatar = data.avatar;
        player.displayName = data.displayName;
        player.onlineStatus = data.onlineStatus;
        player.countryCode = data.countryCode;
        player.accountAge = data.accountAge;
      } else if (player.gogId && gogData[player.gogId]) {
        const data = gogData[player.gogId];
        player.avatar = data.avatar;
        player.displayName = data.displayName;
        player.accountAge = data.accountAge;
      }
    }
  }
}
```

### 2.6 Health Check Route

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';

const startTime = Date.now();

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
}
```

---

## Phase 3: Frontend Components

### 3.1 Query Provider

Create `src/app/providers.tsx`:

```typescript
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10000,
            refetchInterval: 30000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

Update `src/app/layout.tsx` to wrap with `<Providers>`.

### 3.2 Sessions Hook

Create `src/hooks/useSessions.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { APIResponse } from '@/types';

export function useSessions() {
  return useQuery<APIResponse>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
  });
}
```

### 3.3 Stats Bar Component

Create `src/components/sessions/StatsBar.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';

interface StatsBarProps {
  totalSessions: number;
  totalPlayers: number;
  inGame: number;
  inLobby: number;
}

export function StatsBar({ totalSessions, totalPlayers, inGame, inLobby }: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <StatCard label="Sessions" value={totalSessions} />
      <StatCard label="Players" value={totalPlayers} />
      <StatCard label="In-Game" value={inGame} variant="success" />
      <StatCard label="In-Lobby" value={inLobby} variant="muted" />
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  variant = 'default' 
}: { 
  label: string; 
  value: number; 
  variant?: 'default' | 'success' | 'muted';
}) {
  const valueClass = {
    default: 'text-primary',
    success: 'text-green-500',
    muted: 'text-muted-foreground',
  }[variant];

  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
```

### 3.4 Session Card Component

Create `src/components/sessions/SessionCard.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { PlayerList } from './PlayerList';
import type { EnrichedSession } from '@/types';

interface SessionCardProps {
  session: EnrichedSession;
}

export function SessionCard({ session }: SessionCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="mb-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold">{session.name}</span>
                  {session.steamJoinUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(session.steamJoinUrl, '_blank');
                      }}
                    >
                      Join
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span>🗺️ {session.mapName || session.mapFile}</span>
                  <span>👥 {session.playerCount}/{session.maxPlayers}</span>
                  <span>⏱️ {formatTime(session.gameTimeMinutes)}</span>
                  <span>📡 {session.nat.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SessionBadges session={session} />
                <ChevronRight 
                  className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} 
                />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            <SessionDetails session={session} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function SessionBadges({ session }: { session: EnrichedSession }) {
  const stateVariant = {
    PreGame: 'secondary',
    InGame: 'default',
    PostGame: 'destructive',
  }[session.state] as 'secondary' | 'default' | 'destructive';

  return (
    <div className="flex gap-1">
      <Badge variant={stateVariant}>{session.state}</Badge>
      <Badge variant="outline">{session.gameModeName}</Badge>
      {session.gameBalance === 'VSR' && (
        <Badge variant="default" className="bg-blue-500">VSR</Badge>
      )}
      {session.isLocked && <Badge variant="outline">🔒</Badge>}
      {session.hasPassword && <Badge variant="destructive">PWD</Badge>}
    </div>
  );
}

function SessionDetails({ session }: { session: EnrichedSession }) {
  return (
    <div className="space-y-4">
      {/* Map preview */}
      {session.mapImageUrl && (
        <div className="float-right ml-4 mb-2">
          <img 
            src={session.mapImageUrl} 
            alt={session.mapName || session.mapFile}
            className="w-32 h-32 object-cover rounded border"
          />
        </div>
      )}

      {/* MOTD */}
      {session.motd && (
        <div className="p-3 bg-blue-500/10 border-l-2 border-blue-500 rounded">
          {session.motd}
        </div>
      )}

      {/* Hidden players warning */}
      {session.hiddenPlayers.length > 0 && (
        <div className="p-3 bg-red-500/10 border-l-2 border-red-500 rounded text-sm">
          <strong>Hidden Players:</strong> {session.hiddenPlayers.join(', ')}
        </div>
      )}

      {/* Players */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          Players {session.players.some(p => p.kills != null) && '(K/D/S)'}
        </h4>
        <PlayerList session={session} />
      </div>

      {/* Game details grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <DetailItem label="Version" value={session.version} />
        <DetailItem label="Game Mode" value={session.gameModeName} />
        <DetailItem label="Respawn" value={session.respawn} />
        <DetailItem label="NAT Type" value={session.nat.name} />
        <DetailItem label="TPS" value={session.tps} />
        <DetailItem label="Max Ping" value={`${session.maxPing}ms`} />
        <DetailItem label="Time Limit" value={session.timeLimitMinutes ? `${session.timeLimitMinutes}m` : 'None'} />
        <DetailItem label="Kill Limit" value={session.killLimit || 'None'} />
      </div>

      {/* VSR data */}
      {session.vsrPools != null && (
        <div>
          <h4 className="text-sm font-semibold mb-2">VSR Map Data</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <DetailItem label="Pools" value={session.vsrPools} />
            <DetailItem label="Loose Scrap" value={session.vsrLoose === -1 ? 'Unknown' : session.vsrLoose} />
            <DetailItem label="Author" value={session.vsrAuthor || 'Unknown'} />
            <DetailItem label="Map Size" value={`${session.vsrMapSize}×${session.vsrMapSize}`} />
            <DetailItem label="Base-to-Base" value={session.vsrBaseToBase || 'N/A'} />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: any }) {
  return (
    <div className="p-2 bg-muted rounded">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function formatTime(minutes: number | null): string {
  if (minutes == null) return 'N/A';
  if (minutes >= 255) return '4h+';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}
```

### 3.5 Player List Component

Create `src/components/sessions/PlayerList.tsx`:

```typescript
import type { EnrichedSession, EnrichedPlayer } from '@/types';
import { PlayerRow } from './PlayerRow';

interface PlayerListProps {
  session: EnrichedSession;
}

export function PlayerList({ session }: PlayerListProps) {
  const hasStats = session.players.some(p => p.kills != null);

  // Team games: two-column layout
  if (session.isTeamGame) {
    const team1 = session.players
      .filter(p => p.team === 1)
      .sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));
    
    const team2 = session.players
      .filter(p => p.team === 2)
      .sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));

    const team1Name = session.teamNames?.team1 || 'Team 1';
    const team2Name = session.teamNames?.team2 || 'Team 2';

    return (
      <div className="grid grid-cols-2 gap-4">
        <TeamColumn 
          name={team1Name} 
          players={team1} 
          hasStats={hasStats}
          isMPI={false}
        />
        <TeamColumn 
          name={team2Name} 
          players={session.gameMode === 'MPI' ? [] : team2} 
          hasStats={hasStats}
          isMPI={session.gameMode === 'MPI'}
        />
      </div>
    );
  }

  // DM: single column
  return (
    <div className="bg-muted/50 rounded overflow-hidden">
      {session.players.map((player, i) => (
        <PlayerRow key={i} player={player} showStats={hasStats} showTeam />
      ))}
    </div>
  );
}

function TeamColumn({ 
  name, 
  players, 
  hasStats,
  isMPI 
}: { 
  name: string; 
  players: EnrichedPlayer[]; 
  hasStats: boolean;
  isMPI: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
        {name}
      </div>
      <div className="bg-muted/50 rounded overflow-hidden">
        {isMPI ? (
          <div className="p-2 text-sm text-cyan-500 italic">
            🤖 Computer
          </div>
        ) : players.length > 0 ? (
          players.map((player, i) => (
            <PlayerRow key={i} player={player} showStats={hasStats} />
          ))
        ) : (
          <div className="p-2 text-sm text-muted-foreground italic">
            No players
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3.6 Player Row Component

Create `src/components/sessions/PlayerRow.tsx`:

```typescript
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { EnrichedPlayer } from '@/types';

interface PlayerRowProps {
  player: EnrichedPlayer;
  showStats?: boolean;
  showTeam?: boolean;
}

export function PlayerRow({ player, showStats, showTeam }: PlayerRowProps) {
  return (
    <div className="flex items-center gap-2 p-2 border-b last:border-b-0 border-border/50">
      {/* Avatar */}
      <Avatar className="h-8 w-8">
        <AvatarImage src={player.avatar} alt={player.name} />
        <AvatarFallback className="text-xs">
          {player.platform === 'Steam' ? '🎮' : '🟣'}
        </AvatarFallback>
      </Avatar>

      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-medium text-green-500 truncate">
                {player.displayName || player.name}
              </span>
            </TooltipTrigger>
            {player.displayName && player.displayName !== player.name && (
              <TooltipContent>
                In-game: {player.name}
              </TooltipContent>
            )}
          </Tooltip>
          
          <PlayerBadges player={player} />
        </div>
      </div>

      {/* Profile link */}
      {player.profileUrl && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => window.open(player.profileUrl, '_blank')}
        >
          👤
        </Button>
      )}

      {/* Stats */}
      {showStats && (
        <div className="flex gap-2 text-xs font-mono">
          <span className="text-green-500 w-6 text-right">{player.kills ?? '-'}</span>
          <span className="text-red-500 w-6 text-right">{player.deaths ?? '-'}</span>
          <span className="text-blue-500 w-6 text-right">{player.score ?? '-'}</span>
        </div>
      )}

      {/* Team badge (for DM) */}
      {showTeam && player.team && (
        <Badge variant="outline" className="text-xs">
          T{player.team}
        </Badge>
      )}
    </div>
  );
}

function PlayerBadges({ player }: { player: EnrichedPlayer }) {
  return (
    <>
      {player.isHost && (
        <Badge variant="default" className="text-xs h-5 bg-blue-500">HOST</Badge>
      )}
      {player.isCommander && (
        <Badge variant="default" className="text-xs h-5 bg-purple-500">⌘ CMDR</Badge>
      )}
      {!player.isCommander && player.isTeamLeader && (
        <Badge variant="outline" className="text-xs h-5">LEAD</Badge>
      )}
      {player.isHidden && (
        <Badge variant="destructive" className="text-xs h-5">HIDDEN</Badge>
      )}
      {player.onlineStatus !== undefined && (
        <OnlineIndicator status={player.onlineStatus} />
      )}
    </>
  );
}

function OnlineIndicator({ status }: { status: number }) {
  const isOnline = status > 0;
  return (
    <span 
      className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-500'}`}
      title={isOnline ? 'Online' : 'Offline'}
    />
  );
}
```

### 3.7 Main Page

Update `src/app/page.tsx`:

```typescript
'use client';

import { useSessions } from '@/hooks/useSessions';
import { StatsBar } from '@/components/sessions/StatsBar';
import { SessionCard } from '@/components/sessions/SessionCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export default function Home() {
  const { data, isLoading, error, refetch, isFetching } = useSessions();

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center text-red-500">
          <p>Failed to load sessions</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main className="container mx-auto p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">BZ2 Sessions</h1>
        <div className="flex items-center gap-4">
          {data?.cached && (
            <span className="text-sm text-muted-foreground">
              Cached {data.cacheAge}s ago
            </span>
          )}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </header>

      {isLoading ? (
        <LoadingSkeleton />
      ) : data ? (
        <>
          <StatsBar 
            totalSessions={data.stats.totalSessions}
            totalPlayers={data.stats.totalPlayers}
            inGame={data.stats.inGame}
            inLobby={data.stats.inLobby}
          />
          
          {data.sessions.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              No active sessions found
            </div>
          ) : (
            data.sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))
          )}
        </>
      ) : null}
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}
```

---

## Phase 4: Advanced Features

### 4.1 WebSocket Real-Time Updates

Create `src/app/api/sessions/live/route.ts`:

```typescript
// Note: Next.js App Router doesn't natively support WebSockets
// Use a separate WebSocket server or consider:
// - Socket.io with custom server
// - Pusher/Ably for managed WebSockets
// - Server-Sent Events (SSE) as alternative

// SSE Alternative:
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendUpdate = async () => {
        try {
          const BZ2API = require('@/lib/bz2api.js');
          const result = await BZ2API.fetchSessions({ enrichMaps: true });
          
          const data = `data: ${JSON.stringify({
            type: 'update',
            sessions: result.sessions,
            timestamp: result.timestamp,
          })}\n\n`;
          
          controller.enqueue(encoder.encode(data));
        } catch (error) {
          console.error('SSE update error:', error);
        }
      };

      // Send initial data
      await sendUpdate();
      
      // Send updates every 30 seconds
      const interval = setInterval(sendUpdate, 30000);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

Client usage:

```typescript
// hooks/useSessionsLive.ts
import { useEffect, useState } from 'react';

export function useSessionsLive() {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    const eventSource = new EventSource('/api/sessions/live');
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'update') {
        setSessions(data.sessions);
      }
    };

    return () => eventSource.close();
  }, []);

  return sessions;
}
```

### 4.2 Session History Tracking

Create database schema (using Prisma example):

```prisma
// prisma/schema.prisma
model SessionSnapshot {
  id          String   @id @default(cuid())
  sessionId   String
  name        String
  state       String
  playerCount Int
  mapFile     String
  timestamp   DateTime @default(now())
  
  @@index([sessionId, timestamp])
}

model PlayerSession {
  id         String   @id @default(cuid())
  playerId   String   // Steam or GOG ID
  platform   String
  sessionId  String
  joinedAt   DateTime @default(now())
  leftAt     DateTime?
  
  @@index([playerId])
  @@index([sessionId])
}
```

### 4.3 Player Statistics Aggregation

```typescript
// lib/stats.ts
interface PlayerStats {
  playerId: string;
  totalGames: number;
  totalPlayTime: number; // minutes
  favoriteMap: string;
  averageScore: number;
  lastSeen: Date;
}

async function getPlayerStats(playerId: string): Promise<PlayerStats> {
  // Query from database
  // Aggregate from PlayerSession records
}
```

### 4.4 Admin Dashboard

Create protected admin routes:

```typescript
// app/admin/page.tsx
// - View server status
// - Manual cache clear
// - View API rate limit usage
// - Session history browser
// - Player lookup
```

---

## Phase 5: Deployment

### 5.1 Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add STEAM_API_KEY
```

### 5.2 Railway Deployment

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set environment variables in Railway dashboard
```

### 5.3 Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

### 5.4 Environment Variables Checklist

| Variable | Required | Description |
|----------|----------|-------------|
| `STEAM_API_KEY` | Yes | Steam Web API key |
| `SESSION_CACHE_TTL` | No | Session cache TTL (default: 30000) |
| `STEAM_CACHE_TTL` | No | Steam data cache TTL (default: 300000) |
| `GOG_CACHE_TTL` | No | GOG data cache TTL (default: 900000) |
| `REDIS_URL` | No | Redis connection URL for shared cache |

### 5.5 Monitoring

Recommended setup:

- **Logging:** Vercel/Railway built-in logs, or Axiom/Logflare
- **Errors:** Sentry for error tracking
- **Metrics:** Vercel Analytics or custom Prometheus metrics
- **Uptime:** UptimeRobot or Better Uptime

---

## Appendix: Quick Reference

### API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List all sessions with enrichment |
| `/api/sessions/:id` | GET | Single session details |
| `/api/sessions/live` | GET (SSE) | Real-time updates |
| `/api/health` | GET | Health check |

### File Checklist

```
□ src/lib/bz2api.js
□ src/lib/cache.ts
□ src/lib/steam.ts
□ src/lib/gog.ts
□ src/types/index.ts
□ src/app/api/sessions/route.ts
□ src/app/api/health/route.ts
□ src/app/providers.tsx
□ src/hooks/useSessions.ts
□ src/components/sessions/StatsBar.tsx
□ src/components/sessions/SessionCard.tsx
□ src/components/sessions/PlayerList.tsx
□ src/components/sessions/PlayerRow.tsx
□ src/app/page.tsx
□ .env.local
```

### External Resources

- [bz2api.js Docs](https://sevsunday.github.io/bz2api.js/docs/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [shadcn/ui](https://ui.shadcn.com/)
- [TanStack Query](https://tanstack.com/query)
- [Steam Web API](https://developer.valvesoftware.com/wiki/Steam_Web_API)
- [GOG API Docs](https://gogapidocs.readthedocs.io/)
