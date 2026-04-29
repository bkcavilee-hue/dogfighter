// Central match state machine. Every later piece (timer, win condition, end
// screen, multiplayer) reads/writes through here.
//
// States:
//   'intro'   - pre-match (banner / class select). Game world frozen, HUD off.
//   'playing' - active combat. World ticks, HUD on, kills counted.
//   'ended'   - someone won. World frozen, scoreboard shown, awaiting restart.

export const MATCH_MODES = {
  ffa: {
    label: 'Free for All',
    killGoal: 15,
    durationSec: 5 * 60,
    teamBased: false,
  },
  team2v2: {
    label: '2 vs 2',
    killGoal: 10,
    durationSec: 8 * 60,
    teamBased: true,
  },
};

export function createMatchState(modeKey = 'ffa') {
  const mode = MATCH_MODES[modeKey];
  return {
    state: 'intro',           // 'intro' | 'playing' | 'ended'
    modeKey,
    mode,
    elapsedSec: 0,
    timeRemainingSec: mode.durationSec,
    kills: { red: 0, blue: 0 },   // per-team scoreboard
    winner: null,             // 'red' | 'blue' | 'draw' | null
    winReason: null,          // 'killGoal' | 'timeout' | 'draw'
  };
}

export function startMatch(match) {
  match.state = 'playing';
  match.elapsedSec = 0;
  match.timeRemainingSec = match.mode.durationSec;
  match.kills.red = 0;
  match.kills.blue = 0;
  match.winner = null;
  match.winReason = null;
}

export function endMatch(match, winner, reason) {
  match.state = 'ended';
  match.winner = winner;
  match.winReason = reason;
}

/** Advance the timer and check win conditions. Call each fixed tick. */
export function tickMatch(match, dt, players) {
  if (match.state !== 'playing') return;

  match.elapsedSec += dt;
  match.timeRemainingSec = Math.max(0, match.mode.durationSec - match.elapsedSec);

  if (match.mode.teamBased) {
    // 2v2: aggregate per team.
    let red = 0, blue = 0;
    for (const p of players) {
      if (p.team === 'red') red += p.score;
      else if (p.team === 'blue') blue += p.score;
    }
    match.kills.red = red;
    match.kills.blue = blue;
    if (red >= match.mode.killGoal)  return endMatch(match, 'red', 'killGoal');
    if (blue >= match.mode.killGoal) return endMatch(match, 'blue', 'killGoal');
    if (match.timeRemainingSec <= 0) {
      if (red > blue) endMatch(match, 'red', 'timeout');
      else if (blue > red) endMatch(match, 'blue', 'timeout');
      else endMatch(match, 'draw', 'timeout');
    }
  } else {
    // FFA: top scorer wins.
    let top = null, topScore = -1;
    for (const p of players) {
      if ((p.score ?? 0) > topScore) { topScore = p.score ?? 0; top = p; }
    }
    match.topPlayer = top;
    match.topScore = topScore;
    if (topScore >= match.mode.killGoal && top) {
      return endMatch(match, top.id || 'top', 'killGoal');
    }
    if (match.timeRemainingSec <= 0) {
      if (top) endMatch(match, top.id || 'top', 'timeout');
      else endMatch(match, 'draw', 'timeout');
    }
  }
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
