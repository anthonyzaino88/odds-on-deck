/**
 * Pure SGP game-list helpers for ParlayBuilder.
 * Pre-start only: in-progress / final props expire once the game starts.
 */

import { isPreStartStatus } from './game-status.js'

export function parlayBuilderGamesForSport(gamesData, selectedSport) {
  let games = []
  if (selectedSport === 'mlb') {
    games = gamesData?.mlb || []
  } else if (selectedSport === 'nfl') {
    games = gamesData?.nfl || []
  } else if (selectedSport === 'nhl') {
    games = gamesData?.nhl || []
  } else {
    games = [
      ...(gamesData?.mlb || []),
      ...(gamesData?.nfl || []),
      ...(gamesData?.nhl || []),
    ]
  }
  return games.filter((game) => isPreStartStatus(game?.status))
}

/**
 * Keep the current selection when it is still in the filtered list.
 * After a sport / type change, fall back to the first remaining game
 * (or '' if the list is empty) so the dropdown never points at a
 * hidden option.
 */
export function nextParlayBuilderGameId(activeGames, selectedGameId) {
  if (!Array.isArray(activeGames) || activeGames.length === 0) return ''
  if (selectedGameId && activeGames.some((game) => game.id === selectedGameId)) {
    return selectedGameId
  }
  return activeGames[0].id
}
