/**
 * BZ2API.js - Battlezone 2: Combat Commander Game Session API Library
 * 
 * Fetches and parses multiplayer session data from the Rebellion lobby server.
 */

const BZ2API = (function() {
  'use strict';

  const DEFAULT_API_URL = 'http://battlezone99mp.webdev.rebellion.co.uk/lobbyServer';
  
  // Common CORS proxies that can be used if direct fetch fails
  // These are tried in order if direct fetch fails due to CORS
  const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',  // https://codetabs.com/cors-proxy/cors-proxy.html
    'https://api.allorigins.win/raw?url=',
  ];

  // ============================================================================
  // CONSTANTS & ENUMS
  // ============================================================================

  /**
   * ServerInfoMode - The si field values
   * Determines the current state of the game session
   */
  const ServerInfoMode = {
    UNKNOWN: 0,
    OPEN_WAITING: 1,      // PreGame, has open slots
    CLOSED_WAITING: 2,    // PreGame, full
    OPEN_PLAYING: 3,      // InGame, has open slots
    CLOSED_PLAYING: 4,    // InGame, full
    EXITING: 5            // PostGame
  };

  /**
   * NAT Type - The t field values
   * Describes the NAT traversal capabilities
   */
  const NATType = {
    NONE: 0,              // Works with anyone (direct connect)
    FULL_CONE: 1,         // Accepts any datagrams to a previously used port
    ADDRESS_RESTRICTED: 2, // Accepts from IPs we've sent to
    PORT_RESTRICTED: 3,   // Same as above but port must match too
    SYMMETRIC: 4,         // Different port for every destination
    UNKNOWN: 5,           // Hasn't been determined
    DETECTION_IN_PROGRESS: 6,
    SUPPORTS_UPNP: 7      // Has UPNP, equivalent to NONE
  };

  const NATTypeNames = {
    [NATType.NONE]: 'None',
    [NATType.FULL_CONE]: 'Full Cone',
    [NATType.ADDRESS_RESTRICTED]: 'Address Restricted',
    [NATType.PORT_RESTRICTED]: 'Port Restricted',
    [NATType.SYMMETRIC]: 'Symmetric',
    [NATType.UNKNOWN]: 'Unknown',
    [NATType.DETECTION_IN_PROGRESS]: 'Detecting...',
    [NATType.SUPPORTS_UPNP]: 'UPnP'
  };

  /**
   * Game Type - The gt field values
   */
  const GameType = {
    ALL: 0,        // Invalid/unknown
    DEATHMATCH: 1,
    STRATEGY: 2
  };

  /**
   * Game Mode - Derived from gtd field
   * For Deathmatch: gtd % GAMEMODE_MAX gives the mode
   */
  const GameMode = {
    UNKNOWN: 0,
    DM: 1,
    TEAM_DM: 2,
    KOTH: 3,
    TEAM_KOTH: 4,
    CTF: 5,
    TEAM_CTF: 6,
    LOOT: 7,
    TEAM_LOOT: 8,
    RACE: 9,
    TEAM_RACE: 10,
    STRAT: 11,       // FFA Strategy
    TEAM_STRAT: 12,  // Team Strategy
    MPI: 13,         // Multiplayer Instant Action
    GAMEMODE_MAX: 14
  };

  const GameModeNames = {
    [GameMode.UNKNOWN]: 'Unknown',
    [GameMode.DM]: 'Deathmatch',
    [GameMode.TEAM_DM]: 'Team Deathmatch',
    [GameMode.KOTH]: 'King of the Hill',
    [GameMode.TEAM_KOTH]: 'Team King of the Hill',
    [GameMode.CTF]: 'Capture the Flag',
    [GameMode.TEAM_CTF]: 'Team Capture the Flag',
    [GameMode.LOOT]: 'Loot',
    [GameMode.TEAM_LOOT]: 'Team Loot',
    [GameMode.RACE]: 'Race',
    [GameMode.TEAM_RACE]: 'Team Race',
    [GameMode.STRAT]: 'Free for All',
    [GameMode.TEAM_STRAT]: 'Team Strategy',
    [GameMode.MPI]: 'MPI'
  };

  // ============================================================================
  // DECODING UTILITIES
  // ============================================================================

  /**
   * Windows-1252 (cp1252) decoder
   * The game uses this encoding for names, not UTF-8
   */
  const CP1252_MAP = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178
  ];

  function decodeCP1252(bytes) {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte === 0) break; // Stop at null terminator
      if (byte >= 0x80 && byte <= 0x9F) {
        result += String.fromCharCode(CP1252_MAP[byte - 0x80]);
      } else {
        result += String.fromCharCode(byte);
      }
    }
    return result;
  }

  /**
   * Decode a Base64 string using cp1252 encoding and strip null bytes
   * @param {string} base64String - The Base64 encoded string
   * @returns {string} Decoded string
   */
  function decodeBase64Name(base64String) {
    if (!base64String) return '';
    try {
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return decodeCP1252(bytes).trim();
    } catch (e) {
      console.warn('Failed to decode Base64 string:', base64String, e);
      return base64String;
    }
  }

  /**
   * RakNet GUID custom Base64 alphabet
   * Used for decoding the 'g' field (NAT address)
   */
  const RAKNET_B64_CHARS = '@123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  
  /**
   * Decode RakNet GUID from custom Base64 to BigInt
   * @param {string} encodedGuid - The encoded GUID string
   * @returns {BigInt} The decoded 64-bit GUID
   */
  function decodeRakNetGuid(encodedGuid) {
    if (!encodedGuid) return null;
    let result = BigInt(0);
    for (let i = 0; i < encodedGuid.length; i++) {
      const charIndex = RAKNET_B64_CHARS.indexOf(encodedGuid[i]);
      if (charIndex >= 0) {
        result |= BigInt(charIndex) << BigInt(i * 6);
      }
    }
    return result;
  }

  // ============================================================================
  // STEAM JOIN URL UTILITIES
  // ============================================================================

  /**
   * Base Steam Browser protocol URL for directly joining games
   * 624970 = Battlezone Combat Commander App ID
   */
  const STEAM_JOIN_BASE = 'steam://rungame/624970/76561198955218468/-connect-mp%20';

  /**
   * Convert ASCII string to hexadecimal
   * @param {string} str - ASCII string to convert
   * @returns {string} Hexadecimal representation
   */
  function stringToHex(str) {
    return Array.from(str)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build a Steam protocol URL for directly joining a game session
   * @param {Object} raw - Raw session data from API
   * @returns {string|null} Steam join URL or null if session can't be joined
   */
  function buildSteamJoinUrl(raw) {
    // Can't join locked or password-protected games
    if (raw.l === 1 || raw.k === 1) {
      return null;
    }

    // Need at least a mod ID to build the join URL
    const mods = parseModIds(raw.mm);
    if (mods.length === 0) {
      return null;
    }

    // Get the session name (decoded)
    const sessionName = decodeBase64Name(raw.n);
    
    // Build mod list (semicolon-separated)
    const modList = mods.join(';');
    
    // NAT address is the 'g' field (RakNet GUID in custom Base64)
    const natAddress = raw.g || '';

    // Build args: N,{nameLen},{name},{modListLen},{modList},{nat},0,
    const args = [
      'N',
      sessionName.length.toString(),
      sessionName,
      modList.length.toString(),
      modList,
      natAddress,
      '0'
    ].join(',') + ',';

    // Convert to hex and build full URL
    return STEAM_JOIN_BASE + stringToHex(args);
  }

  // ============================================================================
  // PROFILE & WORKSHOP URL UTILITIES
  // ============================================================================

  /**
   * Build a Steam profile URL from Steam ID
   * @param {string} steamId - Steam 64-bit ID
   * @returns {string} Steam profile URL
   */
  function buildSteamProfileUrl(steamId) {
    if (!steamId) return null;
    return `https://steamcommunity.com/profiles/${steamId}/`;
  }

  /**
   * Build a GOG profile URL from GOG ID
   * @param {string} gogId - GOG Galaxy user ID
   * @returns {string} GOG profile URL
   */
  function buildGogProfileUrl(gogId) {
    if (!gogId) return null;
    return `https://www.gog.com/u/${gogId}`;
  }

  /**
   * Build a Steam Workshop URL from mod ID
   * @param {string} modId - Steam Workshop item ID
   * @returns {string|null} Workshop URL or null for stock/invalid
   */
  function buildWorkshopUrl(modId) {
    if (!modId || modId === '0') return null;
    return `https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`;
  }

  // ============================================================================
  // FIELD PARSERS
  // ============================================================================

  /**
   * Get session state from ServerInfoMode (si) field
   * @param {number} si - ServerInfoMode value
   * @param {Array} players - Player array to check for in-game stats
   * @returns {Object} State information
   */
  function parseSessionState(si, players = []) {
    // Check if any players have in-game stats (score/kills/deaths)
    // This can override PreGame state if game has actually started
    const hasInGameStats = players.some(p => 
      (p.score && p.score !== 0) || 
      (p.kills && p.kills !== 0) || 
      (p.deaths && p.deaths !== 0)
    );

    let state, stateDetail;
    
    switch (si) {
      case ServerInfoMode.UNKNOWN:
        state = 'Unknown';
        stateDetail = 'unknown';
        break;
      case ServerInfoMode.OPEN_WAITING:
      case ServerInfoMode.CLOSED_WAITING:
        // Override to InGame if players have stats
        if (hasInGameStats) {
          state = 'InGame';
          stateDetail = 'playing';
        } else {
          state = 'PreGame';
          stateDetail = si === ServerInfoMode.OPEN_WAITING ? 'waiting' : 'full';
        }
        break;
      case ServerInfoMode.OPEN_PLAYING:
      case ServerInfoMode.CLOSED_PLAYING:
        state = 'InGame';
        stateDetail = si === ServerInfoMode.OPEN_PLAYING ? 'playing' : 'full';
        break;
      case ServerInfoMode.EXITING:
        state = 'PostGame';
        stateDetail = 'exiting';
        break;
      default:
        state = 'Unknown';
        stateDetail = 'unknown';
    }

    return {
      state,
      stateDetail,
      serverInfoMode: si,
      hasOpenSlots: si === ServerInfoMode.OPEN_WAITING || si === ServerInfoMode.OPEN_PLAYING
    };
  }

  /**
   * Get NAT type information from t field
   * @param {number} t - NAT type value
   * @returns {Object} NAT type information
   */
  function parseNATType(t) {
    return {
      id: t,
      name: NATTypeNames[t] || `Unknown (${t})`,
      canDirectConnect: t === NATType.NONE || t === NATType.SUPPORTS_UPNP,
      isSymmetric: t === NATType.SYMMETRIC
    };
  }

  /**
   * Parse game type and mode from gt and gtd fields
   * @param {number} gt - Game type (1=DM, 2=Strategy)
   * @param {number} gtd - Game subtype/mode details
   * @returns {Object} Game type and mode information
   */
  function parseGameTypeAndMode(gt, gtd) {
    const result = {
      gameType: null,
      gameTypeName: null,
      gameMode: null,
      gameModeName: null,
      isTeamGame: false,
      respawn: 'One', // Default: one life
      vehicleOnly: false,
      rawGameType: gt,
      rawGameSubType: gtd
    };

    if (gt === GameType.DEATHMATCH) {
      result.gameType = 'DM';
      result.gameTypeName = 'Deathmatch';
      
      if (gtd !== null && gtd !== undefined) {
        const modeBase = gtd % GameMode.GAMEMODE_MAX;
        const detailed = Math.floor(gtd / GameMode.GAMEMODE_MAX);
        
        // Extract respawn flags from detailed value
        const detailedFlags = detailed & 0xFF;
        if (detailed & 256) {
          result.respawn = 'Race'; // Respawn same race
        } else if (detailed & 512) {
          result.respawn = 'Any'; // Respawn any race
        }
        
        // Determine if it's a team mode (odd numbers are team modes)
        result.isTeamGame = modeBase % 2 === 0 && modeBase >= 2 && modeBase <= 10;
        
        // Map detailed mode to game mode
        switch (detailedFlags) {
          case 0: // DM
            result.gameMode = result.isTeamGame ? 'TEAM_DM' : 'DM';
            result.gameModeName = result.isTeamGame ? 'Team Deathmatch' : 'Deathmatch';
            break;
          case 1: // KOTH
            result.gameMode = result.isTeamGame ? 'TEAM_KOTH' : 'KOTH';
            result.gameModeName = result.isTeamGame ? 'Team King of the Hill' : 'King of the Hill';
            break;
          case 2: // CTF
            result.gameMode = result.isTeamGame ? 'TEAM_CTF' : 'CTF';
            result.gameModeName = result.isTeamGame ? 'Team Capture the Flag' : 'Capture the Flag';
            break;
          case 3: // Loot
            result.gameMode = result.isTeamGame ? 'TEAM_LOOT' : 'LOOT';
            result.gameModeName = result.isTeamGame ? 'Team Loot' : 'Loot';
            break;
          case 5: // Race
            result.gameMode = result.isTeamGame ? 'TEAM_RACE' : 'RACE';
            result.gameModeName = result.isTeamGame ? 'Team Race' : 'Race';
            break;
          case 6: // Race (Vehicle Only)
            result.gameMode = result.isTeamGame ? 'TEAM_RACE' : 'RACE';
            result.gameModeName = result.isTeamGame ? 'Team Race' : 'Race';
            result.vehicleOnly = true;
            break;
          case 7: // DM (Vehicle Only)
            result.gameMode = result.isTeamGame ? 'TEAM_DM' : 'DM';
            result.gameModeName = result.isTeamGame ? 'Team Deathmatch' : 'Deathmatch';
            result.vehicleOnly = true;
            break;
          default:
            result.gameMode = 'DM';
            result.gameModeName = 'Deathmatch';
        }
      }
    } else if (gt === GameType.STRATEGY) {
      result.gameType = 'STRAT';
      result.gameTypeName = 'Strategy';
      
      if (gtd !== null && gtd !== undefined) {
        const modeBase = gtd % GameMode.GAMEMODE_MAX;
        
        switch (modeBase) {
          case GameMode.STRAT: // 11 - FFA Strategy
            result.gameMode = 'FFA';
            result.gameModeName = 'Free for All';
            result.isTeamGame = false;
            break;
          case GameMode.TEAM_STRAT: // 12 - Team Strategy
            result.gameMode = 'STRAT';
            result.gameModeName = 'Team Strategy';
            result.isTeamGame = true;
            break;
          case GameMode.MPI: // 13 - MPI
            result.gameMode = 'MPI';
            result.gameModeName = 'MPI';
            result.isTeamGame = true; // MPI is co-op (one human team vs AI)
            break;
          default:
            result.gameMode = 'STRAT';
            result.gameModeName = 'Strategy';
        }
      }
    } else if (gt === 0) {
      result.gameType = 'ALL';
      result.gameTypeName = 'All';
    }

    return result;
  }

  /**
   * Parse mod IDs from semicolon-separated string
   * @param {string} mm - Mod string (e.g., "2935570018;3046872939")
   * @returns {string[]} Array of mod IDs
   */
  function parseModIds(mm) {
    if (!mm) return [];
    return mm.split(';').filter(id => id.length > 0);
  }

  /**
   * Convert mod IDs to enriched mod objects with workshop URLs
   * @param {string[]} modIds - Array of mod ID strings
   * @returns {Object[]} Array of mod objects with id and workshopUrl
   */
  function enrichMods(modIds) {
    return modIds.map(id => ({
      id: id,
      name: id === '0' ? 'Stock' : null, // Only stock has a known name
      workshopUrl: buildWorkshopUrl(id)
    }));
  }

  /**
   * Parse time limit from gtm field
   * @param {number} gtm - Game time max value (255 = unlimited/maxed)
   * @returns {Object} Time limit info
   */
  function parseTimeLimit(gtm) {
    if (gtm === 255) {
      return { unlimited: true, minutes: null, maxedOut: true };
    }
    return { unlimited: false, minutes: gtm, maxedOut: false };
  }

  // ============================================================================
  // MAIN PARSERS
  // ============================================================================

  /**
   * Parse a player object from raw API data
   * @param {Object} rawPlayer - Raw player object from API
   * @param {number} index - Player index in the list
   * @param {boolean} isTeamGame - Whether this is a team game
   * @param {boolean} isMPI - Whether this is an MPI game
   * @returns {Object} Parsed player object
   */
  function parsePlayer(rawPlayer, index = 0, isTeamGame = false, isMPI = false, gameMode = null) {
    const player = {
      name: decodeBase64Name(rawPlayer.n),
      
      // IDs
      rawId: rawPlayer.i,
      steamId: null,
      gogId: null,
      platform: null,
      profileUrl: null,
      
      // Stats
      kills: rawPlayer.k ?? null,
      deaths: rawPlayer.d ?? null,
      score: rawPlayer.s ?? null,
      
      // Team info
      teamSlot: rawPlayer.t ?? null,
      team: null,
      isTeamLeader: false,
      isCommander: false,
      teamIndex: null,
      
      // Status flags
      isHost: index === 0,
      isHidden: false
    };

    // Parse player ID to extract platform and build profile URL
    if (rawPlayer.i) {
      const idPrefix = rawPlayer.i[0];
      const idValue = rawPlayer.i.substring(1);
      
      if (idPrefix === 'S') {
        player.steamId = idValue;
        player.platform = 'Steam';
        player.profileUrl = buildSteamProfileUrl(idValue);
      } else if (idPrefix === 'G') {
        player.gogId = idValue;
        player.platform = 'GOG';
        player.profileUrl = buildGogProfileUrl(idValue);
      }
    }

    // Check if player is hidden (no team assignment)
    // Hidden players are spectators or in a glitched state
    if (player.teamSlot === null || player.teamSlot === 255) {
      player.isHidden = true;
    }

    // Parse team assignment
    if (player.teamSlot !== null && player.teamSlot !== 255) {
      if (isTeamGame && !isMPI) {
        // Two-team game: slots 1-5 = team 1, slots 6-10 = team 2
        if (player.teamSlot >= 1 && player.teamSlot <= 5) {
          player.team = 1;
          player.teamIndex = player.teamSlot - 1;
          player.isTeamLeader = player.teamSlot === 1;
        } else if (player.teamSlot >= 6 && player.teamSlot <= 10) {
          player.team = 2;
          player.teamIndex = player.teamSlot - 6;
          player.isTeamLeader = player.teamSlot === 6;
        }
      } else if (isMPI) {
        // MPI: all humans on team 1
        player.team = 1;
        player.teamIndex = player.teamSlot - 1;
        player.isTeamLeader = player.teamSlot === 1;
      }
    }

    // Determine if player is a commander
    // In STRAT/MPI games, commanders are team leaders (slots 1 and 6)
    if (gameMode === 'STRAT' || gameMode === 'MPI' || gameMode === 'TEAM_STRAT') {
      player.isCommander = player.isTeamLeader;
    }

    return player;
  }

  /**
   * Parse a session object from raw API data
   * @param {Object} raw - Raw session object from API
   * @returns {Object} Parsed session object
   */
  function parseSession(raw) {
    // Parse game type and mode first (needed for player parsing)
    const gameInfo = parseGameTypeAndMode(raw.gt, raw.gtd);
    const isMPI = gameInfo.gameMode === 'MPI';
    
    // Parse players with game context (pass gameMode for commander detection)
    const players = (raw.pl || []).map((p, i) => 
      parsePlayer(p, i, gameInfo.isTeamGame, isMPI, gameInfo.gameMode)
    );
    
    // Parse session state (needs players for stat checking)
    const stateInfo = parseSessionState(raw.si, players);
    
    // Parse other fields
    const natInfo = parseNATType(raw.t);
    const timeLimitInfo = parseTimeLimit(raw.gtm);
    const modIds = parseModIds(raw.mm);
    const mods = enrichMods(modIds);

    // Decode GUID and convert to hex string (BigInt can't be JSON serialized)
    const guidBigInt = decodeRakNetGuid(raw.g);
    
    // Build Steam join URL (returns null if locked/password-protected)
    const steamJoinUrl = buildSteamJoinUrl(raw);
    
    // Collect commanders (players with isCommander: true)
    const commanders = players
      .filter(p => p.isCommander)
      .map(p => p.name);
    
    // Collect hidden players (spectators/glitched)
    const hiddenPlayers = players
      .filter(p => p.isHidden)
      .map(p => p.name);
    
    return {
      // Identity
      id: raw.g,
      guid: guidBigInt ? guidBigInt.toString(16).padStart(16, '0') : null,
      name: decodeBase64Name(raw.n),
      
      // Game info
      version: raw.v,
      ...gameInfo,
      
      // Map
      mapFile: raw.m,
      mapUrl: raw.mu || null,
      
      // Players
      players,
      playerCount: players.length,
      maxPlayers: raw.pm,
      commanders,
      hiddenPlayers,
      
      // Mods
      mods,
      primaryMod: modIds[0] || '0',
      modHash: raw.d,
      isStock: modIds.length === 0 || (modIds.length === 1 && modIds[0] === '0'),
      
      // Session state
      ...stateInfo,
      
      // Status flags
      isLocked: raw.l === 1,
      hasPassword: raw.k === 1,
      motd: raw.h || null,
      
      // Network
      nat: natInfo,
      steamJoinUrl,
      tps: raw.tps,
      maxPing: raw.pgm,
      worstPingObserved: raw.pg,
      
      // Time
      gameTimeMinutes: raw.gtm,
      timeElapsedMinutes: timeLimitInfo.maxedOut ? '>255' : raw.gtm,
      timeLimitMinutes: raw.ti || null,
      killLimit: raw.ki || null,
      
      // Preserve raw data for debugging
      _raw: raw
    };
  }

  /**
   * Add cache-busting parameter to URL to avoid stale proxy responses
   * @param {string} url - The URL to modify
   * @returns {string} URL with cache-busting parameter
   */
  function addCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_cb=${Date.now()}`;
  }

  /**
   * Attempt to fetch from the API, trying CORS proxies if direct fetch fails
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Raw API response
   */
  async function fetchRaw(options = {}) {
    const { proxyUrl, apiUrl = DEFAULT_API_URL, bustCache = true } = options;
    
    // Add cache-busting to the target URL
    const targetUrl = bustCache ? addCacheBuster(apiUrl) : apiUrl;
    
    // If a specific proxy is provided, use it
    if (proxyUrl) {
      const url = proxyUrl + encodeURIComponent(targetUrl);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
    
    // Try direct fetch first
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (directError) {
      console.warn('Direct fetch failed, trying CORS proxies...', directError.message);
      
      // Try each proxy
      for (const proxy of CORS_PROXIES) {
        try {
          const url = proxy + encodeURIComponent(targetUrl);
          console.log('Trying proxy:', proxy);
          const response = await fetch(url);
          if (!response.ok) continue;
          const data = await response.json();
          console.log('Success with proxy:', proxy);
          return data;
        } catch (proxyError) {
          console.warn('Proxy failed:', proxy, proxyError.message);
        }
      }
      
      throw new Error('All fetch attempts failed. CORS may be blocking requests.');
    }
  }

  /**
   * Build a consolidated data cache from parsed sessions
   * @param {Object[]} sessions - Array of parsed session objects
   * @returns {Object} Data cache with unique players and mods
   */
  function buildDataCache(sessions) {
    const players = {};
    const mods = {};

    for (const session of sessions) {
      // Collect unique players
      for (const player of session.players) {
        const playerId = player.steamId || player.gogId;
        if (playerId && !players[playerId]) {
          players[playerId] = {
            id: playerId,
            steamId: player.steamId,
            gogId: player.gogId,
            platform: player.platform,
            profileUrl: player.profileUrl
          };
        }
      }

      // Collect unique mods
      for (const mod of session.mods) {
        if (!mods[mod.id]) {
          mods[mod.id] = {
            id: mod.id,
            name: mod.name,
            workshopUrl: mod.workshopUrl
          };
        }
      }
    }

    return { players, mods };
  }

  /**
   * Fetch and parse multiplayer sessions
   * @param {Object} options - Options object
   * @param {string} options.proxyUrl - Optional CORS proxy URL prefix
   * @param {string} options.apiUrl - Optional custom API URL
   * @returns {Promise<Object>} Object containing sessions array and metadata
   */
  async function fetchSessions(options = {}) {
    const rawData = await fetchRaw(options);
    
    const sessions = (rawData.GET || []).map(parseSession);
    
    // Sort sessions by ID for consistent ordering across refreshes
    sessions.sort((a, b) => a.id.localeCompare(b.id));
    
    const dataCache = buildDataCache(sessions);
    
    return {
      sessions,
      timestamp: new Date().toISOString(),
      rawResponse: rawData,
      dataCache
    };
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    // Main functions
    fetchSessions,
    fetchRaw,
    parseSession,
    parsePlayer,
    buildDataCache,
    
    // Utilities
    decodeBase64Name,
    decodeRakNetGuid,
    parseGameTypeAndMode,
    parseSessionState,
    parseNATType,
    parseTimeLimit,
    parseModIds,
    enrichMods,
    
    // URL builders
    buildSteamProfileUrl,
    buildGogProfileUrl,
    buildWorkshopUrl,
    buildSteamJoinUrl,
    
    // Constants
    ServerInfoMode,
    NATType,
    NATTypeNames,
    GameType,
    GameMode,
    GameModeNames,
    
    // Config
    DEFAULT_API_URL,
    CORS_PROXIES
  };
})();

// Export for Node.js if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BZ2API;
}
