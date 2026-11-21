/** English texts of the player. `{name}` parts are filled in by the code. */
export const en = {
  // Library (list of adventures)
  libraryTitle: 'Adventures',
  libraryIntro: 'Choose an adventure to play.',
  openFile: 'Open an adventure file (.zip)',
  /** The button that switches the library to the other language, so it is written in that one. */
  switchLanguage: 'Česky',
  loading: 'Loading…',
  loadError: 'The adventure could not be loaded.',

  // Title page and hero creation
  author: 'by {author}',
  continueGame: 'Continue',
  newGame: 'New adventure',
  newGameConfirm: 'Start a new adventure? Your saved progress will be lost.',
  otherAdventures: 'Other adventures',
  chooseProfession: 'Who are you?',
  yourHero: 'Your hero',
  chooseItems: 'What will you take with you? Pick {count}.',
  begin: 'Begin the adventure',

  // Stats
  hp: 'Hit points',
  maxHp: 'Maximum hit points',
  attack: 'Attack',
  defense: 'Defense',

  // Bag and menu
  bag: 'Bag',
  bagEmpty: 'Your bag is empty.',
  use: 'Use',
  close: 'Close',
  menu: 'Menu',
  restart: 'Start again',
  restartConfirm: 'Start again from the beginning? Your progress in this adventure will be lost.',
  toTitle: 'Back to the title page',
  yes: 'Yes',
  no: 'No',

  // Fight
  fight: 'Fight!',
  you: 'You',
  round: 'Round {n}',
  rollDice: 'Roll the dice!',
  nextRound: 'Next round',
  flee: 'Run away',
  hit: 'hit for {n}',
  noDamage: 'no damage',
  fightWon: 'You won the fight!',
  fightLost: 'You lost the fight…',
  next: 'Continue',

  // Endings
  theEnd: 'The End',
  victory: 'Victory!',
  defeat: 'Defeat',
  playAgain: 'Play again',
  deadTitle: 'You have died',
  deadText: 'Your adventure ends here.',
  tryAgain: 'Try again',
  deadEnd: 'The story does not continue from here yet.',

  // Notices
  itemGained: 'You got: {item}',
  itemLost: 'You lost: {item}',
  itemUsed: 'You used: {item}',
  brokenLink: 'This path is not finished yet.',

  // Play-testing from the editor (never shown in a normal game)
  testTitle: '🛠 Testing this page',
  testIntro: 'This page asks about these things. Set them as if the hero had played the way here.',
  testDid: 'already picked: {name}',
  testVisited: 'has been to: {name}',
  testWon: 'won the fight at: {name}',
  testAsUsual: 'as usual',
  testTools: 'Test tools',
  testToolsIntro: 'Only in the editor’s play-test. Changes happen right away.',
  testItems: 'Items',
  testWinFight: 'Win this fight',
  testGoTo: 'Go to page',
  testGo: 'Go',
};

export type Messages = typeof en;
